import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  AudioScheduler,
  type AudioPolicy,
  type Cue,
} from "@kaling/timer-engine";
import type { Mechanics } from "@kaling/mechanics";
import { useApp, serverNow } from "./client";
// Native SAPI renders clips locally once, then Web Audio schedules decoded buffers.
export class AudioRuntime {
  private context: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private gain: GainNode | null = null;
  private scheduler = new AudioScheduler({
    durationMs: (cue) => {
      const buffer = this.buffers.get(this.clipKey(cue));
      return buffer ? buffer.duration * 1000 : null;
    },
    schedule: (cue, delay) => {
      const source = this.context!.createBufferSource();
      source.buffer = this.buffers.get(this.clipKey(cue))!;
      source.connect(this.gain!);
      source.start(this.context!.currentTime + delay / 1000);
      return () => {
        try {
          source.stop();
        } catch {}
      };
    },
  });
  private clipKey(cue: Cue) {
    return cue.seconds <= 5
      ? String(cue.seconds)
      : `${cue.skill}:${cue.seconds}`;
  }
  private ticker: ReturnType<typeof setInterval> | null = null;
  private output: HTMLAudioElement | null = null;
  constructor(private mechanics: Mechanics) {}
  async prepareAcknowledgement() {
    if (this.context) return;
    this.context = new AudioContext();
    this.gain = this.context.createGain();
    const destination = this.context.createMediaStreamDestination();
    this.gain.connect(destination);
    this.output = new Audio();
    this.output.srcObject = destination.stream;
    const sink = useApp.getState().settings.outputDevice;
    if (sink) {
      const out = this.output as HTMLAudioElement & {
        setSinkId?: (id: string) => Promise<void>;
      };
      if (!out.setSinkId) throw new Error("输出设备选择不受支持");
      await out.setSinkId(sink);
    }
    await this.context.resume();
    await this.output.play();
  }
  async enable() {
    if (!isTauri()) throw new Error("本地语音音频需要 Windows 桌面版");
    this.stop();
    await this.prepareAcknowledgement();
    const texts: Record<string, string> = {};
    for (const n of [5, 4, 3, 2, 1]) texts[String(n)] = String(n);
    for (const s of this.mechanics.skills)
      for (const lead of useApp.getState().settings.leads[s.id])
        texts[`${s.id}:${lead}`] = `${s.name}，${lead}秒`;
    const encoded = await invoke<Record<string, string>>("prepare_clips", {
      texts,
    });
    for (const [key, base64] of Object.entries(encoded)) {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      this.buffers.set(key, await this.context!.decodeAudioData(bytes.buffer));
    }
    for (const n of [5, 4, 3, 2, 1])
      if (
        !this.buffers.has(String(n)) ||
        this.buffers.get(String(n))!.duration > 0.9
      )
        throw new Error("倒数音频缺失或超过 900ms，请选择更快的本地语音");
    useApp.setState({ audio: "已启用" });
    this.ticker = setInterval(() => this.tick(), 25);
  }
  acknowledge(attempt = 0) {
    const s = useApp.getState();
    if (s.settings.mute || !this.context || !this.gain) return;
    if (this.scheduler.busy(serverNow() ?? 0)) {
      if (attempt < 60) setTimeout(() => this.acknowledge(attempt + 1), 100);
      return;
    }
    // A short local earcon also works when reminders/TTS clips have not been enabled.
    const oscillator = this.context.createOscillator(),
      envelope = this.context.createGain();
    oscillator.frequency.value = 880;
    envelope.gain.setValueAtTime(
      s.settings.volume * 0.15,
      this.context.currentTime,
    );
    envelope.gain.exponentialRampToValueAtTime(
      0.001,
      this.context.currentTime + 0.06,
    );
    oscillator.connect(envelope).connect(this.gain);
    this.gain.gain.value = s.settings.volume;
    oscillator.start();
    oscillator.stop(this.context.currentTime + 0.06);
  }
  private policy(): AudioPolicy {
    const s = useApp.getState(),
      member = s.room?.members.find((m) => m.id === s.session?.memberId);
    const enabled = this.mechanics.skills
      .filter(
        (skill) =>
          !s.settings.disabledSkills.includes(skill.id) &&
          (skill.phase !== "p1" ||
            (skill.zone !== null && skill.zone === member?.zone)),
      )
      .map((skill) => skill.id);
    return {
      conflictSeconds: s.settings.conflictSeconds,
      birdPriority: s.settings.birdPriority,
      enabled,
      leadSeconds: s.settings.leads,
    };
  }
  private tick() {
    const s = useApp.getState(),
      now = serverNow();
    if (!this.context || !this.gain) return;
    if (
      !s.room ||
      !s.connected ||
      !s.synced ||
      now === null ||
      s.settings.mute
    ) {
      this.scheduler.stop();
      return;
    }
    this.gain.gain.value = s.settings.volume;
    this.scheduler.update(s.room.battle, this.mechanics, this.policy(), now);
    if (s.audioLatenessMs !== this.scheduler.maxLatenessMs)
      useApp.setState({ audioLatenessMs: this.scheduler.maxLatenessMs });
  }

  stop() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.scheduler.stop();
    this.context?.close().catch(() => {});
    this.context = null;
    this.output?.pause();
    this.output = null;
    this.buffers.clear();
    useApp.setState({ audio: "未启用" });
  }
}
