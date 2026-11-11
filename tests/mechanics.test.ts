import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadMechanics, MechanicsSchema } from "@kaling/mechanics";
import { ActivationSchema, ServerInfoSchema } from "@kaling/shared";
const source = readFileSync(
  new URL("../config/mechanics.yaml", import.meta.url),
  "utf8",
);
const config = loadMechanics(source);
describe("PRD mechanics configuration", () => {
  it.each([
    ["p1_bird_scroll", 60, 60],
    ["p1_bird_flight", 20, 18],
    ["p1_tiger_pillars", 30, 30],
    ["p1_dog_minigame", 60, 60],
    ["p2_kaling_flight", 18, 18],
    ["p2_kaling_scroll", 30, 30],
    ["p2_kaling_minigame", 60, 60],
    ["p3_fullscreen", 60, 30],
  ])("%s has all four difficulty values", (id, en, hx) => {
    expect(config.skills.find((s) => s.id === id)?.cooldownSeconds).toEqual({
      easy: en,
      normal: en,
      hard: hx,
      extreme: hx,
    });
  });
  it("keeps unknown initial delays explicit", () => {
    expect(config.skills.every((s) => s.initialDelaySeconds === null)).toBe(
      true,
    );
  });
  it("requires explicit tiger and last-peril events and fixed P2 minigame", () => {
    expect(
      config.skills.find((s) => s.id === "p1_tiger_pillars"),
    ).toMatchObject({ mode: "manual-one-shot", startEvent: "manual-trigger" });
    expect(
      config.skills.find((s) => s.id === "p3_fullscreen")?.startEvent,
    ).toBe("last-peril-death");
    expect(config.skills.find((s) => s.id === "p2_kaling_minigame")?.mode).toBe(
      "fixed-cycle",
    );
  });
  it("rejects duplicate/missing/unknown IDs and invalid lifecycle", () => {
    const duplicate = structuredClone(config);
    duplicate.skills[1] = duplicate.skills[0];
    expect(MechanicsSchema.safeParse(duplicate).success).toBe(false);
    expect(
      MechanicsSchema.safeParse({ ...config, skills: config.skills.slice(1) })
        .success,
    ).toBe(false);
    expect(() =>
      loadMechanics(source.replace("p1_bird_scroll", "unknown")),
    ).toThrow();
    expect(() =>
      loadMechanics(source.replace("last-peril-death", "phase-start")),
    ).toThrow();
  });
  it("rejects invalid durations, missing initial delays and extra fields", () => {
    for (const value of [-1, 0, Infinity, NaN]) {
      const bad = structuredClone(config);
      bad.skills[0].cooldownSeconds.easy = value;
      expect(MechanicsSchema.safeParse(bad).success).toBe(false);
    }
    expect(() =>
      loadMechanics(source.replace("    initialDelaySeconds: null\n", "")),
    ).toThrow();
    expect(
      MechanicsSchema.safeParse({ ...config, surprise: true }).success,
    ).toBe(false);
  });
});
it("distinguishes predictions from confirmations in the contract", () => {
  expect(
    ActivationSchema.parse({ at: 1000, status: "predicted", version: 1 })
      .status,
  ).toBe("predicted");
  expect(ActivationSchema.safeParse({ at: 1000, version: 1 }).success).toBe(
    false,
  );
  expect(
    ServerInfoSchema.safeParse({
      protocolVersion: 2,
      milestone: 1,
      mechanicsVersion: "1",
      serverTime: 0,
    }).success,
  ).toBe(false);
});
