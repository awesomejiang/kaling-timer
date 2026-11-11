import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { VoiceGrammar, VoiceDeduper, loadVoiceConfig } from "@kaling/voice";
import { SkillIdSchema, type Phase } from "@kaling/shared";
const grammar = new VoiceGrammar(
  loadVoiceConfig(
    readFileSync(
      new URL("../config/voice-commands.yaml", import.meta.url),
      "utf8",
    ),
  ),
);
it("shows usable skill-specific voice hints from the current configuration", () => {
  for (const skill of SkillIdSchema.options) {
    const hints = grammar.calibrationHints(skill);
    expect(hints.length).toBeGreaterThan(0);
    for (const text of hints) {
      const parsed = grammar.parse(text, skill.split("_")[0] as Phase);
      expect(parsed).toMatchObject(
        skill === "p1_tiger_pillars"
          ? { type: "trigger-tiger" }
          : { type: "calibrate", skill },
      );
    }
  }
  expect(grammar.calibrationHints("p1_bird_flight")).toEqual(["飞行校准"]);
  expect(grammar.calibrationHints("p2_kaling_scroll")).toEqual(["画卷开始"]);
  const custom = structuredClone(grammar.config);
  custom.aliases.p1_dog_minigame = ["汪汪"];
  expect(new VoiceGrammar(custom).calibrationHints("p1_dog_minigame")).toEqual([
    "汪汪校准",
  ]);
});
it("accepts only complete configured utterances with correct Chinese remaining semantics", () => {
  expect(grammar.parse("狗校准50秒", "p1")).toEqual({
    type: "calibrate",
    skill: "p1_dog_minigame",
    remainingSeconds: 50,
  });
  expect(grammar.parse("狗校准五十秒", "p1")).toEqual({
    type: "calibrate",
    skill: "p1_dog_minigame",
    remainingSeconds: 50,
  });
  expect(grammar.parse("鸟飞行减两秒", "p1")).toEqual({
    type: "shift",
    skill: "p1_bird_flight",
    seconds: -2,
  });
  expect(grammar.parse("撤销狗校准", "p1")).toEqual({
    type: "undo-skill",
    skill: "p1_dog_minigame",
  });
  for (const text of [
    "请狗校准",
    "狗校准50秒以后",
    "狗校",
    "狗校准五五秒",
    "五",
    "聊天狗校准",
    "狗校准999秒",
  ])
    expect(grammar.parse(text, "p1")).toBeNull();
  expect(grammar.parse("飞行校准", "p1")).toMatchObject({
    skill: "p1_bird_flight",
  });
  expect(grammar.parse("飞行校准", "p2")).toMatchObject({
    skill: "p2_kaling_flight",
  });
  expect(grammar.parse("画卷开始", "p2")).toEqual({
    type: "calibrate",
    skill: "p2_kaling_scroll",
  });
  expect(grammar.parse("狗校准", "p2")).toBeNull();
  expect(grammar.parse("鸟区域校准", "p1")).toEqual({
    type: "calibrate-zone",
    zone: "bird",
  });
  expect(grammar.parse("鸟开始", "p1")).toEqual({
    type: "calibrate-zone",
    zone: "bird",
  });
  for (const [utterance, zone] of [
    ["进入鸟区", "bird"],
    ["进入虎区", "tiger"],
    ["进入狗区", "dog"],
  ] as const) {
    expect(grammar.phrases()).toContain(utterance);
    expect(grammar.parse(utterance, "p1")).toEqual({
      type: "enter-zone",
      zone,
    });
  }
  expect(grammar.parse("狗开始", "p1")).toEqual({
    type: "calibrate",
    skill: "p1_dog_minigame",
  });
  expect(grammar.parse("二阶段开始", "p1")).toEqual({
    type: "start-p2",
  });
  expect(grammar.parse("虎柱子开始", "p1")).toEqual({ type: "trigger-tiger" });
  for (const alias of ["虎", "柱子", "连线"]) {
    expect(grammar.parse(`${alias}开始`, "p1")).toEqual({
      type: "trigger-tiger",
    });
    expect(grammar.parse(`撤销${alias}校准`, "p1")).toEqual({
      type: "undo-skill",
      skill: "p1_tiger_pillars",
    });
  }
  expect(grammar.parse("小游戏校准", "p1")).toMatchObject({
    type: "calibrate",
    skill: "p1_dog_minigame",
  });
  expect(grammar.parse("全屏校准", "p2")).toMatchObject({
    type: "calibrate",
    skill: "p2_kaling_minigame",
  });
  expect(grammar.parse("全屏校准", "p3")).toMatchObject({
    type: "calibrate",
    skill: "p3_fullscreen",
  });
  expect(grammar.parse("三凶兽死亡", "p3")).toEqual({
    type: "last-peril-death",
  });
  expect(grammar.parse("三兽死亡", "p3")).toBeNull();
  for (const [original, alternative, phase] of [
    ["开始战斗", "校准战斗", "lobby"],
    ["虎开始", "虎校准", "p1"],
    ["狗校准十秒", "狗开始十秒", "p1"],
    ["撤销鸟区域校准", "撤销鸟区域开始", "p1"],
    ["全屏校准", "全屏开始", "p2"],
  ] as const) {
    expect(grammar.phrases()).toContain(alternative);
    expect(grammar.parse(alternative, phase)).toEqual(
      grammar.parse(original, phase),
    );
  }
  expect(grammar.phrases()).toContain("狗校准五十秒");
});
it("rejects duplicate recognition IDs and duplicate onset events", () => {
  const d = new VoiceDeduper();
  expect(d.accept("1", "狗校准", 1000)).toBe(true);
  expect(d.accept("1", "狗校准", 2000)).toBe(false);
  expect(d.accept("2", "狗校准", 1100)).toBe(false);
  expect(d.accept("3", "狗校准", 3000)).toBe(true);
});
it("validates external grammar placeholders and supports user mappings", () => {
  const c = structuredClone(grammar.config);
  c.templates[0].pattern = "bad";
  expect(() => new VoiceGrammar(c)).toThrow();
  const extended = structuredClone(grammar.config);
  extended.maxSeconds = 300;
  const extendedGrammar = new VoiceGrammar(extended);
  expect(extendedGrammar.parse("狗校准两百二十秒", "p1")).toMatchObject({
    remainingSeconds: 220,
  });
  expect(extendedGrammar.phrases()).toContain("狗校准两百二十秒");
  const custom = structuredClone(grammar.config);
  custom.commands.push({ utterance: "开打", action: { type: "start" } });
  expect(new VoiceGrammar(custom).parse("开打", "lobby")).toEqual({
    type: "start",
  });
});
