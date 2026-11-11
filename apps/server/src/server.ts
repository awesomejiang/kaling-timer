import { createServer } from "node:http";
import { Server } from "socket.io";
import {
  AssignmentSchema,
  CommandSchema,
  CreateRoomSchema,
  JoinRoomSchema,
  ResumeSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type ServerInfo,
  type Session,
  type RoomSnapshot,
} from "@kaling/shared";
import type { Mechanics } from "@kaling/mechanics";
import { RoomStore } from "./rooms.js";
export function createApp(
  mechanics: Mechanics,
  options: { databasePath?: string; origins?: string[] } = {},
) {
  const store = new RoomStore(mechanics, options.databasePath);
  const info = (): ServerInfo => ({
    protocolVersion: 1,
    milestone: 6,
    mechanicsVersion: mechanics.version,
    serverTime: Date.now(),
  });
  const http = createServer((req, res) => {
    if (req.method !== "GET" || req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }
    res
      .writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      })
      .end(JSON.stringify(info()));
  });
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(http, {
    maxHttpBufferSize: 16_384,
    cors: {
      origin: options.origins ?? [
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "http://tauri.localhost",
        "tauri://localhost",
      ],
      methods: ["GET", "POST"],
    },
  });
  const limits = new Map<string, { count: number; until: number }>();
  function rate(key: string, max: number) {
    const now = Date.now();
    let bucket = limits.get(key);
    if (!bucket || bucket.until < now) {
      bucket = { count: 0, until: now + 60_000 };
      limits.set(key, bucket);
    }
    if (++bucket.count > max) throw new Error("RATE_LIMITED");
    if (limits.size > 10000)
      for (const [key, value] of limits)
        if (value.until < now) limits.delete(key);
  }
  io.use((socket, next) => {
    try {
      rate(`connect:${socket.handshake.address}`, 60);
      next();
    } catch {
      next(new Error("RATE_LIMITED"));
    }
  });
  io.on("connection", (socket) => {
    let session: Session | null = null;
    socket.emit("server:info", info());
    const publish = (s: RoomSnapshot) => {
      io.to(s.code).emit("room:snapshot", s);
    };
    function bind(value: Session) {
      if (session) socket.leave(session.code);
      session = value;
      socket.join(value.code);
    }
    function handle<T>(reply: unknown, fn: () => T) {
      if (typeof reply !== "function") return;
      try {
        rate(`events:${socket.handshake.address}`, 600);
        reply({ ok: true, value: fn() });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "INVALID_INPUT";
        reply({
          ok: false,
          error: /^[A-Z_]+$/.test(message) ? message : "INVALID_INPUT",
        });
      }
    }
    socket.on("room:create", (input, reply) =>
      handle(reply, () => {
        rate(`admission:${socket.handshake.address}`, 20);
        const v = CreateRoomSchema.parse(input);
        if (session && !store.ownsAdmission(v.commandId, session))
          throw new Error("ALREADY_IN_ROOM");
        const result = store.create(v.name, v.password, v.difficulty, {
          commandId: v.commandId,
          token: v.token,
        });
        if (session && session.memberId !== result.session.memberId)
          throw new Error("ALREADY_IN_ROOM");
        bind(result.session);
        return result;
      }),
    );
    socket.on("room:join", (input, reply) =>
      handle(reply, () => {
        rate(`admission:${socket.handshake.address}`, 20);
        const v = JoinRoomSchema.parse(input);
        if (session && !store.ownsAdmission(v.commandId, session))
          throw new Error("ALREADY_IN_ROOM");
        const result = store.join(v.code, v.name, v.password, {
          commandId: v.commandId,
          token: v.token,
        });
        if (session && session.memberId !== result.session.memberId)
          throw new Error("ALREADY_IN_ROOM");
        bind(result.session);
        publish(result.snapshot);
        return result;
      }),
    );
    socket.on("room:resume", (input, reply) =>
      handle(reply, () => {
        const value = ResumeSchema.parse(input);
        const snapshot = store.resume(value);
        bind(value);
        return snapshot;
      }),
    );
    socket.on("room:assign", (input, reply) =>
      handle(reply, () => {
        if (!session) throw new Error("UNAUTHORIZED");
        const snapshot = store.assign(session, AssignmentSchema.parse(input));
        publish(snapshot);
        return snapshot;
      }),
    );
    socket.on("room:command", (input, reply) =>
      handle(reply, () => {
        if (!session) throw new Error("UNAUTHORIZED");
        rate(`commands:${session.code}`, 120);
        const snapshot = store.command(
          session,
          CommandSchema.parse(input),
          Date.now(),
        );
        publish(snapshot);
        return snapshot;
      }),
    );
    socket.on("clock:sync", (reply) => {
      if (typeof reply !== "function") return;
      try {
        rate(`clock:${socket.handshake.address}`, 600);
        const receivedAt = Date.now();
        reply({ receivedAt, sentAt: Date.now() });
      } catch {
        /* Drop excess clock probes. */
      }
    });
  });
  http.once("close", () => store.close());
  return { http, io, store };
}
