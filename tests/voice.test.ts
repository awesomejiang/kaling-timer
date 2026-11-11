import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { VoiceGrammar, VoiceDeduper, loadVoiceConfig } from "@kaling/voice";
const grammar = new VoiceGrammar(
  loadVoiceConfig(
    readFileSync(
      new URL("../config/voice-commands.yaml", import.meta.url),
      "utf8",
    ),
  ),
);
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
    "鸟校准",
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
  expect(grammar.parse("狗校准", "p2")).toBeNull();
  expect(grammar.parse("鸟区域校准", "p1")).toEqual({
    type: "calibrate-zone",
    zone: "bird",
  });
  expect(grammar.parse("虎柱子开始", "p1")).toEqual({ type: "trigger-tiger" });
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
