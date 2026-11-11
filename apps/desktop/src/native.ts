import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { VoiceGrammar, VoiceDeduper, loadVoiceConfig } from "@kaling/voice";
import {
  HotkeyActions,
  commandPermission,
  canUseVoice,
  SkillIdSchema,
} from "@kaling/shared";
import { mechanics } from "./mechanics";
import source from "../../../config/voice-commands.yaml?raw";
import { report, serverNow, sendAction, useApp, clock } from "./client";
import type { AudioRuntime } from "./audio";
export async function refreshVoiceHints() {
  const path = useApp.getState().settings.voiceConfigPath;
  const text =
    path && isTauri()
      ? await invoke<string>("read_voice_config", { path })
      : source;
  const config = loadVoiceConfig(text);
  const grammar = new VoiceGrammar(config);
  useApp.setState({
    voiceHints: Object.fromEntries(
      SkillIdSchema.options.map((id) => [id, grammar.calibrationHints(id)]),
    ),
  });
  return config;
}
let nativeSettingsTask: Promise<void> = Promise.resolve();
export function applyNativeSettings() {
  const task = nativeSettingsTask.then(updateNativeSettings);
  nativeSettingsTask = task.catch(() => {});
  return task;
}
async function updateNativeSettings() {
  if (!isTauri()) return;
  await getCurrentWindow().setAlwaysOnTop(
    useApp.getState().settings.alwaysOnTop,
  );
  await unregisterAll();
  const used = new Set<string>();
  try {
    for (const [action, shortcut] of Object.entries(
      useApp.getState().settings.hotkeys,
    )) {
      if (!shortcut) continue;
      if (!HotkeyActions[action]) throw new Error("未知快捷键动作");
      const state = useApp.getState();
      if (
        !state.room ||
        commandPermission(
          state.room,
          state.session?.memberId,
          HotkeyActions[action],
          mechanics.skills,
        )
      )
        continue;
      if (used.has(shortcut.toLowerCase()))
        throw new Error(`快捷键重复：${shortcut}`);
      used.add(shortcut.toLowerCase());
      await register(shortcut, (event) => {
        if (event.state === "Pressed")
          sendAction(HotkeyActions[action], { source: "hotkey" }).catch(report);
      });
    }
  } catch (error) {
    await unregisterAll();
    throw new Error(`快捷键注册失败（可能冲突）：${String(error)}`);
  }
}
interface SpeechEvent {
  kind: "ready" | "result" | "rejected" | "error";
  text?: string;
  onsetAt?: number | null;
  recognizedAt?: number;
  id?: string;
  message?: string;
  confidence?: number;
  sessionId?: string;
}
export class VoiceRuntime {
  private grammar = new VoiceGrammar(loadVoiceConfig(source));
  private deduper = new VoiceDeduper();
  private unlisten: UnlistenFn | null = null;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private generation = 0;
  private inputMonitor: ReturnType<typeof setInterval> | null = null;
  constructor(private audio: AudioRuntime) {}
  async start() {
    try {
      await this.startInner();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }
  async startInner() {
    if (!isTauri()) throw new Error("离线语音识别需要 Windows 桌面版");
    await this.stop();
    await this.audio.prepareAcknowledgement();
    const generation = ++this.generation;
    const sessionId = crypto.randomUUID();
    const s = useApp.getState();
    if (!s.room || !canUseVoice(s.room, s.session?.memberId))
      throw new Error("请选择主区域后启用语音");
    this.grammar = new VoiceGrammar(await refreshVoiceHints());
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: s.settings.inputDevice
          ? { exact: s.settings.inputDevice }
          : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    useApp.setState({
      micDevice: this.stream.getAudioTracks()[0]?.label ?? "系统默认麦克风",
      voiceResult: "等待讲话",
    });
    this.context = new AudioContext({ sampleRate: 16000 });
    await this.context.audioWorklet.addModule(
      new URL("./pcm-worklet.js", import.meta.url),
    );
    this.worklet = new AudioWorkletNode(this.context, "kaling-pcm");
    const input = this.context.createMediaStreamSource(this.stream);
    input.connect(this.worklet);
    // Silent output keeps processing alive; captured PCM only goes to the local native recognizer.
    const mute = this.context.createGain();
    mute.gain.value = 0;
    this.worklet.connect(mute).connect(this.context.destination);
    let ready = false;
    let writing = false;
    let inputAt = 0;
    let meterAt = 0;
    this.inputMonitor = setInterval(() => {
      if (ready && performance.now() - inputAt > 3000) {
        useApp.setState({
          mic: `监听中 · 未收到音频（${this.context?.state ?? "closed"}）`,
        });
      }
    }, 1000);
    const queue: number[][] = [];
    this.worklet.port.onmessage = (event) => {
      if (generation !== this.generation) return;
      inputAt = performance.now();
      if (inputAt - meterAt >= 250) {
        const samples = event.data as Int16Array;
        const rms =
          Math.sqrt(
            samples.reduce((sum, sample) => sum + sample * sample, 0) /
              samples.length,
          ) / 32768;
        useApp.setState({
          micLevel: Math.round(Math.min(1, rms * 5) * 100),
          ...(ready ? { mic: "监听中 · 本地离线" } : {}),
        });
        meterAt = inputAt;
      }
      if (!ready || generation !== this.generation) return;
      queue.push(Array.from(event.data as Int16Array));
      if (queue.length > 10) {
        report("音频处理积压，已停止识别以避免错误时间戳");
        this.stop().catch(report);
        return;
      }
      if (!writing) {
        writing = true;
        (async () => {
          try {
            while (queue.length && generation === this.generation)
              await invoke("speech_pcm", { samples: queue.shift()! });
          } catch (error) {
            report(error);
            await this.stop();
          } finally {
            writing = false;
          }
        })();
      }
    };
    this.unlisten = await listen<SpeechEvent>("speech:event", (event) => {
      if (generation !== this.generation) return;
      const value = event.payload;
      if (value.sessionId !== sessionId) return;
      if (value.kind === "ready") {
        ready = true;
        this.context?.resume().catch(report);
        useApp.setState({ mic: "监听中 · 本地离线" });
        return;
      }
      if (value.kind === "error") {
        report(value.message ?? "语音识别失败");
        this.stop().catch(report);
        return;
      }
      if (value.kind === "rejected") {
        useApp.setState({ voiceResult: "听到语音，但未匹配有效命令" });
        return;
      }
      if (value.kind === "result") {
        useApp.setState({
          voiceResult: `${value.text ?? ""}（置信度 ${Math.round((value.confidence ?? 0) * 100)}%）`,
        });
      }
      const state = useApp.getState(),
        now = serverNow();
      if (
        value.kind !== "result" ||
        !value.text ||
        !value.id ||
        now === null ||
        !state.synced ||
        !state.room ||
        (value.confidence ?? 0) < 0.7
      )
        return;
      const recognizedAt = now;
      const onset =
        value.onsetAt && value.recognizedAt
          ? Math.round(now - (value.recognizedAt - value.onsetAt))
          : null;
      if (!this.deduper.accept(value.id, value.text, onset ?? recognizedAt))
        return;
      const action = this.grammar.parse(value.text, state.room.battle.phase);
      if (!action) {
        useApp.setState({ voiceResult: "当前阶段没有匹配的明确命令" });
        return;
      }
      if (
        commandPermission(
          state.room,
          state.session?.memberId,
          action,
          mechanics.skills,
        )
      ) {
        useApp.setState({
          voiceResult: "命令无权限：P1 只能控制自己的区域，全队操作由房主执行",
        });
        return;
      }
      sendAction(action, {
        source: "voice",
        recognizedAt: Math.round(recognizedAt),
        onsetAt: onset,
        compensationMs: state.settings.compensationMs,
      })
        .then(() => this.audio.acknowledge())
        .catch(report);
    });
    try {
      await invoke("start_speech", {
        phrases: this.grammar.phrases(),
        sessionId,
      });
      useApp.setState({ mic: "正在加载离线语法…" });
    } catch (error) {
      await this.stop();
      throw error;
    }
  }
  async stop() {
    this.generation++;
    if (this.inputMonitor) clearInterval(this.inputMonitor);
    this.inputMonitor = null;
    this.unlisten?.();
    this.unlisten = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.worklet?.disconnect();
    this.worklet = null;
    await this.context?.close();
    this.context = null;
    if (isTauri()) await invoke("stop_speech");
    useApp.setState({ mic: "关闭", micLevel: 0 });
  }
}
