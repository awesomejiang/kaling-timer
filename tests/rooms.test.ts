import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadMechanics } from "@kaling/mechanics";
import type { Action, Session } from "@kaling/shared";
import { RoomStore } from "../apps/server/src/rooms.js";
const mechanics = loadMechanics(
  readFileSync(new URL("../config/mechanics.yaml", import.meta.url), "utf8"),
);
const cmd = (version: number, action: Action) => ({
  commandId: randomUUID(),
  expectedVersion: version,
  action,
  timing: { source: "button" as const },
});
it.each([1, 2, 3, 4, 5, 6])(
  "supports %i players and rejects a seventh",
  (count) => {
    const store = new RoomStore(mechanics);
    try {
      const host = store.create("host", "", "normal");
      let snapshot = host.snapshot;
      for (let i = 1; i < count; i++)
        snapshot = store.join(snapshot.code, `p${i}`, "").snapshot;
      expect(snapshot.members).toHaveLength(count);
      if (count === 6)
        expect(() => store.join(snapshot.code, "extra", "")).toThrow(
          "ROOM_FULL",
        );
    } finally {
      store.close();
    }
  },
);
it("enforces host authority, assignments, stale versions, idempotency and durable reconnect", () => {
  const dir = mkdtempSync(join(tmpdir(), "kaling-"));
  const path = join(dir, "room.sqlite");
  let store = new RoomStore(mechanics, path);
  try {
    const host = store.create("host", "secret", "hard");
    const h = host.session;
    expect(() => store.join(h.code, "bad", "wrong")).toThrow("WRONG_PASSWORD");
    const a = store.join(h.code, "a", "secret").session,
      b = store.join(h.code, "b", "secret").session;
    let s = store.resume(h);
    const assign = (session: Session, zone: "bird" | "tiger" | "dog") =>
      store.assign(session, {
        commandId: randomUUID(),
        expectedVersion: s.version,
        zone,
      });
    s = assign(h, "bird");
    s = assign(a, "bird");
    expect(() => assign(b, "bird")).toThrow("ZONE_FULL");
    s = assign(b, "dog");
    expect(() =>
      store.command(a, cmd(s.version, { type: "start" }), 10000),
    ).toThrow("HOST_ONLY");
    const start = cmd(s.version, { type: "start" });
    s = store.command(h, start, 10000);
    const version = s.version;
    expect(store.command(h, start, 90000).version).toBe(version);
    expect(() =>
      store.command(h, { ...start, action: { type: "reset" } }, 10000),
    ).toThrow("COMMAND_ID_REUSED");
    expect(() => store.command(h, cmd(0, { type: "reset" }), 10000)).toThrow(
      "STALE_VERSION",
    );
    expect(() => store.resume({ ...h, token: "0".repeat(64) })).toThrow(
      "UNAUTHORIZED",
    );
    s = store.command(
      h,
      cmd(s.version, { type: "calibrate", skill: "p1_dog_minigame" }),
      20000,
    );
    const before = structuredClone(s);
    store.close();
    store = new RoomStore(mechanics, path);
    expect(store.resume(h)).toEqual(before);
    expect(store.resume(a)).toEqual(before);
    expect(store.command(h, start, 50000)).toEqual(before);
    const raw = store.db.prepare("SELECT data FROM rooms").get()!
      .data as string;
    expect(raw).not.toContain(h.token);
    expect(raw).not.toContain("secret");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("retries admission commands without duplicate rooms or members and persists their receipts", () => {
  const dir = mkdtempSync(join(tmpdir(), "kaling-admit-"));
  let store = new RoomStore(mechanics, join(dir, "rooms.sqlite"));
  try {
    const admission = { commandId: randomUUID(), token: "a".repeat(64) };
    const first = store.create("host", "pw", "normal", admission);
    expect(store.create("host", "pw", "normal", admission)).toEqual(first);
    expect(
      store.db.prepare("SELECT COUNT(*) AS total FROM rooms").get()!.total,
    ).toBe(1);
    expect(() => store.create("changed", "pw", "normal", admission)).toThrow(
      "COMMAND_ID_REUSED",
    );
    const joinAdmission = { commandId: randomUUID(), token: "b".repeat(64) };
    const joined = store.join(
      first.session.code,
      "member",
      "pw",
      joinAdmission,
    );
    expect(
      store.join(first.session.code, "member", "pw", joinAdmission),
    ).toEqual(joined);
    expect(joined.snapshot.members).toHaveLength(2);
    store.close();
    store = new RoomStore(mechanics, join(dir, "rooms.sqlite"));
    expect(
      store.join(first.session.code, "member", "pw", joinAdmission),
    ).toEqual(joined);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
