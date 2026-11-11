import { z } from "zod";
import { SkillIdSchema, HotkeyActions } from "@kaling/shared";
export const SettingsSchema = z
  .object({
    compact: z.boolean().default(true),
    volume: z.number().min(0).max(1),
    mute: z.boolean(),
    remindersEnabled: z.boolean().default(true),
    voiceEnabled: z.boolean().default(true),
    overlayEnabled: z.boolean().default(true),
    overlayLocked: z.boolean().default(false),
    overlayOpacity: z.number().min(0.15).max(1).default(0.8),
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
    hotkeysOptInVersion: z.literal(1).default(1),
    serverUrl: z.string(),
  })
  .strict();
export type Settings = z.infer<typeof SettingsSchema>;
export const defaults: Settings = {
  compact: true,
  volume: 0.7,
  mute: false,
  remindersEnabled: true,
  voiceEnabled: true,
  overlayEnabled: true,
  overlayLocked: false,
  overlayOpacity: 0.8,
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
  hotkeys: Object.fromEntries(
    Object.keys(HotkeyActions).map((key) => [key, ""]),
  ),
  hotkeysOptInVersion: 1,
};
export function readSettings(): Settings {
  try {
    const stored = JSON.parse(
      localStorage.getItem("kaling-settings") ?? "null",
    );
    // Retire this field without discarding the user's other saved preferences.
    let migratedHotkeys = false;
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      delete stored.extraZones;
      if (
        stored.leads &&
        typeof stored.leads === "object" &&
        !Array.isArray(stored.leads)
      )
        stored.leads.p2_kaling_scroll ??= defaults.leads.p2_kaling_scroll;
      if (stored.hotkeysOptInVersion === undefined) {
        stored.hotkeys = { ...defaults.hotkeys };
        stored.hotkeysOptInVersion = 1;
        migratedHotkeys = true;
      }
    }
    const parsed = SettingsSchema.safeParse(stored);
    if (parsed.success && migratedHotkeys) {
      try {
        writeSettings(parsed.data);
      } catch {
        /* Keep usable settings if storage is unavailable. */
      }
    }
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
