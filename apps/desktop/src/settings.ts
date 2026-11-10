import { z } from "zod";
import { SkillIdSchema, ZoneSchema, HotkeyActions } from "@kaling/shared";
export const SettingsSchema = z
  .object({
    compact: z.boolean().default(true),
    volume: z.number().min(0).max(1),
    mute: z.boolean(),
    extraZones: z.array(ZoneSchema),
    disabledSkills: z.array(SkillIdSchema),
    leads: z.record(
      SkillIdSchema,
      z.array(z.number().int().min(6).max(300)).max(8),
    ),
    conflictSeconds: z.number().min(0).max(30),
    birdPriority: z.enum(["p1_bird_scroll", "p1_bird_flight"]),
    compensationMs: z.number().int().min(0).max(3000),
    alwaysOnTop: z.boolean(),
    inputDevice: z.string(),
    outputDevice: z.string(),
    voiceConfigPath: z.string(),
    hotkeys: z.record(z.string(), z.string().max(80)),
    serverUrl: z.string(),
  })
  .strict();
export type Settings = z.infer<typeof SettingsSchema>;
export const defaults: Settings = {
  compact: true,
  volume: 0.7,
  mute: false,
  extraZones: [],
  disabledSkills: [],
  leads: Object.fromEntries(
    SkillIdSchema.options.map((id) => [id, [30, 10]]),
  ) as Settings["leads"],
  conflictSeconds: 5,
  birdPriority: "p1_bird_scroll",
  compensationMs: 1500,
  alwaysOnTop: true,
  inputDevice: "",
  outputDevice: "",
  voiceConfigPath: "",
  serverUrl: import.meta.env.VITE_SERVER_URL ?? "",
  hotkeys: {
    ...Object.fromEntries(Object.keys(HotkeyActions).map((key) => [key, ""])),
    start: "CommandOrControl+Alt+S",
    p2: "CommandOrControl+Alt+2",
    p3: "CommandOrControl+Alt+3",
    perils: "CommandOrControl+Alt+D",
    tiger: "CommandOrControl+Alt+T",
    reset: "CommandOrControl+Alt+R",
  },
};
export function readSettings(): Settings {
  try {
    const parsed = SettingsSchema.safeParse(
      JSON.parse(localStorage.getItem("kaling-settings") ?? "null"),
    );
    return parsed.success ? parsed.data : structuredClone(defaults);
  } catch {
    return structuredClone(defaults);
  }
}
export function writeSettings(settings: Settings) {
  localStorage.setItem(
    "kaling-settings",
    JSON.stringify(SettingsSchema.parse(settings)),
  );
}
