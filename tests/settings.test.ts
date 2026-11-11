import { afterEach, expect, it, vi } from "vitest";
import {
  defaults,
  readSettings,
  writeSettings,
} from "../apps/desktop/src/settings.js";

afterEach(() => vi.unstubAllGlobals());

it("defaults local reminders and voice on while preserving an explicit off choice", () => {
  const { remindersEnabled, voiceEnabled, ...legacy } = defaults;
  let stored = JSON.stringify(legacy);
  vi.stubGlobal("localStorage", {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {
      stored = value;
    },
  });
  expect(readSettings()).toMatchObject({
    remindersEnabled: true,
    voiceEnabled: true,
  });
  writeSettings({
    ...readSettings(),
    remindersEnabled: false,
    voiceEnabled: false,
  });
  expect(readSettings()).toMatchObject({
    remindersEnabled: false,
    voiceEnabled: false,
  });
});

it("clears legacy bindings once and preserves later opt-in bindings", () => {
  const { hotkeysOptInVersion, ...legacy } = defaults;
  let stored = JSON.stringify({
    ...legacy,
    volume: 0.3,
    hotkeys: {
      start: "CommandOrControl+Alt+S",
      reset: "CommandOrControl+Alt+Shift+R",
    },
  });
  vi.stubGlobal("localStorage", {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {
      stored = value;
    },
  });
  const migrated = readSettings();
  expect(
    Object.values(migrated.hotkeys).every((binding) => binding === ""),
  ).toBe(true);
  expect(migrated.volume).toBe(0.3);
  expect(JSON.parse(stored).hotkeysOptInVersion).toBe(1);
  writeSettings({
    ...migrated,
    hotkeys: { ...migrated.hotkeys, start: "CommandOrControl+Shift+F8" },
  });
  expect(readSettings().hotkeys.start).toBe("CommandOrControl+Shift+F8");
});

it("removes retired cross-zone subscriptions while preserving other local settings", () => {
  let stored = JSON.stringify({
    ...defaults,
    volume: 0.3,
    inputDevice: "my-mic",
    extraZones: ["bird", "dog"],
  });
  vi.stubGlobal("localStorage", {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {
      stored = value;
    },
  });
  const settings = readSettings();
  expect(settings.volume).toBe(0.3);
  expect(settings.inputDevice).toBe("my-mic");
  expect(settings).not.toHaveProperty("extraZones");
  writeSettings(settings);
  expect(JSON.parse(stored)).not.toHaveProperty("extraZones");
});
