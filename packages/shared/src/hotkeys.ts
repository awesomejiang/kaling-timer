import { SkillIdSchema, ZoneSchema } from "./identifiers.js";
import type { Action } from "./battle.js";
export const HotkeyActions: Record<string, Action> = {
  start: { type: "start" },
  p2: { type: "phase", phase: "p2" },
  p3: { type: "phase", phase: "p3" },
  perils: { type: "last-peril-death" },
  tiger: { type: "trigger-tiger" },
  reset: { type: "reset" },
};
for (const skill of SkillIdSchema.options) {
  if (skill !== "p1_tiger_pillars")
    HotkeyActions[`cast:${skill}`] = { type: "calibrate", skill };
  HotkeyActions[`undo:${skill}`] = { type: "undo-skill", skill };
}
for (const zone of ZoneSchema.options) {
  HotkeyActions[`zone:${zone}`] = { type: "calibrate-zone", zone };
  HotkeyActions[`undo-zone:${zone}`] = { type: "undo-zone", zone };
}
