import React, { useEffect, useState } from "react";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { z } from "zod";
import { RoomSnapshotSchema, SkillIdSchema } from "@kaling/shared";
import { hasP2Started, project } from "@kaling/timer-engine";
import { mechanics } from "./mechanics";
import { useApp, serverNow, settingsUpdate, report } from "./client";

const OverlaySnapshotSchema = z.object({
  room: RoomSnapshotSchema.nullable(),
  memberId: z.string().nullable(),
  now: z.number().nullable(),
  connected: z.boolean(),
  synced: z.boolean(),
  mic: z.string(),
  audio: z.string(),
  opacity: z.number().min(0.15).max(1),
  locked: z.boolean(),
  voiceHints: z.partialRecord(SkillIdSchema, z.array(z.string())),
});
type OverlaySnapshot = z.infer<typeof OverlaySnapshotSchema>;
const eventName = "overlay:snapshot";
const channelName = "kaling-overlay-preview";
let windowTask: Promise<void> = Promise.resolve();

// Only public display state crosses windows. No credentials, socket or microphone
// is created by the overlay; the main window remains the single local runtime.
export function useOverlayBridge() {
  const enabled = useApp((s) => s.settings.overlayEnabled);
  const locked = useApp((s) => s.settings.overlayLocked);
  useEffect(() => {
    if (isTauri()) {
      windowTask = windowTask
        .then(() =>
          invoke<void>("configure_overlay", { visible: enabled, locked }),
        )
        .catch(report);
    }
  }, [enabled, locked]);
  useEffect(() => {
    if (!isTauri()) return;
    const handlers = [
      listen("overlay:edit", () =>
        settingsUpdate({ overlayEnabled: true, overlayLocked: false }),
      ),
      listen("overlay:closed", () => settingsUpdate({ overlayEnabled: false })),
    ];
    return () => {
      for (const handler of handlers) handler.then((stop) => stop());
    };
  }, []);
  useEffect(() => {
    const channel = isTauri() ? null : new BroadcastChannel(channelName);
    const publish = () => {
      const s = useApp.getState();
      if (!s.settings.overlayEnabled) return;
      const snapshot: OverlaySnapshot = {
        room: s.room,
        memberId: s.session?.memberId ?? null,
        now: serverNow(),
        connected: s.connected,
        synced: s.synced,
        mic: s.mic,
        audio: s.audio,
        opacity: s.settings.overlayOpacity,
        locked: s.settings.overlayLocked,
        voiceHints: s.voiceHints,
      };
      if (channel) channel.postMessage(snapshot);
      else emitTo("overlay", eventName, snapshot).catch(() => {});
    };
    const timer = setInterval(publish, 250);
    publish();
    return () => {
      clearInterval(timer);
      channel?.close();
    };
  }, []);
}

export function Overlay() {
  const [received, setReceived] = useState<{
    snapshot: OverlaySnapshot;
    at: number;
  } | null>(null);
  const [tick, setTick] = useState(performance.now());
  useEffect(() => {
    let alive = true;
    const receive = (value: unknown) => {
      const parsed = OverlaySnapshotSchema.safeParse(value);
      if (alive && parsed.success)
        setReceived({ snapshot: parsed.data, at: performance.now() });
    };
    const channel = isTauri() ? null : new BroadcastChannel(channelName);
    if (channel) channel.onmessage = (event) => receive(event.data);
    const unlisten = isTauri()
      ? listen(eventName, (event) => receive(event.payload))
      : null;
    const timer = setInterval(() => setTick(performance.now()), 100);
    return () => {
      alive = false;
      clearInterval(timer);
      channel?.close();
      unlisten?.then((stop) => stop());
    };
  }, []);
  const s = received?.snapshot;
  const room = s?.room;
  const member = room?.members.find((m) => m.id === s?.memberId);
  const phase = room?.battle.phase;
  const now = s?.now != null && received ? s.now + (tick - received.at) : null;
  const online =
    !!s?.connected && s.synced && !!received && tick - received.at < 3000;
  const skills = mechanics.skills.filter(
    (skill) =>
      skill.phase === phase &&
      (phase !== "p1" ||
        (member?.zone !== null && skill.zone === member?.zone)),
  );
  const zones = { bird: "鸟区", tiger: "虎区", dog: "狗区" };
  return (
    <div
      className={`overlay-shell ${s?.locked ? "overlay-locked" : ""}`}
      style={{ backgroundColor: `rgba(12, 20, 30, ${s?.opacity ?? 0.8})` }}
    >
      <header className="overlay-header" data-tauri-drag-region>
        <strong data-tauri-drag-region>
          Kaling ·{" "}
          {phase === "lobby" ? "大厅" : (phase?.toUpperCase() ?? "等待连接")}
          {phase === "p1" && member?.zone ? ` · ${zones[member.zone]}` : ""}
        </strong>
        <span className={online ? "online" : "offline"} data-tauri-drag-region>
          {online ? "已同步" : "离线投影"}
        </span>
      </header>
      {!room ? (
        <p>请先在主窗口加入房间</p>
      ) : phase === "lobby" ? (
        <p>等待房主开始战斗</p>
      ) : phase === "p1" && !member?.zone ? (
        <p>请在主窗口选择主区域</p>
      ) : null}
      <div className="overlay-timers">
        {skills.map((skill) => {
          const next =
            now === null || !room
              ? null
              : project(room.battle, mechanics, skill.id, now);
          return (
            <article className="overlay-timer" key={skill.id}>
              <div className="row">
                <h2>{skill.name}</h2>
                <span>
                  {room && skill.cooldownSeconds[room.battle.difficulty]}s
                </span>
              </div>
              <div className="overlay-digits">
                {next && now !== null
                  ? Math.max(0, (next.at - now) / 1000).toFixed(1)
                  : "—"}
              </div>
              <small>
                {room && phase === "p2" && !hasP2Started(room.battle, mechanics)
                  ? "等待 Boss 出现"
                  : next
                    ? next.status === "manual"
                      ? "手动单次"
                      : "预测 · 未确认施放"
                    : skill.id === "p3_fullscreen" &&
                        !room?.battle.lastPerilDeathAt
                      ? "等待“三凶兽死亡”"
                      : skill.startEvent === "observed-cast"
                        ? "等待房主确认首次施放"
                        : phase === "p1"
                          ? "等待本区校准或手动触发"
                          : "等待房主校准"}
              </small>
              <small className="voice-hint">
                语音：{s?.voiceHints[skill.id]?.join(" / ") || "未配置"}
              </small>
            </article>
          );
        })}
      </div>
      <footer className="overlay-footer">
        <span>
          提醒{s?.audio === "已启用" ? "开" : "关"} · 语音
          {s?.mic.startsWith("监听中") ? "开" : "关"}
        </span>
        <span>
          {s?.locked ? "已锁定 · 在主窗口或托盘解锁" : "拖动顶栏 · 边缘缩放"}
        </span>
      </footer>
    </div>
  );
}
