import {
  SkillIdSchema,
  type Action,
  type BattleState,
  type Difficulty,
  type SkillId,
  type TimerReference,
  type TimerState,
  type Zone,
} from "@kaling/shared";
import type { Mechanics } from "@kaling/mechanics";
export const HISTORY_LIMIT = 32;
const blank = (): TimerState => ({
  firstAt: null,
  confirmedAt: null,
  calibrated: false,
  basis: "unconfigured",
  version: 0,
  history: [],
});
export function initialBattle(difficulty: Difficulty): BattleState {
  return {
    battleId: null,
    phase: "lobby",
    difficulty,
    battleStartAt: null,
    phaseStartAt: null,
    lastPerilDeathAt: null,
    zoneStartAt: { bird: null, tiger: null, dog: null },
    zoneHistory: { bird: [], tiger: [], dog: [] },
    timers: Object.fromEntries(
      SkillIdSchema.options.map((id) => [id, blank()]),
    ) as BattleState["timers"],
  };
}
export interface Projection {
  at: number;
  cycle: number;
  status: "predicted" | "manual";
  version: number;
}
export function project(
  state: BattleState,
  mechanics: Mechanics,
  id: SkillId,
  now: number,
): Projection | null {
  const config = mechanics.skills.find((s) => s.id === id)!;
  const timer = state.timers[id];
  if (state.phase !== config.phase || timer.firstAt === null) return null;
  if (config.mode === "manual-one-shot")
    return now > timer.firstAt
      ? null
      : {
          at: timer.firstAt,
          cycle: 0,
          status: "manual",
          version: timer.version,
        };
  const cooldown = config.cooldownSeconds[state.difficulty] * 1000;
  const cycle = Math.max(0, Math.ceil((now - timer.firstAt) / cooldown));
  return {
    at: timer.firstAt + cycle * cooldown,
    cycle,
    status: "predicted",
    version: timer.version,
  };
}
function reference(t: TimerReference): TimerReference {
  return {
    firstAt: t.firstAt,
    confirmedAt: t.confirmedAt,
    calibrated: t.calibrated,
    basis: t.basis,
  };
}
function save(t: TimerState) {
  t.history.push(reference(t));
  t.history = t.history.slice(-HISTORY_LIMIT);
  t.version++;
}
function requirePhase(state: BattleState, phase: BattleState["phase"]) {
  if (state.phase !== phase) throw new Error("WRONG_PHASE");
}
function rezone(state: BattleState, mechanics: Mechanics, zone: Zone) {
  for (const s of mechanics.skills.filter(
    (s) => s.zone === zone && s.mode !== "manual-one-shot",
  )) {
    const t = state.timers[s.id];
    if (t.calibrated) continue;
    t.firstAt =
      s.initialDelaySeconds === null || state.zoneStartAt[zone] === null
        ? null
        : state.zoneStartAt[zone]! + s.initialDelaySeconds * 1000;
    t.basis = t.firstAt === null ? "unconfigured" : "configured";
    t.version++;
  }
}
export function reduceBattle(
  previous: BattleState,
  mechanics: Mechanics,
  action: Action,
  at: number,
  battleId = "battle",
): BattleState {
  const state = structuredClone(previous);
  if (action.type === "difficulty") {
    requirePhase(state, "lobby");
    state.difficulty = action.difficulty;
    return state;
  }
  if (action.type === "reset") {
    const reset = initialBattle(state.difficulty);
    for (const id of SkillIdSchema.options)
      reset.timers[id].version = state.timers[id].version + 1;
    return reset;
  }
  if (action.type === "start") {
    requirePhase(state, "lobby");
    state.phase = "p1";
    state.battleId = battleId;
    state.battleStartAt = at;
    state.phaseStartAt = at;
    for (const zone of ["bird", "tiger", "dog"] as const) {
      state.zoneStartAt[zone] = at;
      rezone(state, mechanics, zone);
    }
    return state;
  }
  if (action.type === "phase") {
    requirePhase(state, action.phase === "p2" ? "p1" : "p2");
    state.phase = action.phase;
    state.phaseStartAt = at;
    for (const config of mechanics.skills.filter(
      (s) => s.phase === action.phase,
    )) {
      const t = state.timers[config.id];
      t.version++;
      if (
        config.startEvent === "phase-start" &&
        config.initialDelaySeconds !== null
      ) {
        t.firstAt = at + config.initialDelaySeconds * 1000;
        t.basis = "configured";
      }
    }
    return state;
  }
  if (action.type === "last-peril-death") {
    requirePhase(state, "p3");
    if (state.lastPerilDeathAt !== null) throw new Error("ALREADY_STARTED");
    state.lastPerilDeathAt = at;
    const config = mechanics.skills.find((s) => s.id === "p3_fullscreen")!;
    const t = state.timers.p3_fullscreen;
    t.version++;
    t.firstAt =
      at +
      (config.initialDelaySeconds ?? config.cooldownSeconds[state.difficulty]) *
        1000;
    t.basis =
      config.initialDelaySeconds === null
        ? "last-peril-reference"
        : "configured";
    return state;
  }
  if (action.type === "calibrate-zone" || action.type === "undo-zone") {
    requirePhase(state, "p1");
    const history = state.zoneHistory[action.zone];
    if (action.type === "calibrate-zone") {
      history.push(state.zoneStartAt[action.zone]);
      state.zoneHistory[action.zone] = history.slice(-HISTORY_LIMIT);
      state.zoneStartAt[action.zone] = at;
    } else {
      if (!history.length) throw new Error("NO_HISTORY");
      state.zoneStartAt[action.zone] = history.pop()!;
    }
    rezone(state, mechanics, action.zone);
    return state;
  }
  const id =
    action.type === "trigger-tiger" ? "p1_tiger_pillars" : action.skill;
  const config = mechanics.skills.find((s) => s.id === id)!;
  requirePhase(state, config.phase);
  if (id === "p3_fullscreen" && state.lastPerilDeathAt === null)
    throw new Error("LAST_PERIL_EVENT_REQUIRED");
  const t = state.timers[id];
  if (action.type === "undo-skill") {
    if (!t.history.length) throw new Error("NO_HISTORY");
    const restored = t.history.pop()!;
    Object.assign(t, restored);
    t.version++;
    return state;
  }
  if (action.type === "trigger-tiger") {
    save(t);
    t.firstAt = at + config.cooldownSeconds[state.difficulty] * 1000;
    t.calibrated = true;
    t.basis = "manual";
    return state;
  }
  if (config.mode === "manual-one-shot") throw new Error("USE_MANUAL_TRIGGER");
  if (action.type === "calibrate") {
    save(t);
    t.calibrated = true;
    if (action.remainingSeconds === undefined) {
      t.firstAt = at + config.cooldownSeconds[state.difficulty] * 1000;
      t.confirmedAt = at;
      t.basis = "observed-cast";
    } else {
      t.firstAt = at + action.remainingSeconds * 1000;
      t.basis = "remaining";
    }
  } else if (action.type === "shift") {
    const next = project(state, mechanics, id, at);
    if (!next) throw new Error("UNCONFIGURED_TIMER");
    save(t);
    t.firstAt = next.at + action.seconds * 1000;
    t.calibrated = true;
    t.basis = "shift";
  }
  return state;
}
export * from "./audio.js";
export * from "./scheduler.js";
