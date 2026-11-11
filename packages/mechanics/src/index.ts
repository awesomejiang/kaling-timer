import { z } from "zod";
import { parse } from "yaml";
import { SkillIdSchema, ZoneSchema } from "@kaling/shared";
const seconds = z.number().finite().positive();
const durations = z
  .object({ easy: seconds, normal: seconds, hard: seconds, extreme: seconds })
  .strict();
const SkillSchema = z
  .object({
    id: SkillIdSchema,
    name: z.string().min(1),
    phase: z.enum(["p1", "p2", "p3"]),
    zone: ZoneSchema.nullable(),
    mode: z.enum(["cast-based", "fixed-cycle", "manual-one-shot"]),
    cooldownSeconds: durations,
    initialDelaySeconds: z.number().finite().nonnegative().nullable(),
    startEvent: z.enum([
      "zone-start",
      "phase-start",
      "manual-trigger",
      "last-peril-death",
    ]),
  })
  .strict();
export const MechanicsSchema = z
  .object({
    version: z.string().min(1),
    skills: z.array(SkillSchema).length(SkillIdSchema.options.length),
  })
  .strict()
  .superRefine((config, ctx) => {
    const ids = new Set(config.skills.map((s) => s.id));
    if (ids.size !== SkillIdSchema.options.length)
      ctx.addIssue({
        code: "custom",
        message: "Every skill ID must occur exactly once",
      });
    for (const skill of config.skills) {
      const phase = skill.id.slice(0, 2);
      const zone = skill.id.startsWith("p1_bird")
        ? "bird"
        : skill.id.startsWith("p1_tiger")
          ? "tiger"
          : skill.id.startsWith("p1_dog")
            ? "dog"
            : null;
      const mode =
        skill.id === "p1_tiger_pillars"
          ? "manual-one-shot"
          : skill.id === "p2_kaling_minigame"
            ? "fixed-cycle"
            : "cast-based";
      const start =
        skill.id === "p3_fullscreen"
          ? "last-peril-death"
          : skill.id === "p1_tiger_pillars"
            ? "manual-trigger"
            : phase === "p1"
              ? "zone-start"
              : "phase-start";
      if (
        skill.phase !== phase ||
        skill.zone !== zone ||
        skill.mode !== mode ||
        skill.startEvent !== start
      )
        ctx.addIssue({
          code: "custom",
          message: `Invalid lifecycle for ${skill.id}`,
        });
    }
  });
export type Mechanics = z.infer<typeof MechanicsSchema>;
export function loadMechanics(source: string): Mechanics {
  return MechanicsSchema.parse(parse(source));
}
