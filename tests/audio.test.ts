import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { loadMechanics } from "@kaling/mechanics";
import {
  initialBattle,
  planAudio,
  ClockSync,
  type AudioPolicy,
} from "@kaling/timer-engine";
import { SkillIdSchema } from "@kaling/shared";
const mechanics = loadMechanics(
  readFileSync(new URL("../config/mechanics.yaml", import.meta.url), "utf8"),
);
const policy: AudioPolicy = {
  conflictSeconds: 5,
  birdPriority: "p1_bird_scroll",
  leadSeconds: {},
  enabled: [...SkillIdSchema.options],
};
function state(phase: "p1" | "p2", times: Record<string, number>) {
  const s = initialBattle("normal");
  s.phase = phase;
  s.battleId = "x";
  for (const [id, at] of Object.entries(times))
    s.timers[id as keyof typeof s.timers].firstAt = at;
  return s;
}
it.each([
  [10000, 13000, "p1_bird_scroll"],
  [13000, 10000, "p1_bird_flight"],
  [10000, 10000, "p1_bird_scroll"],
  [10000, 15000, "p1_bird_scroll"],
])("Bird conflict %i %i keeps %s", (scroll, flight, winner) => {
  const s = state("p1", {
    p1_bird_scroll: scroll as number,
    p1_bird_flight: flight as number,
  });
  const before = structuredClone(s);
  const cues = planAudio(s, mechanics, policy, 0, 15000);
  expect(new Set(cues.map((c) => c.skill))).toEqual(new Set([winner]));
  expect(s).toEqual(before);
});
it("announces both Bird skills outside conflict and obeys configurable tie priority", () => {
  const s = state("p1", { p1_bird_scroll: 10000, p1_bird_flight: 16000 });
  expect(
    new Set(planAudio(s, mechanics, policy, 0, 16000).map((c) => c.skill)).size,
  ).toBe(2);
  s.timers.p1_bird_flight.firstAt = 10000;
  expect(
    planAudio(
      s,
      mechanics,
      { ...policy, birdPriority: "p1_bird_flight" },
      0,
      10000,
    ).every((c) => c.skill === "p1_bird_flight"),
  ).toBe(true);
});
it("P2 suppresses preceding/equal Flight and protects complete minigame countdown", () => {
  for (const flight of [10000, 13000, 8000]) {
    const cues = planAudio(
      state("p2", { p2_kaling_flight: flight, p2_kaling_minigame: 13000 }),
      mechanics,
      policy,
      0,
      13000,
    );
    expect(cues.filter((c) => c.skill === "p2_kaling_flight")).toHaveLength(0);
    expect(
      cues
        .filter((c) => c.skill === "p2_kaling_minigame")
        .map((c) => c.seconds),
    ).toEqual([5, 4, 3, 2, 1]);
  }
});
it("P2 allows later flight only after priority countdown; never replays old numbers", () => {
  const s = state("p2", { p2_kaling_flight: 13000, p2_kaling_minigame: 10000 });
  const cues = planAudio(s, mechanics, policy, 0, 13000);
  expect(
    cues.filter((c) => c.skill === "p2_kaling_minigame").map((c) => c.seconds),
  ).toEqual([5, 4, 3, 2, 1]);
  expect(
    cues.filter((c) => c.skill === "p2_kaling_flight").map((c) => c.seconds),
  ).toEqual([3, 2, 1]);
  expect(
    planAudio(s, mechanics, policy, 11500, 13000).every((c) => c.at >= 11500),
  ).toBe(true);
});
it("P2 sufficiently early flight can announce and recalibration versions invalidate keys", () => {
  const s = state("p2", { p2_kaling_flight: 6000, p2_kaling_minigame: 13000 });
  expect(
    planAudio(s, mechanics, policy, 0, 13000).filter(
      (c) => c.skill === "p2_kaling_flight",
    ),
  ).toHaveLength(5);
  const before = planAudio(s, mechanics, policy, 0, 13000)[0].key;
  s.timers.p2_kaling_flight.version++;
  expect(planAudio(s, mechanics, policy, 0, 13000)[0].key).not.toBe(before);
});
it("synchronizes from RTT and projects on a monotonic clock", () => {
  const c = new ClockSync();
  c.sample(100, 120, 100010, 100010);
  expect(c.now(130)).toBe(100030);
  expect(c.uncertaintyMs).toBe(10);
  expect(c.sample(200, 600, 100200, 100200)).toBe(false);
  c.invalidate();
  expect(c.ready).toBe(false);
});
