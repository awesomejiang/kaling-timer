import { spawn } from "node:child_process";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { VoiceGrammar, loadVoiceConfig } from "@kaling/voice";

assert.equal(process.platform, "win32", "This check requires Windows");
const source = await readFile(
  new URL("../apps/desktop/src-tauri/src/speech.ps1", import.meta.url),
  "utf8",
);
const encoded = Buffer.from(source, "utf16le").toString("base64");
function bridge(mode, extraEnv = {}) {
  return spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    {
      windowsHide: true,
      env: { ...process.env, KALING_MODE: mode, ...extraEnv },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}
function collect(child, onLine = () => {}) {
  let stdout = "",
    stderr = "",
    pending = "";
  const timeout = setTimeout(() => child.kill(), 30000);
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (text) => {
    stdout += text;
    pending += text;
    for (let newline; (newline = pending.indexOf("\n")) !== -1;) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (line) onLine(JSON.parse(line));
    }
  });
  child.stderr.on("data", (text) => {
    stderr += text;
  });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0)
        reject(new Error(`Speech bridge exited ${code}: ${stdout}\n${stderr}`));
      else resolve(stdout);
    });
  });
}
function wav(base64) {
  const bytes = Buffer.from(base64, "base64");
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  let format, samples;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === "fmt ") format = bytes.subarray(offset + 8, offset + 8 + size);
    if (id === "data") samples = bytes.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  assert.ok(format && samples?.length, "Expected nonempty WAV audio");
  assert.equal(format.readUInt16LE(0), 1, "Expected PCM");
  assert.equal(format.readUInt16LE(2), 1, "Expected mono");
  assert.equal(format.readUInt16LE(14), 16, "Expected 16-bit audio");
  return { samples, rate: format.readUInt32LE(4) };
}

const synth = bridge("clips");
const synthesized = collect(synth);
synth.stdin.end(
  JSON.stringify({
    5: "5",
    4: "4",
    3: "3",
    2: "2",
    1: "1",
    command: "狗校准五十秒",
  }),
);
const clips = JSON.parse(await synthesized);
for (const digit of [5, 4, 3, 2, 1]) {
  const { samples, rate } = wav(clips[digit]);
  const durationMs = (samples.length / 2 / rate) * 1000;
  assert.ok(durationMs <= 900, `${digit} clip exceeds 900 ms: ${durationMs}`);
  console.log(`${digit}: ${durationMs.toFixed(1)} ms`);
}

const directory = await mkdtemp(join(tmpdir(), "kaling-speech-check-"));
try {
  const grammar = join(directory, "grammar.json");
  const phrases = new VoiceGrammar(
    loadVoiceConfig(
      await readFile(
        new URL("../config/voice-commands.yaml", import.meta.url),
        "utf8",
      ),
    ),
  ).phrases();
  await writeFile(grammar, JSON.stringify(phrases));
  console.log(`Production grammar: ${phrases.length} phrases`);
  const recognizer = bridge("recognize", { KALING_GRAMMAR: grammar });
  recognizer.stdin.on("error", () => {}); // Report bridge output on early exit.
  const events = [];
  const { samples, rate } = wav(clips.command);
  const count = Math.floor(((samples.length / 2) * 16000) / rate);
  const pcm = Buffer.alloc(count * 2);
  for (let i = 0; i < count; i++) {
    const at = (i * rate) / 16000;
    const left = Math.floor(at),
      right = Math.min(left + 1, samples.length / 2 - 1);
    const value =
      samples.readInt16LE(left * 2) * (1 - (at - left)) +
      samples.readInt16LE(right * 2) * (at - left);
    pcm.writeInt16LE(Math.round(value), i * 2);
  }
  const completed = collect(recognizer, (event) => {
    events.push(event);
    if (event.kind === "ready") {
      // Match live capture speed so audio-relative onset has a wall-clock meaning.
      (async () => {
        const audio = Buffer.concat([
          Buffer.alloc(6400),
          pcm,
          Buffer.alloc(64000),
        ]);
        for (let offset = 0; offset < audio.length; offset += 3200) {
          if (recognizer.exitCode !== null || recognizer.stdin.destroyed) break;
          recognizer.stdin.write(audio.subarray(offset, offset + 3200));
          await delay(100);
        }
        recognizer.stdin.end();
      })().catch(() => recognizer.kill());
    }
  });
  await completed;
  assert.ok(events.some((event) => event.kind === "ready"));
  assert.ok(
    !events.some((event) => event.kind === "error"),
    JSON.stringify(events),
  );
  const result = events.find(
    (event) => event.kind === "result" && event.text === "狗校准五十秒",
  );
  assert.ok(
    result,
    `Expected synthetic command recognition: ${JSON.stringify(events)}`,
  );
  assert.ok(
    result.confidence >= 0.7,
    `Confidence below application threshold: ${result.confidence}`,
  );
  assert.ok(result.onsetAt <= result.recognizedAt);
  console.log(
    `Synthetic PCM recognized: ${result.text}; confidence=${result.confidence.toFixed(3)}`,
  );
  console.log(
    "PASS: real System.Speech synthesis and PCM recognition (no microphone or speaker test)",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
