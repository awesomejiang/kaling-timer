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
    stored.snapshot = RoomSnapshotSchema.parse(stored.snapshot);
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
  assign(
    session: Session,
    input: { commandId: string; expectedVersion: number; zone: Zone | null },
  ) {
    return this.mutate(
      session,
      input.commandId,
      input.expectedVersion,
      input,
      (room) => {
        const s = room.snapshot;
        if (
          input.zone !== null &&
          s.members.filter(
            (m) => m.id !== session.memberId && m.zone === input.zone,
          ).length >= 2
        )
          throw new Error("ZONE_FULL");
        s.members.find((m) => m.id === session.memberId)!.zone = input.zone;
      },
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
        if (s.hostId !== session.memberId) throw new Error("HOST_ONLY");
        const at = eventTime(input.timing, receivedAt);
        if (
          s.battle.phase !== "lobby" &&
          input.action.type !== "reset" &&
          at < (s.battle.phaseStartAt ?? 0)
        )
          throw new Error("EVENT_BEFORE_PHASE");
        s.battle = reduceBattle(
          s.battle,
          this.mechanics,
          input.action,
          at,
          randomUUID(),
        );
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
