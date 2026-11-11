import { z } from "zod";
export const DifficultySchema = z.enum(["easy", "normal", "hard", "extreme"]);
export const PhaseSchema = z.enum(["lobby", "p1", "p2", "p3"]);
export const ZoneSchema = z.enum(["bird", "tiger", "dog"]);
export const SkillIdSchema = z.enum([
  "p1_bird_scroll",
  "p1_bird_flight",
  "p1_tiger_pillars",
  "p1_dog_minigame",
  "p2_kaling_flight",
  "p2_kaling_scroll",
  "p2_kaling_minigame",
  "p3_fullscreen",
]);
export type Difficulty = z.infer<typeof DifficultySchema>;
export type SkillId = z.infer<typeof SkillIdSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type Zone = z.infer<typeof ZoneSchema>;
export const TimestampSchema = z.number().int().nonnegative();
export const ActivationSchema = z
  .object({
    at: TimestampSchema,
    status: z.enum(["predicted", "confirmed"]),
    version: z.number().int().nonnegative(),
  })
  .strict();
export const ServerInfoSchema = z
  .object({
    protocolVersion: z.literal(1),
    milestone: z.literal(6),
    mechanicsVersion: z.string().min(1),
    serverTime: TimestampSchema,
  })
  .strict();
export type ServerInfo = z.infer<typeof ServerInfoSchema>;
