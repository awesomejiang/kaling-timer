export * from "./identifiers.js";
import type { ServerInfo } from "./identifiers.js";
export * from "./battle.js";
import type {
  Command,
  Member,
  Reply,
  RoomSnapshot,
  Session,
} from "./battle.js";
export interface ServerToClientEvents {
  "server:info": (info: ServerInfo) => void;
  "room:snapshot": (snapshot: RoomSnapshot) => void;
}
export interface ClientToServerEvents {
  "room:create": (
    input: unknown,
    reply: (
      result: Reply<{ session: Session; snapshot: RoomSnapshot }>,
    ) => void,
  ) => void;
  "room:join": (
    input: unknown,
    reply: (
      result: Reply<{ session: Session; snapshot: RoomSnapshot }>,
    ) => void,
  ) => void;
  "room:resume": (
    input: unknown,
    reply: (result: Reply<RoomSnapshot>) => void,
  ) => void;
  "room:leave": (input: unknown, reply: (result: Reply<null>) => void) => void;
  "room:assign": (
    input: unknown,
    reply: (result: Reply<RoomSnapshot>) => void,
  ) => void;
  "room:command": (
    input: Command,
    reply: (result: Reply<RoomSnapshot>) => void,
  ) => void;
  "clock:sync": (
    reply: (sample: { receivedAt: number; sentAt: number }) => void,
  ) => void;
}
export * from "./hotkeys.js";
export * from "./permissions.js";
