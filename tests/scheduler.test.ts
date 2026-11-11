import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
import { loadMechanics } from "@kaling/mechanics";
import {
  initialBattle,
  AudioScheduler,
  type AudioPolicy,
  type Cue,
} from "@kaling/timer-engine";
import { SkillIdSchema } from "@kaling/shared";
const config = loadMechanics(
  readFileSync(new URL("../config/mechanics.yaml", import.meta.url), "utf8"),
);
const policy: AudioPolicy = {
  conflictSeconds: 5,
  birdPriority: "p1_bird_scroll",
  leadSeconds: {},
  enabled: [...SkillIdSchema.options],
};
function fixture() {
  const played: { cue: Cue; delay: number; cancelled: boolean }[] = [];
  const scheduler = new AudioScheduler({
    durationMs: (c) => (c.seconds <= 5 ? 500 : 2500),
    schedule: (cue, delay) => {
      const item = { cue, delay, cancelled: false };
      played.push(item);
      return () => {
        item.cancelled = true;
      };
    },
  });
  return { played, scheduler };
}
it("schedules all five numbers exactly once without overlapping, and drops expired numbers", () => {
  const s = initialBattle("normal");
  s.phase = "p2";
  s.battleId = "x";
  s.timers.p2_kaling_minigame.firstAt = 10000;
  const { scheduler, played } = fixture();
  for (let now = 0; now <= 10000; now += 25)
    scheduler.update(s, config, policy, now);
  expect(played.map((x) => x.cue.seconds)).toEqual([5, 4, 3, 2, 1]);
  expect(played.every((x) => x.delay >= 0 && x.delay <= 120)).toBe(true);
  expect(scheduler.maxLatenessMs).toBe(0);
  const late = fixture();
  late.scheduler.update(s, config, policy, 5600);
  expect(late.played).toHaveLength(0);
  late.scheduler.update(s, config, policy, 6100);
  expect(late.played).toHaveLength(0);
  late.scheduler.update(s, config, policy, 7000);
  expect(late.played.map((x) => x.cue.seconds)).toEqual([3]);
});
it("cancels obsolete skill-version audio while preserving independent minigame audio", () => {
  const s = initialBattle("normal");
  s.phase = "p2";
  s.battleId = "x";
  s.timers.p2_kaling_minigame.firstAt = 10000;
  s.timers.p2_kaling_flight.firstAt = 13000;
  const { scheduler, played } = fixture();
  scheduler.update(s, config, policy, 4900);
  expect(played).toHaveLength(1);
  expect(played[0].cue.skill).toBe("p2_kaling_minigame");
  s.timers.p2_kaling_flight.version++;
  scheduler.update(s, config, policy, 4950);
  expect(played[0].cancelled).toBe(false);
  s.timers.p2_kaling_minigame.version++;
  s.timers.p2_kaling_minigame.firstAt = 20000;
  scheduler.update(s, config, policy, 4975);
  expect(played[0].cancelled).toBe(true);
});
it("reserves a priority countdown before a long flight lead clip, and cancels on reset/phase/stop", () => {
  const s = initialBattle("normal");
  s.phase = "p2";
  s.battleId = "x";
  s.timers.p2_kaling_minigame.firstAt = 10000;
  s.timers.p2_kaling_flight.firstAt = 24000;
  const p = { ...policy, leadSeconds: { p2_kaling_flight: [20] } };
  const { scheduler, played } = fixture();
  scheduler.update(s, config, p, 3900);
  expect(played).toHaveLength(0);
  scheduler.update(s, config, p, 4900);
  expect(played).toHaveLength(1);
  s.phase = "p3";
  scheduler.update(s, config, p, 4950);
  expect(played[0].cancelled).toBe(true);
  s.phase = "p2";
  s.timers.p2_kaling_minigame.version++;
  scheduler.update(s, config, p, 4950);
  scheduler.stop();
  expect(played.every((x) => x.cancelled)).toBe(true);
});

it("preempts an already playing lower-priority lead when minigame is newly calibrated", () => {
  const s = initialBattle("normal");
  s.phase = "p2";
  s.battleId = "x";
  s.timers.p2_kaling_flight.firstAt = 24000;
  const p = { ...policy, leadSeconds: { p2_kaling_flight: [20] } };
  const { scheduler, played } = fixture();
  scheduler.update(s, config, p, 3900);
  expect(played).toHaveLength(1);
  expect(played[0].cue.skill).toBe("p2_kaling_flight");
  s.timers.p2_kaling_minigame.firstAt = 10000;
  s.timers.p2_kaling_minigame.version++;
  scheduler.update(s, config, p, 4900);
  expect(played[0].cancelled).toBe(true);
  expect(played[1].cue).toMatchObject({
    skill: "p2_kaling_minigame",
    seconds: 5,
  });
});
