import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { VoiceGrammar, VoiceDeduper, loadVoiceConfig } from "@kaling/voice";
import { HotkeyActions } from "@kaling/shared";
import source from "../../../config/voice-commands.yaml?raw";
import { report, serverNow, sendAction, useApp, clock } from "./client";
import type { AudioRuntime } from "./audio";
export async function applyNativeSettings() {
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
      if (used.has(shortcut.toLowerCase()))
        throw new Error(`快捷键重复：${shortcut}`);
      used.add(shortcut.toLowerCase());
      if (!HotkeyActions[action]) throw new Error("未知快捷键动作");
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
  kind: "ready" | "result" | "error";
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
    if (s.session?.memberId !== s.room?.hostId) throw new Error("HOST_ONLY");
    const text = s.settings.voiceConfigPath
      ? await invoke<string>("read_voice_config", {
          path: s.settings.voiceConfigPath,
        })
      : source;
    this.grammar = new VoiceGrammar(loadVoiceConfig(text));
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
    const queue: number[][] = [];
    this.worklet.port.onmessage = (event) => {
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
      const state = useApp.getState(),
        now = serverNow();
      if (
        value.kind !== "result" ||
        !value.text ||
        !value.id ||
        now === null ||
        !state.synced ||
        !state.room ||
        state.session?.memberId !== state.room.hostId ||
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
      if (!action) return;
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
    this.unlisten?.();
    this.unlisten = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.worklet?.disconnect();
    this.worklet = null;
    await this.context?.close();
    this.context = null;
    if (isTauri()) await invoke("stop_speech");
    useApp.setState({ mic: "关闭" });
  }
}
