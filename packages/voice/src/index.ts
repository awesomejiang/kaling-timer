import { z } from "zod";
import { parse } from "yaml";
import {
  ActionSchema,
  SkillIdSchema,
  type Action,
  type Phase,
  type SkillId,
} from "@kaling/shared";
const OperationSchema = z.enum([
  "cast",
  "remaining",
  "add",
  "subtract",
  "undo",
]);
const TemplateSchema = z
  .object({ pattern: z.string().min(1).max(80), operation: OperationSchema })
  .strict();
export const VoiceConfigSchema = z
  .object({
    version: z.literal(1),
    maxSeconds: z.number().int().min(1).max(300),
    aliases: z.preprocess(
      (aliases) => {
        if (!aliases || typeof aliases !== "object" || Array.isArray(aliases))
          return aliases;
        return { p2_kaling_scroll: ["卡琳画卷", "画卷"], ...aliases };
      },
      z.record(
        SkillIdSchema,
        z.array(z.string().min(1).max(30)).min(1).max(10),
      ),
    ),
    templates: z.array(TemplateSchema).min(1).max(20),
    commands: z
      .array(
        z
          .object({
            utterance: z.string().min(1).max(80),
            action: ActionSchema,
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .superRefine((config, ctx) => {
    for (const t of config.templates) {
      const expected = ["remaining", "add", "subtract"].includes(t.operation)
        ? ["{skill}", "{seconds}"]
        : ["{skill}"];
      const actual = t.pattern.match(/\{[^}]*\}/g) ?? [];
      if (
        actual.length !== expected.length ||
        expected.some((x) => actual.filter((y) => y === x).length !== 1)
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Template must contain each required placeholder exactly once",
        });
    }
  });
export type VoiceConfig = z.infer<typeof VoiceConfigSchema>;
export function loadVoiceConfig(source: string): VoiceConfig {
  return VoiceConfigSchema.parse(parse(source));
}
export function chineseNumber(n: number): string {
  if (n === 0) return "零";
  const digits = "零一二三四五六七八九";
  let result = "";
  if (n >= 100) {
    result += digits[Math.floor(n / 100)] + "百";
    n %= 100;
    if (n > 0 && n < 10) result += "零";
  }
  if (n >= 10) {
    const tens = Math.floor(n / 10);
    result += (tens === 1 && !result ? "" : digits[tens]) + "十";
    n %= 10;
  }
  return result + (n ? digits[n] : "");
}
export function parseNumber(text: string): number | null {
  if (/^\d{1,4}$/.test(text)) return Number(text);
  const normalized = text.replaceAll("两", "二");
  for (let n = 0; n <= 300; n++) if (normalized === chineseNumber(n)) return n;
  return null;
}
function numberWords(n: number): string[] {
  let words = [""];
  for (const character of chineseNumber(n))
    words = words.flatMap((prefix) =>
      character === "二"
        ? [prefix + "二", prefix + "两"]
        : [prefix + character],
    );
  return [String(n), ...words];
}
function action(
  operation: z.infer<typeof OperationSchema>,
  skill: SkillId,
  n: number,
): Action {
  switch (operation) {
    case "cast":
      return { type: "calibrate", skill };
    case "remaining":
      return { type: "calibrate", skill, remainingSeconds: n };
    case "add":
      return { type: "shift", skill, seconds: n };
    case "subtract":
      return { type: "shift", skill, seconds: -n };
    case "undo":
      return { type: "undo-skill", skill };
  }
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalizeStart = (text: string) => text.replaceAll("开始", "校准");
export class VoiceGrammar {
  readonly config: VoiceConfig;
  private matchers: {
    regex: RegExp;
    operation: z.infer<typeof OperationSchema>;
    skill: SkillId;
    hasNumber: boolean;
  }[] = [];
  constructor(config: VoiceConfig) {
    this.config = VoiceConfigSchema.parse(config);
    for (const [skill, aliases] of Object.entries(config.aliases))
      for (const alias of aliases)
        for (const t of config.templates) {
          const pattern = t.pattern
            .split(/(\{skill\}|\{seconds\})/)
            .map((part) =>
              part === "{skill}"
                ? escape(alias)
                : part === "{seconds}"
                  ? "([0-9零一二两三四五六七八九十百]+)"
                  : escape(part),
            )
            .join("");
          this.matchers.push({
            regex: new RegExp(`^${normalizeStart(pattern)}$`),
            operation: t.operation,
            skill: skill as SkillId,
            hasNumber: t.pattern.includes("{seconds}"),
          });
        }
  }
  parse(text: string, phase: Phase): Action | null {
    const normalized = normalizeStart(text);
    const matches: Action[] = this.config.commands
      .filter((c) => normalizeStart(c.utterance) === normalized)
      .map((c) => c.action);
    for (const m of this.matchers) {
      if (!m.skill.startsWith(phase + "_")) continue;
      const match = m.regex.exec(normalized);
      if (!match) continue;
      const n = m.hasNumber ? parseNumber(match[1]) : 0;
      if (n === null || n > this.config.maxSeconds) continue;
      if (m.skill === "p1_tiger_pillars" && m.operation !== "undo") continue;
      matches.push(action(m.operation, m.skill, n));
    }
    const unique = new Map(matches.map((a) => [JSON.stringify(a), a]));
    return unique.size === 1 ? [...unique.values()][0] : null;
  }
  phrases(): string[] {
    const phrases = new Set(this.config.commands.map((c) => c.utterance));
    for (const [skill, aliases] of Object.entries(this.config.aliases))
      for (const alias of aliases)
        for (const t of this.config.templates) {
          if (skill === "p1_tiger_pillars" && t.operation !== "undo") continue;
          const base = t.pattern.replace("{skill}", alias);
          if (!base.includes("{seconds}")) phrases.add(base);
          else
            for (let n = 0; n <= this.config.maxSeconds; n++)
              for (const num of numberWords(n))
                phrases.add(base.replace("{seconds}", num));
        }
    return [
      ...new Set(
        [...phrases].flatMap((text) => [
          text,
          normalizeStart(text),
          text.replaceAll("校准", "开始"),
        ]),
      ),
    ];
  }
  calibrationHints(skill: SkillId): string[] {
    const phase = skill.split("_")[0] as Phase;
    if (skill === "p1_tiger_pillars") {
      const command = [...this.config.commands]
        .sort((a, b) => a.utterance.length - b.utterance.length)
        .find((c) => this.parse(c.utterance, phase)?.type === "trigger-tiger");
      return command ? [command.utterance] : [];
    }
    for (const operation of ["cast", "remaining"] as const) {
      const remaining = Math.min(50, this.config.maxSeconds);
      const candidates = this.config.commands
        .filter(
          (c) =>
            c.action.type === "calibrate" &&
            c.action.skill === skill &&
            (operation === "cast"
              ? c.action.remainingSeconds === undefined
              : c.action.remainingSeconds === remaining),
        )
        .map((c) => c.utterance);
      for (const alias of this.config.aliases[skill])
        for (const template of this.config.templates.filter(
          (t) => t.operation === operation,
        ))
          candidates.push(
            template.pattern
              .replace("{skill}", alias)
              .replace("{seconds}", String(remaining)),
          );
      const valid = candidates
        .map((text) =>
          skill === "p2_kaling_scroll" && operation === "cast"
            ? text.replaceAll("校准", "开始")
            : text,
        )
        .sort((a, b) => a.length - b.length)
        .find((text) => {
          const parsed = this.parse(text, phase);
          return (
            parsed?.type === "calibrate" &&
            parsed.skill === skill &&
            (operation === "cast"
              ? parsed.remainingSeconds === undefined
              : parsed.remainingSeconds === remaining)
          );
        });
      if (valid) return [valid];
    }
    return [];
  }
}
export class VoiceDeduper {
  private entries: { id: string; text: string; at: number }[] = [];
  accept(id: string, text: string, at: number): boolean {
    if (
      this.entries.some(
        (e) => e.id === id || (e.text === text && Math.abs(e.at - at) < 300),
      )
    )
      return false;
    this.entries.push({ id, text, at });
    this.entries = this.entries.slice(-1000);
    return true;
  }
}
