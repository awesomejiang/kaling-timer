import type { BattleState } from "@kaling/shared";
import type { Mechanics } from "@kaling/mechanics";
import { planAudio, type AudioPolicy, type Cue } from "./audio.js";
export interface ClipDriver {
  durationMs(cue: Cue): number | null;
  schedule(cue: Cue, delayMs: number): () => void;
}
// Hardware-independent scheduler. Call from a short lookahead loop using synchronized
// monotonic time. Late cues/collisions are dropped; nothing is queued for replay.
export class AudioScheduler {
  private active = new Map<
    string,
    { cue: Cue; until: number; cancel: () => void }
  >();
  private played = new Set<string>();
  maxLatenessMs = 0;
  constructor(private driver: ClipDriver) {}
  stop() {
    for (const item of this.active.values()) item.cancel();
    this.active.clear();
  }
  busy(now: number) {
    return [...this.active.values()].some((item) => item.until > now);
  }
  update(
    state: BattleState,
    mechanics: Mechanics,
    policy: AudioPolicy,
    now: number,
  ) {
    const cues = planAudio(state, mechanics, policy, now - 5000, now + 5000),
      valid = new Set(cues.map((c) => c.key));
    for (const [key, item] of this.active) {
      if (!valid.has(key)) {
        item.cancel();
        this.active.delete(key);
      } else if (item.until < now) this.active.delete(key);
    }
    for (const cue of cues) {
      if (this.played.has(cue.key) || cue.at < now - 80 || cue.at > now + 120)
        continue;
      const duration = this.driver.durationMs(cue);
      if (duration === null) continue;
      // A newly calibrated high-priority countdown may need to preempt a lead
      // clip that started before its new deadline was known.
      for (const [key, item] of this.active) {
        if (
          cue.priority < item.cue.priority &&
          cue.at < item.until &&
          cue.at + duration > item.cue.at
        ) {
          item.cancel();
          this.active.delete(key);
        }
      }
      if (
        [...this.active.values()].some(
          (item) => cue.at < item.until && cue.at + duration > item.cue.at,
        )
      )
        continue;
      // Reserve future higher-priority countdowns before beginning long lead clips.
      if (
        cues.some(
          (other) =>
            other.at >= cue.at &&
            other.key !== cue.key &&
            other.priority < cue.priority &&
            other.at < cue.at + duration,
        )
      )
        continue;
      const cancel = this.driver.schedule(cue, Math.max(0, cue.at - now));
      this.active.set(cue.key, { cue, until: cue.at + duration + 20, cancel });
      this.played.add(cue.key);
      this.maxLatenessMs = Math.max(
        this.maxLatenessMs,
        Math.max(0, now - cue.at),
      );
    }
    if (this.played.size > 5000)
      this.played = new Set([...this.played].slice(-2500));
  }
}
