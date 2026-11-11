import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { io } from "socket.io-client";
import { loadMechanics } from "@kaling/mechanics";
import { ServerInfoSchema } from "@kaling/shared";
import { createApp } from "../apps/server/src/server.js";
it("serves health and a validated Socket.IO protocol handshake", async () => {
  const config = loadMechanics(
    readFileSync(new URL("../config/mechanics.yaml", import.meta.url), "utf8"),
  );
  const app = createApp(config);
  await new Promise<void>((resolve) =>
    app.http.listen(0, "127.0.0.1", resolve),
  );
  const url = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
  const client = io(url, { autoConnect: false, reconnection: false });
  try {
    const health = await fetch(url + "/health");
    expect(health.status).toBe(200);
    expect(ServerInfoSchema.parse(await health.json()).mechanicsVersion).toBe(
      config.version,
    );
    expect((await fetch(url + "/rooms", { method: "POST" })).status).toBe(404);
    const info = await new Promise<unknown>((resolve, reject) => {
      client.on("server:info", resolve);
      client.on("connect_error", reject);
      client.connect();
    });
    expect(ServerInfoSchema.parse(info).milestone).toBe(6);
  } finally {
    client.disconnect();
    await new Promise<void>((resolve) => app.io.close(() => resolve()));
  }
});

it("enforces room authority over real sockets and restores host after disconnect", async () => {
  const { randomUUID } = await import("node:crypto");
  const config = loadMechanics(
    readFileSync(new URL("../config/mechanics.yaml", import.meta.url), "utf8"),
  );
  const app = createApp(config);
  await new Promise<void>((resolve) =>
    app.http.listen(0, "127.0.0.1", resolve),
  );
  const url = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
  const make = () => io(url, { autoConnect: false, reconnection: false });
  const host = make(),
    member = make(),
    reconnected = make(),
    stranger = make();
  const open = (client: ReturnType<typeof make>) =>
    new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
      client.connect();
    });
  try {
    await Promise.all([open(host), open(member), open(stranger)]);
    const created = await host.emitWithAck("room:create", {
      commandId: randomUUID(),
      token: "a".repeat(64),
      name: "host",
      password: "pw",
      difficulty: "normal",
    });
    expect(created.ok).toBe(true);
    const { session, snapshot: initial } = created.value;
    const joined = await member.emitWithAck("room:join", {
      commandId: randomUUID(),
      token: "b".repeat(64),
      name: "member",
      password: "pw",
      code: session.code,
    });
    expect(joined.ok).toBe(true);
    const assigned = await host.emitWithAck("room:assign", {
      commandId: randomUUID(),
      expectedVersion: joined.value.snapshot.version,
      zone: "dog",
    });
    const version = assigned.value.version;
    const command = {
      commandId: randomUUID(),
      expectedVersion: version,
      action: { type: "start" },
      timing: { source: "button" },
    };
    expect((await stranger.emitWithAck("room:command", command)).error).toBe(
      "UNAUTHORIZED",
    );
    expect((await member.emitWithAck("room:command", command)).error).toBe(
      "HOST_ONLY",
    );
    const started = await host.emitWithAck("room:command", command);
    expect(started.value.battle.phase).toBe("p1");
    host.disconnect();
    const calibration = {
      commandId: randomUUID(),
      expectedVersion: started.value.version,
      action: {
        type: "calibrate",
        skill: "p1_dog_minigame",
        remainingSeconds: 50,
      },
      timing: { source: "button" },
    };
    expect((await member.emitWithAck("room:command", calibration)).error).toBe(
      "ZONE_ONLY",
    );
    await open(reconnected);
    const resumed = await reconnected.emitWithAck("room:resume", session);
    expect(resumed.value).toEqual(started.value);
    const calibrated = await reconnected.emitWithAck(
      "room:command",
      calibration,
    );
    expect(calibrated.ok).toBe(true);
    expect(
      calibrated.value.battle.timers.p1_dog_minigame.firstAt,
    ).toBeGreaterThan(Date.now() + 48000);
    const replay = await reconnected.emitWithAck("room:command", calibration);
    expect(replay.value.version).toBe(calibrated.value.version);
    const changed = { ...calibration, commandId: randomUUID() };
    expect((await reconnected.emitWithAck("room:command", changed)).error).toBe(
      "STALE_VERSION",
    );
    const sample = await reconnected.emitWithAck("clock:sync");
    expect(sample.sentAt).toBeGreaterThanOrEqual(sample.receivedAt);
    expect(JSON.stringify(calibrated.value)).not.toContain(session.token);
    expect(await reconnected.emitWithAck("room:leave", session)).toEqual({
      ok: true,
      value: null,
    });
    expect((await reconnected.emitWithAck("room:resume", session)).error).toBe(
      "UNAUTHORIZED",
    );
    const remaining = await member.emitWithAck(
      "room:resume",
      joined.value.session,
    );
    expect(remaining.value.hostId).toBe(joined.value.session.memberId);
    expect(remaining.value.members).toHaveLength(1);
    expect(remaining.value.battle).toEqual(calibrated.value.battle);
  } finally {
    for (const c of [host, member, reconnected, stranger]) c.disconnect();
    await new Promise<void>((resolve) => app.io.close(() => resolve()));
  }
});
