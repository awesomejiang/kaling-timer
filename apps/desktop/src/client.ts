import { create } from "zustand";
import { io, type Socket } from "socket.io-client";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { ClockSync } from "@kaling/timer-engine";
import {
  ResumeSchema,
  commandPermission,
  RoomSnapshotSchema,
  type Action,
  type InputTiming,
  type Command,
  type RoomSnapshot,
  type Session,
  type ServerToClientEvents,
  type ClientToServerEvents,
  type Reply,
  type Difficulty,
  type Zone,
} from "@kaling/shared";
import { readSettings, writeSettings, type Settings } from "./settings";
import { mechanics } from "./mechanics";
export const clock = new ClockSync();
let clockInitialized = false;
interface State {
  room: RoomSnapshot | null;
  session: Session | null;
  connected: boolean;
  synced: boolean;
  error: string;
  settings: Settings;
  pending: Command | null;
  mic: string;
  micDevice: string;
  micLevel: number;
  voiceResult: string;
  voiceHints: Partial<Record<import("@kaling/shared").SkillId, string[]>>;
  audio: string;
  syncErrorMs: number;
  audioLatenessMs: number;
}
export const useApp = create<State>(() => ({
  room: null,
  session: null,
  connected: false,
  synced: false,
  error: "",
  settings: readSettings(),
  pending: null,
  mic: "关闭",
  micDevice: "",
  micLevel: 0,
  voiceResult: "",
  voiceHints: {},
  audio: "未启用",
  syncErrorMs: Infinity,
  audioLatenessMs: 0,
}));
let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
export const report = (error: unknown) =>
  useApp.setState({
    error: error instanceof Error ? error.message : String(error),
  });
export function settingsUpdate(patch: Partial<Settings>) {
  const next = { ...useApp.getState().settings, ...patch };
  try {
    writeSettings(next);
    useApp.setState({ settings: next });
  } catch {
    report("设置无效或无法保存；已保留上次有效设置");
  }
}
export function acceptSnapshot(value: unknown) {
  const snapshot = RoomSnapshotSchema.parse(value);
  if (snapshot.mechanicsVersion !== mechanics.version)
    throw new Error("MECHANICS_VERSION_MISMATCH");
  const current = useApp.getState().room;
  if (current?.code === snapshot.code && snapshot.version <= current.version)
    return;
  useApp.setState({ room: snapshot });
}
function unwrap<T>(reply: Reply<T>): T {
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}
async function sync() {
  if (!socket?.connected) return;
  const sent = performance.now();
  const sample = await socket.timeout(3000).emitWithAck("clock:sync");
  const received = performance.now();
  clock.sample(sent, received, sample.receivedAt, sample.sentAt);
  clockInitialized = true;
  useApp.setState({ synced: clock.ready, syncErrorMs: clock.uncertaintyMs });
}
export async function connect() {
  socket?.disconnect();
  useApp.setState({ connected: false, synced: false });
  clock.invalidate();
  const url =
    useApp.getState().settings.serverUrl ||
    (import.meta.env.DEV ? undefined : "http://localhost:3001");
  socket = io(url, { autoConnect: false });
  socket.on("room:snapshot", (value) => {
    try {
      acceptSnapshot(value);
    } catch {
      report("服务器快照格式不兼容");
    }
  });
  socket.on("connect", async () => {
    useApp.setState({ connected: true });
    clock.invalidate();
    try {
      for (let i = 0; i < 5; i++) await sync();
      const session = useApp.getState().session;
      if (session && socket) {
        acceptSnapshot(
          unwrap(
            await socket.timeout(5000).emitWithAck("room:resume", session),
          ),
        );
        if (useApp.getState().pending) await retryPending();
      }
    } catch (error) {
      report(error);
    }
  });
  socket.on("disconnect", () => {
    useApp.setState({ connected: false, synced: false });
  });
  socket.on("connect_error", () => useApp.setState({ connected: false }));
  if (isTauri() && !useApp.getState().session) {
    try {
      const stored = await invoke<string | null>("load_session");
      if (stored)
        useApp.setState({ session: ResumeSchema.parse(JSON.parse(stored)) });
    } catch {
      report("无法读取安全重连凭据");
    }
  }
  socket.connect();
}
setInterval(() => {
  if (socket?.connected) sync().catch(report);
}, 15000);
async function established(result: {
  session: Session;
  snapshot: RoomSnapshot;
}) {
  useApp.setState({
    session: result.session,
    room: result.snapshot,
    error: "",
  });
  if (isTauri()) {
    try {
      await invoke("save_session", { value: JSON.stringify(result.session) });
    } catch {
      report("安全凭据保存失败；关闭程序后将无法恢复此会话");
    }
  }
}
let admissionPending: {
  kind: "room:create" | "room:join";
  input: Record<string, unknown>;
} | null = null;
function admissionCredentials() {
  return {
    commandId: crypto.randomUUID(),
    token: Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join(""),
  };
}
async function admit(
  kind: "room:create" | "room:join",
  input: Record<string, unknown>,
) {
  if (!socket?.connected) throw new Error("OFFLINE");
  if (admissionPending && admissionPending.kind !== kind)
    throw new Error("请先重试上一条建房/加入请求");
  admissionPending ??= { kind, input: { ...input, ...admissionCredentials() } };
  const result = await socket
    .timeout(5000)
    .emitWithAck(admissionPending.kind, admissionPending.input);
  admissionPending = null;
  await established(unwrap(result));
}
export async function createRoom(
  name: string,
  password: string,
  difficulty: Difficulty,
) {
  await admit("room:create", { name, password, difficulty });
}
export async function joinRoom(code: string, name: string, password: string) {
  await admit("room:join", { code: code.toUpperCase(), name, password });
}
export async function assign(zone: Zone | null) {
  const s = useApp.getState();
  if (!socket?.connected || !s.room) throw new Error("OFFLINE");
  acceptSnapshot(
    unwrap(
      await socket.timeout(5000).emitWithAck("room:assign", {
        commandId: crypto.randomUUID(),
        expectedVersion: s.room.version,
        zone,
      }),
    ),
  );
}
export async function sendAction(
  action: Action,
  timing: InputTiming = { source: "button" },
) {
  const s = useApp.getState();
  if (!socket?.connected || !s.synced || !s.room) throw new Error("OFFLINE");
  const denied = commandPermission(
    s.room,
    s.session?.memberId,
    action,
    mechanics.skills,
  );
  if (denied) throw new Error(denied);
  if (s.pending) throw new Error("等待上一条命令确认");
  useApp.setState({
    pending: {
      commandId: crypto.randomUUID(),
      expectedVersion: s.room.version,
      action,
      timing,
    },
  });
  await retryPending();
}
export async function retryPending() {
  const pending = useApp.getState().pending;
  if (!pending || !socket?.connected) return;
  const result = await socket
    .timeout(5000)
    .emitWithAck("room:command", pending);
  useApp.setState({ pending: null });
  if (result.ok) {
    acceptSnapshot(result.value);
    useApp.setState({ error: "" });
  } else {
    if (result.error === "STALE_VERSION") {
      const session = useApp.getState().session;
      if (session)
        acceptSnapshot(
          unwrap(
            await socket.timeout(5000).emitWithAck("room:resume", session),
          ),
        );
    }
    throw new Error(result.error);
  }
}
export function serverNow() {
  return clockInitialized ? clock.now(performance.now()) : null;
}
