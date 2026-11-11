import { z } from "zod";
import {
  DifficultySchema,
  SkillIdSchema,
  TimestampSchema,
  ZoneSchema,
} from "./identifiers.js";
const version = z.number().int().nonnegative();
export const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }).strict(),
  z.object({ type: z.literal("reset") }).strict(),
  z.object({ type: z.literal("phase"), phase: z.enum(["p2", "p3"]) }).strict(),
  z.object({ type: z.literal("start-p2") }).strict(),
  z.object({ type: z.literal("enter-zone"), zone: ZoneSchema }).strict(),
  z.object({ type: z.literal("last-peril-death") }).strict(),
  z.object({ type: z.literal("trigger-tiger") }).strict(),
  z
    .object({ type: z.literal("difficulty"), difficulty: DifficultySchema })
    .strict(),
  z
    .object({
      type: z.literal("calibrate"),
      skill: SkillIdSchema,
      remainingSeconds: z.number().finite().min(0).max(3600).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("shift"),
      skill: SkillIdSchema,
      seconds: z.number().finite().min(-300).max(300),
    })
    .strict(),
  z.object({ type: z.literal("undo-skill"), skill: SkillIdSchema }).strict(),
  z.object({ type: z.literal("calibrate-zone"), zone: ZoneSchema }).strict(),
  z.object({ type: z.literal("undo-zone"), zone: ZoneSchema }).strict(),
]);
export type Action = z.infer<typeof ActionSchema>;
export const TimingSchema = z.discriminatedUnion("source", [
  z.object({ source: z.enum(["button", "hotkey"]) }).strict(),
  z
    .object({
      source: z.literal("voice"),
      recognizedAt: TimestampSchema,
      onsetAt: TimestampSchema.nullable(),
      compensationMs: z.number().int().min(0).max(3000),
    })
    .strict(),
]);
export type InputTiming = z.infer<typeof TimingSchema>;
export const CommandSchema = z
  .object({
    commandId: z.string().uuid(),
    expectedVersion: version,
    action: ActionSchema,
    timing: TimingSchema,
  })
  .strict();
export type Command = z.infer<typeof CommandSchema>;
export interface TimerReference {
  firstAt: number | null;
  confirmedAt: number | null;
  calibrated: boolean;
  basis:
    | "unconfigured"
    | "configured"
    | "observed-cast"
    | "remaining"
    | "shift"
    | "last-peril-reference"
    | "manual";
}
export interface TimerState extends TimerReference {
  version: number;
  history: TimerReference[];
}
export interface BattleState {
  battleId: string | null;
  phase: "lobby" | "p1" | "p2" | "p3";
  difficulty: z.infer<typeof DifficultySchema>;
  battleStartAt: number | null;
  phaseStartAt: number | null;
  lastPerilDeathAt: number | null;
  zoneStartAt: Record<z.infer<typeof ZoneSchema>, number | null>;
  zoneHistory: Record<z.infer<typeof ZoneSchema>, (number | null)[]>;
  timers: Record<z.infer<typeof SkillIdSchema>, TimerState>;
}
export interface Member {
  id: string;
  name: string;
  zone: z.infer<typeof ZoneSchema> | null;
}
export interface LogEntry {
  at: number;
  version: number;
  memberId: string;
  action: Action;
  eventAt: number;
}
export interface RoomSnapshot {
  code: string;
  hostId: string;
  version: number;
  mechanicsVersion: string;
  battle: BattleState;
  members: Member[];
  log: LogEntry[];
}
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string };
export interface Session {
  code: string;
  memberId: string;
  token: string;
}
export const CreateRoomSchema = z
  .object({
    commandId: z.string().uuid(),
    token: z.string().regex(/^[a-f0-9]{64}$/),
    name: z.string().trim().min(1).max(24),
    password: z.string().max(128).default(""),
    difficulty: DifficultySchema,
  })
  .strict();
export const JoinRoomSchema = z
  .object({
    commandId: z.string().uuid(),
    token: z.string().regex(/^[a-f0-9]{64}$/),
    code: z.string().regex(/^[A-Z2-9]{6}$/),
    name: z.string().trim().min(1).max(24),
    password: z.string().max(128).default(""),
  })
  .strict();
export const ResumeSchema = z
  .object({
    code: z.string().regex(/^[A-Z2-9]{6}$/),
    memberId: z.string().uuid(),
    token: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const AssignmentSchema = z
  .object({
    commandId: z.string().uuid(),
    expectedVersion: version,
    zone: ZoneSchema.nullable(),
  })
  .strict();
export function eventTime(timing: InputTiming, receivedAt: number): number {
  if (timing.source !== "voice") return receivedAt;
  const ref = timing.onsetAt ?? timing.recognizedAt - timing.compensationMs;
  if (timing.onsetAt !== null && timing.onsetAt > timing.recognizedAt)
    throw new Error("INVALID_EVENT_TIME");
  if (
    ref < receivedAt - 30_000 ||
    ref > receivedAt + 250 ||
    timing.recognizedAt > receivedAt + 250
  )
    throw new Error("INVALID_EVENT_TIME");
  return Math.round(ref);
}
const ReferenceSchema = z
  .object({
    firstAt: TimestampSchema.nullable(),
    confirmedAt: TimestampSchema.nullable(),
    calibrated: z.boolean(),
    basis: z.enum([
      "unconfigured",
      "configured",
      "observed-cast",
      "remaining",
      "shift",
      "last-peril-reference",
      "manual",
    ]),
  })
  .strict();
const TimerStateSchema = ReferenceSchema.extend({
  version,
  history: z.array(ReferenceSchema).max(32),
}).strict();
export const BattleStateSchema = z
  .object({
    battleId: z.string().nullable(),
    phase: z.enum(["lobby", "p1", "p2", "p3"]),
    difficulty: DifficultySchema,
    battleStartAt: TimestampSchema.nullable(),
    phaseStartAt: TimestampSchema.nullable(),
    lastPerilDeathAt: TimestampSchema.nullable(),
    zoneStartAt: z.record(ZoneSchema, TimestampSchema.nullable()),
    zoneHistory: z.record(
      ZoneSchema,
      z.array(TimestampSchema.nullable()).max(32),
    ),
    timers: z.record(SkillIdSchema, TimerStateSchema),
  })
  .strict();
export const RoomSnapshotSchema = z
  .object({
    code: z.string().regex(/^[A-Z2-9]{6}$/),
    hostId: z.string().uuid(),
    version,
    mechanicsVersion: z.string().min(1),
    battle: BattleStateSchema,
    members: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            name: z.string().min(1).max(24),
            zone: ZoneSchema.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(6),
    log: z
      .array(
        z
          .object({
            at: TimestampSchema,
            version,
            memberId: z.string().uuid(),
            action: ActionSchema,
            eventAt: TimestampSchema,
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
