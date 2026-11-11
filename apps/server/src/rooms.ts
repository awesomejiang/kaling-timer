import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { initialBattle, reduceBattle } from "@kaling/timer-engine";
import {
  RoomSnapshotSchema,
  eventTime,
  commandPermission,
  type Command,
  type Difficulty,
  type RoomSnapshot,
  type Session,
  type Zone,
} from "@kaling/shared";
import type { Mechanics } from "@kaling/mechanics";
interface Admission {
  commandId: string;
  token: string;
}
interface StoredRoom {
  snapshot: RoomSnapshot;
  startingZones?: Record<string, Zone | null>;
  credentials: Record<string, string>;
  password: { salt: string; hash: string } | null;
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export class RoomStore {
  readonly db: DatabaseSync;
  constructor(
    readonly mechanics: Mechanics,
    path = ":memory:",
  ) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS rooms(code TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS receipts(code TEXT, id TEXT, member TEXT, fingerprint TEXT, PRIMARY KEY(code,id)); CREATE TABLE IF NOT EXISTS admissions(id TEXT PRIMARY KEY, code TEXT, member TEXT, fingerprint TEXT);",
    );
  }
  close() {
    this.db.close();
  }
  private load(code: string): StoredRoom {
    const row = this.db
      .prepare("SELECT data FROM rooms WHERE code=?")
      .get(code);
    if (!row) throw new Error("ROOM_NOT_FOUND");
    const stored = JSON.parse(row.data as string) as StoredRoom;
    if (
      stored.snapshot.mechanicsVersion === "1.0.0" &&
      ["1.1.0", "1.2.0", "1.3.0", "1.4.0"].includes(this.mechanics.version)
    ) {
      stored.snapshot.battle.timers.p2_kaling_scroll ??= initialBattle(
        stored.snapshot.battle.difficulty,
      ).timers.p2_kaling_scroll;
      stored.snapshot.mechanicsVersion = "1.1.0";
    }
    if (
      ["1.1.0", "1.2.0"].includes(stored.snapshot.mechanicsVersion) &&
      ["1.2.0", "1.3.0", "1.4.0"].includes(this.mechanics.version)
    )
      stored.snapshot.mechanicsVersion =
        this.mechanics.version === "1.4.0" ? "1.3.0" : this.mechanics.version;
    stored.snapshot = RoomSnapshotSchema.parse(stored.snapshot);
    if (
      stored.snapshot.mechanicsVersion === "1.3.0" &&
      this.mechanics.version === "1.4.0"
    ) {
      const scroll = stored.snapshot.battle.timers.p2_kaling_scroll;
      const unconfigured = { firstAt: null, basis: "unconfigured" } as const;
      if (scroll.basis === "configured") Object.assign(scroll, unconfigured);
      for (const reference of scroll.history)
        if (reference.basis === "configured")
          Object.assign(reference, unconfigured);
      stored.snapshot.mechanicsVersion = this.mechanics.version;
    }
    if (stored.snapshot.mechanicsVersion !== this.mechanics.version)
      throw new Error("MECHANICS_VERSION_MISMATCH");
    return stored;
  }
  private save(room: StoredRoom) {
    this.db
      .prepare(
        "INSERT INTO rooms(code,data) VALUES(?,?) ON CONFLICT(code) DO UPDATE SET data=excluded.data",
      )
      .run(room.snapshot.code, JSON.stringify(room));
  }
  private newMember(
    room: StoredRoom,
    name: string,
    suppliedToken?: string,
  ): Session {
    if (room.snapshot.members.length >= 6) throw new Error("ROOM_FULL");
    const id = randomUUID(),
      token = suppliedToken ?? randomBytes(32).toString("hex");
    room.snapshot.members.push({ id, name, zone: null });
    room.credentials[id] = hash(token);
    return { code: room.snapshot.code, memberId: id, token };
  }
  private admit(
    admission: Admission | undefined,
    input: unknown,
    run: (token?: string) => { session: Session; snapshot: RoomSnapshot },
  ) {
    if (!admission) return run();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const fingerprint = hash(JSON.stringify([input, admission.token]));
      const prior = this.db
        .prepare("SELECT code,member,fingerprint FROM admissions WHERE id=?")
        .get(admission.commandId);
      let result: { session: Session; snapshot: RoomSnapshot };
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new Error("COMMAND_ID_REUSED");
        const session = {
          code: prior.code as string,
          memberId: prior.member as string,
          token: admission.token,
        };
        result = { session, snapshot: this.resume(session) };
      } else {
        result = run(admission.token);
        this.db
          .prepare(
            "INSERT INTO admissions(id,code,member,fingerprint) VALUES(?,?,?,?)",
          )
          .run(
            admission.commandId,
            result.session.code,
            result.session.memberId,
            fingerprint,
          );
      }
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  create(
    name: string,
    password: string,
    difficulty: Difficulty,
    admission?: Admission,
  ) {
    return this.admit(
      admission,
      ["create", name, password, difficulty],
      (token) => {
        let code: string;
        const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        do {
          code = Array.from(
            { length: 6 },
            () => alphabet[randomInt(alphabet.length)],
          ).join("");
        } while (
          this.db.prepare("SELECT code FROM rooms WHERE code=?").get(code)
        );
        const salt = randomBytes(16).toString("hex");
        const room: StoredRoom = {
          snapshot: {
            code,
            hostId: "",
            version: 0,
            mechanicsVersion: this.mechanics.version,
            battle: initialBattle(difficulty),
            members: [],
            log: [],
          },
          credentials: {},
          password: password
            ? { salt, hash: scryptSync(password, salt, 32).toString("hex") }
            : null,
        };
        const session = this.newMember(room, name, token);
        room.snapshot.hostId = session.memberId;
        this.save(room);
        return { session, snapshot: room.snapshot };
      },
    );
  }
  join(code: string, name: string, password: string, admission?: Admission) {
    return this.admit(admission, ["join", code, name, password], (token) => {
      const room = this.load(code);
      if (
        room.password &&
        !equal(
          scryptSync(password, room.password.salt, 32).toString("hex"),
          room.password.hash,
        )
      )
        throw new Error("WRONG_PASSWORD");
      const session = this.newMember(room, name, token);
      room.snapshot.version++;
      this.save(room);
      return { session, snapshot: room.snapshot };
    });
  }
  ownsAdmission(id: string, session: Session) {
    const row = this.db
      .prepare("SELECT code,member FROM admissions WHERE id=?")
      .get(id);
    return row?.code === session.code && row?.member === session.memberId;
  }
  resume(session: Session) {
    const room = this.load(session.code);
    this.authenticate(room, session);
    return room.snapshot;
  }
  leave(session: Session): RoomSnapshot | null {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const room = this.load(session.code);
      this.authenticate(room, session);
      const snapshot = room.snapshot;
      snapshot.members = snapshot.members.filter(
        (member) => member.id !== session.memberId,
      );
      delete room.credentials[session.memberId];
      if (room.startingZones) delete room.startingZones[session.memberId];
      this.db
        .prepare("DELETE FROM admissions WHERE code=? AND member=?")
        .run(session.code, session.memberId);
      if (!snapshot.members.length) {
        this.db.prepare("DELETE FROM receipts WHERE code=?").run(session.code);
        this.db.prepare("DELETE FROM rooms WHERE code=?").run(session.code);
      } else {
        if (snapshot.hostId === session.memberId)
          snapshot.hostId = snapshot.members[0].id;
        snapshot.version++;
        this.save(room);
      }
      this.db.exec("COMMIT");
      return snapshot.members.length ? snapshot : null;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private authenticate(room: StoredRoom, session: Session) {
    if (
      !room.credentials[session.memberId] ||
      !equal(room.credentials[session.memberId], hash(session.token))
    )
      throw new Error("UNAUTHORIZED");
  }
  private mutate(
    session: Session,
    id: string,
    expectedVersion: number,
    input: unknown,
    change: (room: StoredRoom) => void,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const room = this.load(session.code);
      this.authenticate(room, session);
      const fingerprint = hash(JSON.stringify(input));
      const receipt = this.db
        .prepare(
          "SELECT member,fingerprint FROM receipts WHERE code=? AND id=?",
        )
        .get(session.code, id);
      if (receipt) {
        if (
          receipt.member !== session.memberId ||
          receipt.fingerprint !== fingerprint
        )
          throw new Error("COMMAND_ID_REUSED");
        this.db.exec("COMMIT");
        return room.snapshot;
      }
      if (room.snapshot.version !== expectedVersion)
        throw new Error("STALE_VERSION");
      change(room);
      room.snapshot.version++;
      this.save(room);
      this.db
        .prepare(
          "INSERT INTO receipts(code,id,member,fingerprint) VALUES(?,?,?,?)",
        )
        .run(session.code, id, session.memberId, fingerprint);
      this.db.exec("COMMIT");
      return room.snapshot;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  private setZone(room: StoredRoom, memberId: string, zone: Zone | null) {
    const snapshot = room.snapshot;
    if (snapshot.battle.phase === "p1") {
      room.startingZones ??= Object.fromEntries(
        snapshot.members.map((member) => [member.id, member.zone]),
      );
      if (!(memberId in room.startingZones))
        room.startingZones[memberId] = zone;
    } else if (snapshot.battle.phase !== "lobby") {
      throw new Error("WRONG_PHASE");
    }
    snapshot.members.find((member) => member.id === memberId)!.zone = zone;
  }
  assign(
    session: Session,
    input: { commandId: string; expectedVersion: number; zone: Zone | null },
  ) {
    return this.mutate(
      session,
      input.commandId,
      input.expectedVersion,
      input,
      (room) => this.setZone(room, session.memberId, input.zone),
    );
  }
  command(session: Session, input: Command, receivedAt: number) {
    return this.mutate(
      session,
      input.commandId,
      input.expectedVersion,
      input,
      (room) => {
        const s = room.snapshot;
        const denied = commandPermission(
          s,
          session.memberId,
          input.action,
          this.mechanics.skills,
        );
        if (denied) throw new Error(denied);
        const at = eventTime(input.timing, receivedAt);
        if (
          s.battle.phase !== "lobby" &&
          input.action.type !== "reset" &&
          at < (s.battle.phaseStartAt ?? 0)
        )
          throw new Error("EVENT_BEFORE_PHASE");
        if (input.action.type === "enter-zone") {
          this.setZone(room, session.memberId, input.action.zone);
        } else {
          s.battle = reduceBattle(
            s.battle,
            this.mechanics,
            input.action,
            at,
            randomUUID(),
          );
          if (input.action.type === "start") {
            room.startingZones = Object.fromEntries(
              s.members.map((member) => [member.id, member.zone]),
            );
          } else if (input.action.type === "reset") {
            for (const member of s.members) {
              const startingZone = room.startingZones?.[member.id];
              if (startingZone !== undefined) member.zone = startingZone;
            }
            delete room.startingZones;
          }
        }
        s.log.push({
          at: receivedAt,
          version: s.version + 1,
          memberId: session.memberId,
          action: input.action,
          eventAt: at,
        });
        s.log = s.log.slice(-100);
      },
    );
  }
}
