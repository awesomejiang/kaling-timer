import type { BattleState, SkillId } from "@kaling/shared";
import type { Mechanics } from "@kaling/mechanics";
export interface AudioPolicy {
  conflictSeconds: number;
  birdPriority: "p1_bird_scroll" | "p1_bird_flight";
  leadSeconds: Partial<Record<SkillId, number[]>>;
  enabled: SkillId[];
}
export interface Cue {
  key: string;
  skill: SkillId;
  activationAt: number;
  at: number;
  seconds: number;
  priority: number;
}
interface Cycle {
  skill: SkillId;
  at: number;
  version: number;
}
// Pure enumeration: notifications never mutate the underlying timer timelines.
export function planAudio(
  state: BattleState,
  mechanics: Mechanics,
  policy: AudioPolicy,
  from: number,
  to: number,
): Cue[] {
  const conflict = policy.conflictSeconds * 1000;
  const maxLead =
    Math.max(5, ...Object.values(policy.leadSeconds).flatMap((x) => x ?? [])) *
    1000;
  const cycles: Cycle[] = [];
  for (const config of mechanics.skills.filter(
    (s) => s.phase === state.phase,
  )) {
    const t = state.timers[config.id];
    if (t.firstAt === null) continue;
    const cooldown = config.cooldownSeconds[state.difficulty] * 1000;
    const first =
      config.mode === "manual-one-shot"
        ? 0
        : Math.max(0, Math.ceil((from - conflict - t.firstAt) / cooldown));
    for (let n = first; ; n++) {
      const at = t.firstAt + n * cooldown;
      if (at > to + maxLead + conflict) break;
      if (at >= from - conflict)
        cycles.push({ skill: config.id, at, version: t.version });
      if (config.mode === "manual-one-shot") break;
    }
  }
  const suppressed = (cycle: Cycle) =>
    cycles.some((other) => {
      const bird =
        (cycle.skill === "p1_bird_scroll" &&
          other.skill === "p1_bird_flight") ||
        (cycle.skill === "p1_bird_flight" && other.skill === "p1_bird_scroll");
      if (bird && Math.abs(cycle.at - other.at) <= conflict)
        return (
          cycle.at > other.at ||
          (cycle.at === other.at && cycle.skill !== policy.birdPriority)
        );
      return (
        cycle.skill === "p2_kaling_flight" &&
        other.skill === "p2_kaling_minigame" &&
        cycle.at <= other.at &&
        other.at - cycle.at <= conflict
      );
    });
  // Reserve the whole last-five countdown for P2 minigame even when locally unsubscribed.
  const minigames = cycles.filter((c) => c.skill === "p2_kaling_minigame");
  const cues: Cue[] = [];
  for (const cycle of cycles) {
    if (!policy.enabled.includes(cycle.skill) || suppressed(cycle)) continue;
    const seconds = new Set([
      5,
      4,
      3,
      2,
      1,
      ...(policy.leadSeconds[cycle.skill] ?? []),
    ]);
    for (const second of seconds) {
      const at = cycle.at - second * 1000;
      if (at < from || at > to) continue;
      if (
        cycle.skill === "p2_kaling_flight" &&
        minigames.some((m) => at >= m.at - 5000 && at < m.at)
      )
        continue;
      const key = `${state.battleId}:${state.phase}:${cycle.skill}:${cycle.version}:${cycle.at}:${second}`;
      cues.push({
        key,
        skill: cycle.skill,
        activationAt: cycle.at,
        at,
        seconds: second,
        priority:
          cycle.skill === "p2_kaling_minigame" ? 0 : second <= 5 ? 1 : 2,
      });
    }
  }
  return cues.sort(
    (a, b) =>
      a.at - b.at || a.priority - b.priority || a.skill.localeCompare(b.skill),
  );
}
export class ClockSync {
  private baseServer = 0;
  private baseMono = 0;
  private bestRtt = Infinity;
  get uncertaintyMs() {
    return this.bestRtt / 2;
  }
  get ready() {
    return Number.isFinite(this.bestRtt);
  }
  sample(
    sentMono: number,
    receivedMono: number,
    receivedAt: number,
    sentAt: number,
  ) {
    const rtt = Math.max(0, receivedMono - sentMono - (sentAt - receivedAt));
    if (rtt <= this.bestRtt + 2) {
      this.bestRtt = rtt;
      this.baseServer = sentAt + rtt / 2;
      this.baseMono = receivedMono;
      return true;
    }
    return false;
  }
  now(mono: number) {
    return this.baseServer + (mono - this.baseMono);
  }
  invalidate() {
    this.bestRtt = Infinity;
  }
}
