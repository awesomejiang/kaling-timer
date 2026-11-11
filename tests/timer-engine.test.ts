import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { loadMechanics } from "@kaling/mechanics";
import { eventTime, type Action, type BattleState } from "@kaling/shared";
import {
  initialBattle,
  project,
  reduceBattle,
  HISTORY_LIMIT,
} from "@kaling/timer-engine";
const mechanics = loadMechanics(
  readFileSync(new URL("../config/mechanics.yaml", import.meta.url), "utf8"),
);
const apply = (s: BattleState, a: Action, at = 10000) =>
  reduceBattle(s, mechanics, a, at, "id");
const start = () => apply(initialBattle("normal"), { type: "start" });
describe("deterministic lifecycle and calibration", () => {
  it("starts all zones together, with unknown delays and idle tiger", () => {
    const s = start();
    expect(s.zoneStartAt).toEqual({ bird: 10000, tiger: 10000, dog: 10000 });
    expect(s.battleStartAt).toBe(10000);
    for (const id of Object.keys(s.timers) as (keyof typeof s.timers)[])
      expect(project(s, mechanics, id, 10000)).toBeNull();
  });
  it("zone correction preserves skill calibration, and undo restores only zone-dependent timers", () => {
    const config = structuredClone(mechanics);
    config.skills.find((s) => s.id === "p1_bird_scroll")!.initialDelaySeconds =
      12;
    let s = reduceBattle(
      initialBattle("normal"),
      config,
      { type: "start" },
      10000,
    );
    s = reduceBattle(
      s,
      config,
      { type: "calibrate", skill: "p1_bird_flight" },
      15000,
    );
    s = reduceBattle(
      s,
      config,
      { type: "calibrate-zone", zone: "bird" },
      20000,
    );
    expect(s.timers.p1_bird_scroll.firstAt).toBe(32000);
    expect(s.timers.p1_bird_flight.firstAt).toBe(35000);
    s = reduceBattle(s, config, { type: "undo-zone", zone: "bird" }, 25000);
    expect(s.timers.p1_bird_scroll.firstAt).toBe(22000);
    expect(s.timers.p1_bird_flight.firstAt).toBe(35000);
  });
  it("automatically advances predictions and reanchors a delayed actual cast without Bind state", () => {
    let s = apply(
      start(),
      { type: "calibrate", skill: "p1_bird_flight" },
      10000,
    );
    expect(project(s, mechanics, "p1_bird_flight", 75000)).toMatchObject({
      at: 90000,
      status: "predicted",
    });
    const old = s.timers.p1_bird_flight.version;
    s = apply(s, { type: "calibrate", skill: "p1_bird_flight" }, 82000);
    expect(project(s, mechanics, "p1_bird_flight", 83000)?.at).toBe(102000);
    expect(s.timers.p1_bird_flight).toMatchObject({
      confirmedAt: 82000,
      version: old + 1,
    });
  });
  it("does not repeat the manual tiger timer", () => {
    const s = apply(start(), { type: "trigger-tiger" }, 12000);
    expect(project(s, mechanics, "p1_tiger_pillars", 13000)?.at).toBe(42000);
    expect(project(s, mechanics, "p1_tiger_pillars", 42001)).toBeNull();
    expect(
      project(
        apply(s, { type: "trigger-tiger" }, 50000),
        mechanics,
        "p1_tiger_pillars",
        51000,
      )?.at,
    ).toBe(80000);
  });
  it("keeps P2 fixed minigame independent from flight", () => {
    let s = apply(start(), { type: "phase", phase: "p2" });
    s = apply(s, { type: "calibrate", skill: "p2_kaling_minigame" }, 10000);
    const before = structuredClone(s.timers.p2_kaling_minigame);
    s = apply(s, { type: "calibrate", skill: "p2_kaling_flight" }, 32000);
    expect(s.timers.p2_kaling_minigame).toEqual(before);
    expect(project(s, mechanics, "p2_kaling_minigame", 71000)?.at).toBe(130000);
  });
  it("anchors the P2 scroll cooldown to each confirmed cast", () => {
    const skill = "p2_kaling_scroll";
    const p2 = apply(start(), { type: "phase", phase: "p2" });
    expect(project(p2, mechanics, skill, 11000)).toBeNull();
    const first = apply(p2, { type: "calibrate", skill }, 12000);
    expect(project(first, mechanics, skill, 13000)?.at).toBe(42000);
    const next = apply(first, { type: "calibrate", skill }, 47000);
    expect(project(next, mechanics, skill, 48000)?.at).toBe(77000);
  });
  it("interprets remaining seconds at spoken time, compensates once, and undoes from absolute history", () => {
    const ref = eventTime(
      {
        source: "voice",
        recognizedAt: 11500,
        onsetAt: null,
        compensationMs: 1500,
      },
      11550,
    );
    let s = apply(
      start(),
      { type: "calibrate", skill: "p1_dog_minigame", remainingSeconds: 50 },
      ref,
    );
    expect(project(s, mechanics, "p1_dog_minigame", 11500)!.at - 11500).toBe(
      48500,
    );
    s = apply(
      s,
      { type: "shift", skill: "p1_dog_minigame", seconds: 5 },
      20000,
    );
    s = apply(s, { type: "undo-skill", skill: "p1_dog_minigame" }, 250000);
    expect(project(s, mechanics, "p1_dog_minigame", 250000)?.at).toBe(300000);
    expect(
      eventTime(
        {
          source: "voice",
          recognizedAt: 11500,
          onsetAt: 10000,
          compensationMs: 1500,
        },
        11550,
      ),
    ).toBe(10000);
    expect(eventTime({ source: "button" }, 11550)).toBe(11550);
    expect(() =>
      eventTime(
        {
          source: "voice",
          recognizedAt: 11500,
          onsetAt: 12000,
          compensationMs: 1500,
        },
        11550,
      ),
    ).toThrow();
  });
  it("retains at least ten undo entries and increases versions even on undo/reset", () => {
    let s = start();
    for (let n = 0; n < 40; n++)
      s = apply(
        s,
        { type: "calibrate", skill: "p1_bird_flight" },
        10000 + n * 1000,
      );
    expect(s.timers.p1_bird_flight.history).toHaveLength(HISTORY_LIMIT);
    const version = s.timers.p1_bird_flight.version;
    s = apply(s, { type: "undo-skill", skill: "p1_bird_flight" });
    expect(s.timers.p1_bird_flight.version).toBeGreaterThan(version);
    expect(
      apply(s, { type: "reset" }).timers.p1_bird_flight.version,
    ).toBeGreaterThan(s.timers.p1_bird_flight.version);
  });
  it.each([
    ["easy", 60],
    ["normal", 60],
    ["hard", 30],
    ["extreme", 30],
  ] as const)("P3 waits for last death on %s", (difficulty, seconds) => {
    let s = apply(initialBattle(difficulty), { type: "start" });
    s = apply(s, { type: "phase", phase: "p2" });
    s = apply(s, { type: "phase", phase: "p3" });
    expect(project(s, mechanics, "p3_fullscreen", 11000)).toBeNull();
    expect(() =>
      apply(s, { type: "calibrate", skill: "p3_fullscreen" }),
    ).toThrow("LAST_PERIL");
    s = apply(s, { type: "last-peril-death" }, 20000);
    expect(project(s, mechanics, "p3_fullscreen", 21000)?.at).toBe(
      20000 + seconds * 1000,
    );
    expect(s.timers.p3_fullscreen.basis).toBe("last-peril-reference");
    expect(() => apply(s, { type: "last-peril-death" })).toThrow(
      "ALREADY_STARTED",
    );
  });
  it("locks difficulty during battle and rejects out-of-phase actions", () => {
    expect(() =>
      apply(start(), { type: "difficulty", difficulty: "hard" }),
    ).toThrow();
    expect(() => apply(start(), { type: "phase", phase: "p3" })).toThrow();
    expect(() =>
      apply(start(), { type: "calibrate", skill: "p2_kaling_flight" }),
    ).toThrow();
  });
});
