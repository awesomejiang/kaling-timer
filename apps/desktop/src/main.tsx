import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import {
  DifficultySchema,
  ZoneSchema,
  HotkeyActions,
  commandPermission,
  canUseVoice,
  type Action,
  type Difficulty,
  type SkillId,
  type Zone,
} from "@kaling/shared";
import { hasP2Started, project } from "@kaling/timer-engine";
import { mechanics } from "./mechanics";
import {
  useApp,
  connect,
  report,
  createRoom,
  joinRoom,
  leaveRoom,
  resumeSavedRoom,
  assign,
  sendAction,
  retryPending,
  serverNow,
  settingsUpdate,
} from "./client";
import { AudioRuntime } from "./audio";
import {
  VoiceRuntime,
  applyNativeSettings,
  refreshVoiceHints,
  voiceGrammarWithAliases,
} from "./native";
import { SettingsSchema, type Settings } from "./settings";
import "./style.css";
import { Overlay, useOverlayBridge } from "./overlay";
const audio = new AudioRuntime(mechanics),
  voice = new VoiceRuntime(audio);
let featureQueue: Promise<void> = Promise.resolve();
let audioConfig = "",
  voiceConfig = "";
function syncLocalFeatures() {
  const task = featureQueue.then(async () => {
    if (!isTauri()) return;
    const s = useApp.getState();
    const audioKey = JSON.stringify([
      s.settings.outputDevice,
      s.settings.leads,
      s.settings.announcementNames,
    ]);
    const voiceKey = JSON.stringify([
      s.room?.code,
      s.session?.memberId,
      s.settings.inputDevice,
      s.settings.voiceConfigPath,
      s.settings.voiceSkillAliases,
      s.settings.voiceCommandAliases,
    ]);
    const wantAudio = !!s.room && s.settings.remindersEnabled;
    const wantVoice =
      !!s.room &&
      s.settings.voiceEnabled &&
      canUseVoice(s.room, s.session?.memberId);
    if (!wantVoice || voiceConfig !== voiceKey) await voice.stop();
    if (!wantAudio || audioConfig !== audioKey) audio.stop();
    audioConfig = audioKey;
    voiceConfig = voiceKey;
    if (wantAudio && useApp.getState().audio !== "已启用") {
      try {
        await audio.enable();
      } catch (error) {
        audio.stop();
        report(error);
      }
    }
    if (wantVoice) {
      try {
        if (useApp.getState().mic === "关闭") await voice.start();
        else await audio.prepareAcknowledgement();
      } catch (error) {
        report(error);
      }
    }
  });
  featureQueue = task.catch(report);
  return featureQueue;
}
const names = { bird: "鸟", tiger: "虎", dog: "狗" };
const difficultyNames = {
  easy: "简单",
  normal: "普通",
  hard: "困难",
  extreme: "极限",
};
const actionNames: Record<Action["type"], string> = {
  start: "开始战斗",
  reset: "重置战斗",
  phase: "切换阶段",
  "start-p2": "二阶段开始",
  "enter-zone": "进入区域",
  "last-peril-death": "三凶兽死亡",
  "trigger-tiger": "虎柱子开始",
  difficulty: "难度调整",
  calibrate: "技能校准",
  shift: "时间调整",
  "undo-skill": "撤销技能校准",
  "calibrate-zone": "区域校准",
  "undo-zone": "撤销区域校准",
};
function logDescription(action: Action) {
  let label = actionNames[action.type];
  if ("skill" in action) {
    const skill = action.skill;
    label += " · " + mechanics.skills.find((s) => s.id === skill)?.name;
  }
  if (action.type === "calibrate")
    label +=
      action.remainingSeconds === undefined
        ? " · 确认刚刚施法"
        : ` · 参考时刻剩余 ${action.remainingSeconds} 秒`;
  if (action.type === "shift")
    label += ` · ${action.seconds >= 0 ? "+" : ""}${action.seconds} 秒`;
  if (action.type === "phase") label += " · " + action.phase.toUpperCase();
  if ("zone" in action) label += " · " + names[action.zone];
  return label;
}
function hotkeyLabel(key: string) {
  const action = HotkeyActions[key];
  if (!action) return key;
  let name = actionNames[action.type];
  if ("skill" in action) {
    const id = action.skill;
    name += " · " + mechanics.skills.find((s) => s.id === id)?.name;
  }
  if ("zone" in action) name += " · " + names[action.zone];
  if (action.type === "phase") name += " · " + action.phase.toUpperCase();
  return name;
}
const perform = (action: Action) => sendAction(action).catch(report);
function Admission() {
  const [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [enteredCode, setCode] = useState<string | null>(null),
    [joinName, setJoinName] = useState(""),
    [joinPassword, setJoinPassword] = useState(""),
    [difficulty, setDifficulty] = useState<Difficulty>("normal"),
    [busy, setBusy] = useState(false);
  const state = useApp();
  const [cachedCode] = useState(() => {
    try {
      return localStorage.getItem("kaling-last-room-code") ?? "";
    } catch {
      return "";
    }
  });
  const code =
    enteredCode ??
    new URLSearchParams(location.search).get("room")?.toUpperCase() ??
    state.savedSession?.code ??
    cachedCode;
  async function submit(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="admission-grid">
      <section aria-labelledby="create-room-heading">
        <h2 id="create-room-heading">创建房间</h2>
        <label>
          称呼（可选）
          <input
            aria-label="称呼"
            value={name}
            maxLength={24}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          房间密码（可选）
          <input
            type="password"
            value={password}
            maxLength={128}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          难度
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as Difficulty)}
          >
            {DifficultySchema.options.map((d) => (
              <option key={d} value={d}>
                {difficultyNames[d]}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={!state.connected || busy || state.leavingRoom}
          onClick={() =>
            submit(async () => {
              if (state.savedSession) await leaveRoom();
              await createRoom(name.trim() || "房主", password, difficulty);
            })
          }
        >
          创建房间 / 单人
        </button>
      </section>
      <section aria-labelledby="join-room-heading">
        <h2 id="join-room-heading">加入房间</h2>
        <label>
          房间码
          <input
            value={code}
            maxLength={6}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </label>
        <label>
          称呼（可选）
          <input
            aria-label="称呼"
            value={joinName}
            maxLength={24}
            onChange={(e) => setJoinName(e.target.value)}
          />
        </label>
        <label>
          房间密码（可选）
          <input
            type="password"
            value={joinPassword}
            maxLength={128}
            onChange={(e) => setJoinPassword(e.target.value)}
          />
        </label>
        <button
          disabled={
            code.length !== 6 || !state.connected || busy || state.leavingRoom
          }
          onClick={() => {
            setCode(code);
            void submit(async () => {
              if (state.savedSession?.code === code) {
                await resumeSavedRoom();
                return;
              }
              if (state.savedSession) await leaveRoom();
              await joinRoom(code, joinName.trim() || "队员", joinPassword);
            });
          }}
        >
          加入房间
        </button>
      </section>
    </div>
  );
}
function TimerCard({
  id,
  now,
  control,
  editable,
}: {
  id: SkillId;
  now: number;
  control: boolean;
  editable: boolean;
}) {
  const room = useApp((s) => s.room)!;
  const waitingForP2 =
    room.battle.phase === "p2" && !hasP2Started(room.battle, mechanics);
  const voiceHints = useApp((s) => s.voiceHints[id]);
  const config = mechanics.skills.find((s) => s.id === id)!,
    timer = room.battle.timers[id];
  const next = project(room.battle, mechanics, id, now),
    [remaining, setRemaining] = useState(50),
    [shift, setShift] = useState(5);
  return (
    <article className="timer">
      <div className="timer-title">
        <div className="skill-heading">
          <h3>{config.name}</h3>
          <small
            className="voice-hint"
            title="不带秒数表示刚刚施放；带秒数表示距离下一次激活的剩余时间"
          >
            语音：
            {voiceHints?.length ? voiceHints.join(" / ") : "未配置校准口令"}
          </small>
        </div>
        <span>
          {config.cooldownSeconds[room.battle.difficulty]}s ·{" "}
          {config.mode === "fixed-cycle"
            ? "固定周期"
            : config.mode === "manual-one-shot"
              ? "手动单次"
              : "施法预测"}
        </span>
      </div>
      <div className="digits">
        {next ? Math.max(0, (next.at - now) / 1000).toFixed(1) : "—"}
      </div>
      <p>
        {waitingForP2
          ? "等待 Boss 出现"
          : next
            ? next.status === "manual"
              ? "手动倒计时"
              : "预测激活 · 未确认施法"
            : config.startEvent === "manual-trigger"
              ? "等待手动触发"
              : id === "p3_fullscreen" && room.battle.lastPerilDeathAt === null
                ? "等待“三凶兽死亡”事件"
                : timer.firstAt === null
                  ? config.startEvent === "observed-cast"
                    ? "等待房主确认首次施放"
                    : config.phase === "p1"
                      ? "首轮延迟未配置 · 需要本区成员校准"
                      : "首轮延迟未配置 · 需要房主校准"
                  : "本次倒计时已结束"}
      </p>
      {timer.basis === "last-peril-reference" && (
        <small>
          以三凶兽死亡作校准参考，下一次 = 参考 + 冷却；首轮延迟仍未知。
        </small>
      )}
      {timer.confirmedAt !== null && (
        <small>
          上次确认施法：{new Date(timer.confirmedAt).toLocaleTimeString()}
        </small>
      )}
      {control && (
        <fieldset disabled={!editable || waitingForP2}>
          <legend>{config.name}校准</legend>
          {config.mode === "manual-one-shot" ? (
            <button onClick={() => perform({ type: "trigger-tiger" })}>
              开始 30 秒单次
            </button>
          ) : (
            <>
              <button
                disabled={
                  id === "p3_fullscreen" &&
                  room.battle.lastPerilDeathAt === null
                }
                onClick={() => perform({ type: "calibrate", skill: id })}
              >
                刚刚施放
              </button>
              <div className="row">
                <label>
                  剩余秒数
                  <input
                    type="number"
                    min={0}
                    max={3600}
                    value={remaining}
                    onChange={(e) => setRemaining(Number(e.target.value))}
                  />
                </label>
                <button
                  disabled={
                    id === "p3_fullscreen" &&
                    room.battle.lastPerilDeathAt === null
                  }
                  onClick={() =>
                    perform({
                      type: "calibrate",
                      skill: id,
                      remainingSeconds: remaining,
                    })
                  }
                >
                  设置剩余
                </button>
              </div>
              <div className="row">
                <label>
                  调整秒数
                  <input
                    type="number"
                    min={-300}
                    max={300}
                    value={shift}
                    onChange={(e) => setShift(Number(e.target.value))}
                  />
                </label>
                <button
                  disabled={!next}
                  onClick={() =>
                    perform({ type: "shift", skill: id, seconds: shift })
                  }
                >
                  调整 ± 秒
                </button>
              </div>
            </>
          )}
          <button
            disabled={!timer.history.length}
            onClick={() => perform({ type: "undo-skill", skill: id })}
          >
            撤销上次修改
          </button>
        </fieldset>
      )}
    </article>
  );
}
function Room({ now }: { now: number }) {
  const s = useApp(),
    room = s.room!,
    host = s.session?.memberId === room.hostId,
    editable = s.connected && s.synced && !s.pending && !s.leavingRoom;
  const member = room.members.find((m) => m.id === s.session?.memberId);
  const skills = mechanics.skills.filter(
    (skill) => skill.phase === room.battle.phase,
  );
  if (room.battle.phase === "p1" && member?.zone) {
    skills.sort(
      (a, b) => Number(b.zone === member.zone) - Number(a.zone === member.zone),
    );
  }
  return (
    <>
      <section>
        <div className="row">
          <h2>房间 {room.code}</h2>
          <div className="buttons">
            <button
              onClick={() =>
                navigator.clipboard
                  .writeText(
                    isTauri()
                      ? room.code
                      : `${location.origin}${location.pathname}?room=${room.code}`,
                  )
                  .catch(report)
              }
            >
              {isTauri() ? "复制房间码" : "复制加入链接"}
            </button>
            <button
              disabled={!s.connected || !!s.pending || s.leavingRoom}
              title={
                host && room.members.length > 1
                  ? "退出后由下一位成员接任房主"
                  : undefined
              }
              onClick={() => leaveRoom().catch(report)}
            >
              退出房间
            </button>
          </div>
        </div>
        <p>
          {host ? "房主" : "队员"} ·{" "}
          {room.battle.phase === "lobby"
            ? "大厅"
            : room.battle.phase.toUpperCase()}{" "}
          · {difficultyNames[room.battle.difficulty]} · {room.members.length}/6
          人
        </p>
        <ul className="members">
          {room.members.map((m) => (
            <li key={m.id}>
              {m.name}
              {m.id === room.hostId ? " ♛" : ""} ·{" "}
              {m.zone ? names[m.zone] : "未分区"}
            </li>
          ))}
        </ul>
        {room.battle.phase === "lobby" && (
          <label>
            开战分区
            <select
              aria-label="我的主区域"
              value={member?.zone ?? ""}
              disabled={!editable}
              onChange={(e) =>
                assign((e.target.value || null) as Zone | null).catch(report)
              }
            >
              <option value="">未分配</option>
              {ZoneSchema.options.map((z) => (
                <option value={z} key={z}>
                  {names[z]}区（
                  {room.members.filter((m) => m.zone === z).length} 人）
                </option>
              ))}
            </select>
          </label>
        )}
        {room.battle.phase === "p1" && (
          <div className="buttons" role="group" aria-label="P1 转区">
            {ZoneSchema.options.map((zone) => (
              <button
                key={zone}
                disabled={!editable || member?.zone === zone}
                aria-pressed={member?.zone === zone}
                className={member?.zone === zone ? "toggle-active" : ""}
                onClick={() => perform({ type: "enter-zone", zone })}
              >
                进入{names[zone]}区
              </button>
            ))}
          </div>
        )}
        {host && (
          <fieldset disabled={!editable}>
            <legend>房主控制</legend>
            <label>
              难度
              <select
                aria-label="房间难度"
                disabled={room.battle.phase !== "lobby"}
                value={room.battle.difficulty}
                onChange={(e) =>
                  perform({
                    type: "difficulty",
                    difficulty: e.target.value as Difficulty,
                  })
                }
              >
                {DifficultySchema.options.map((d) => (
                  <option key={d} value={d}>
                    {difficultyNames[d]}
                  </option>
                ))}
              </select>
            </label>
            <div className="buttons">
              <button
                disabled={room.battle.phase !== "lobby"}
                onClick={() => perform({ type: "start" })}
              >
                开始战斗
              </button>
              <button
                disabled={room.battle.phase !== "p1"}
                onClick={() => perform({ type: "phase", phase: "p2" })}
              >
                进入二阶段
              </button>
              {room.battle.phase === "p2" && (
                <button
                  disabled={hasP2Started(room.battle, mechanics)}
                  onClick={() => perform({ type: "start-p2" })}
                >
                  二阶段开始
                </button>
              )}
              <button
                disabled={room.battle.phase !== "p2"}
                onClick={() => perform({ type: "phase", phase: "p3" })}
              >
                进入三阶段
              </button>
              <button
                disabled={
                  room.battle.phase !== "p3" ||
                  room.battle.lastPerilDeathAt !== null
                }
                onClick={() => perform({ type: "last-peril-death" })}
              >
                三凶兽死亡
              </button>
              <button
                className="danger"
                onClick={() => perform({ type: "reset" })}
              >
                重置战斗
              </button>
            </div>
          </fieldset>
        )}
        {room.battle.phase === "p1" &&
          member?.zone &&
          member.zone !== "tiger" && (
            <fieldset disabled={!editable}>
              <legend>本区计时控制（同区成员共享）</legend>
              {[member.zone].map((zone) => (
                <div className="row" key={zone}>
                  <span>
                    {names[zone]}区参考{" "}
                    {room.battle.zoneStartAt[zone] === null
                      ? "—"
                      : new Date(
                          room.battle.zoneStartAt[zone]!,
                        ).toLocaleTimeString()}
                  </span>
                  <button
                    onClick={() => perform({ type: "calibrate-zone", zone })}
                  >
                    {zone === "bird" ? "鸟开始" : `${names[zone]}区域校准`}
                  </button>
                  <button
                    disabled={!room.battle.zoneHistory[zone].length}
                    onClick={() => perform({ type: "undo-zone", zone })}
                  >
                    撤销
                  </button>
                </div>
              ))}
            </fieldset>
          )}
        {!s.connected && (
          <p role="alert">
            离线：仅显示本地投影，修改不可用；连接恢复后自动获取完整快照。
          </p>
        )}
        {s.pending && (
          <p role="status">
            等待命令确认…{" "}
            <button onClick={() => retryPending().catch(report)}>
              以同一命令 ID 重试
            </button>
          </p>
        )}
      </section>
      {room.battle.phase === "lobby" ? (
        <section>
          <p>
            房主开始战斗后，同时建立鸟、虎、狗的区域参考。未知首轮延迟需要校准，虎柱子仍需手动触发。
          </p>
        </section>
      ) : (
        <div className="timers">
          {skills.map((skill) => (
            <TimerCard
              key={skill.id}
              id={skill.id}
              now={now}
              control={
                commandPermission(
                  room,
                  s.session?.memberId,
                  skill.mode === "manual-one-shot"
                    ? { type: "trigger-tiger" }
                    : { type: "calibrate", skill: skill.id },
                  mechanics.skills,
                ) === null
              }
              editable={editable}
            />
          ))}
        </div>
      )}
      <details>
        <summary>事件记录 · 状态版本 {room.version}</summary>
        <ol className="logs">
          {[...room.log].reverse().map((entry) => (
            <li key={entry.version}>
              <time>{new Date(entry.eventAt).toLocaleTimeString()}</time>{" "}
              {logDescription(entry.action)} <small>v{entry.version}</small>
            </li>
          ))}
        </ol>
      </details>
    </>
  );
}
function SettingsPanel() {
  const settings = useApp((s) => s.settings),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [previewing, setPreviewing] = useState(false);
  async function devicesRefresh() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    setDevices(await navigator.mediaDevices.enumerateDevices());
  }
  return (
    <div className="settings-panels">
      <details>
        <summary>本地设置</summary>
        <div className="settings">
          <label>
            <input
              type="checkbox"
              checked={settings.alwaysOnTop}
              onChange={(e) => {
                settingsUpdate({ alwaysOnTop: e.target.checked });
                applyNativeSettings().catch(report);
              }}
            />
            始终置顶（桌面版）
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.mute}
              onChange={(e) => settingsUpdate({ mute: e.target.checked })}
            />
            静音
          </label>
          <label>
            音量
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.volume}
              onChange={(e) =>
                settingsUpdate({ volume: Number(e.target.value) })
              }
            />
          </label>
          <label>
            悬浮窗背景不透明度 {Math.round(settings.overlayOpacity * 100)}%
            <input
              type="range"
              min={0.15}
              max={1}
              step={0.05}
              value={settings.overlayOpacity}
              onChange={(event) =>
                settingsUpdate({ overlayOpacity: Number(event.target.value) })
              }
            />
          </label>
          <p className="muted">
            锁定后，鼠标可直接操作后面的游戏。可在主窗口或托盘选择“解锁悬浮窗”。
          </p>
          <button onClick={() => devicesRefresh().catch(report)}>
            授权并刷新设备
          </button>
          {(["input", "output"] as const).map((kind) => (
            <label key={kind}>
              {kind === "input" ? "麦克风" : "扬声器"}
              <select
                value={
                  kind === "input"
                    ? settings.inputDevice
                    : settings.outputDevice
                }
                onChange={(e) => {
                  settingsUpdate(
                    kind === "input"
                      ? { inputDevice: e.target.value }
                      : { outputDevice: e.target.value },
                  );
                }}
              >
                <option value="">系统默认</option>
                {devices
                  .filter((d) => d.kind === `audio${kind}`)
                  .map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || d.deviceId}
                    </option>
                  ))}
              </select>
            </label>
          ))}
          <label>
            识别补偿（秒，语音起点可用时不重复补偿）
            <input
              type="number"
              min={0}
              max={3}
              step={0.1}
              value={settings.compensationMs / 1000}
              onChange={(e) =>
                settingsUpdate({
                  compensationMs: Math.round(Number(e.target.value) * 1000),
                })
              }
            />
          </label>
          <label>
            外部语音配置路径
            <input
              value={settings.voiceConfigPath}
              onChange={(e) =>
                settingsUpdate({ voiceConfigPath: e.target.value })
              }
            />
          </label>
          <p className="muted">
            修改语法或输入设备后自动应用。完整句式、无唤醒词；建议使用耳机，输入启用回声消除。
          </p>
          <label>
            音频冲突窗口（秒）
            <input
              type="number"
              min={0}
              max={30}
              value={settings.conflictSeconds}
              onChange={(e) =>
                settingsUpdate({ conflictSeconds: Number(e.target.value) })
              }
            />
          </label>
        </div>
      </details>
      <details>
        <summary>技能提醒时间</summary>
        <div className="settings">
          <p className="muted">
            开启提醒的技能会播报 5、4、3、2、1，也可以设置更早的提醒。
          </p>
          {mechanics.skills.map((skill) => (
            <div key={skill.id}>
              <label>
                <input
                  type="checkbox"
                  checked={!settings.disabledSkills.includes(skill.id)}
                  onChange={(e) =>
                    settingsUpdate({
                      disabledSkills: e.target.checked
                        ? settings.disabledSkills.filter(
                            (id) => id !== skill.id,
                          )
                        : [...settings.disabledSkills, skill.id],
                    })
                  }
                />
                {skill.name}
              </label>
              <div className="row">
                <label>
                  播报简称
                  <input
                    aria-label={`${skill.name}播报简称`}
                    maxLength={16}
                    placeholder={skill.name}
                    defaultValue={settings.announcementNames[skill.id] ?? ""}
                    onBlur={(event) => {
                      const name = event.currentTarget.value.trim();
                      if (name !== (settings.announcementNames[skill.id] ?? ""))
                        settingsUpdate({
                          announcementNames: {
                            ...useApp.getState().settings.announcementNames,
                            [skill.id]: name,
                          },
                        });
                    }}
                  />
                </label>
                <button
                  aria-label={`试听${skill.name}`}
                  disabled={!isTauri() || previewing}
                  onClick={() => {
                    setPreviewing(true);
                    audio
                      .preview(skill)
                      .catch(report)
                      .finally(() => setPreviewing(false));
                  }}
                >
                  试听
                </button>
              </div>
              <label>
                额外提前秒数（逗号分隔，6–300）
                <input
                  defaultValue={settings.leads[skill.id].join(",")}
                  onBlur={(e) => {
                    try {
                      const values = e.target.value.trim()
                        ? e.target.value.split(",").map(Number)
                        : [];
                      settingsUpdate({
                        leads: { ...settings.leads, [skill.id]: values },
                      });
                    } catch (error) {
                      report(error);
                    }
                  }}
                />
              </label>
            </div>
          ))}
        </div>
      </details>
      <VoiceCommandsPanel />
      <details>
        <summary>全局快捷键</summary>
        <div className="settings">
          <p className="muted">在 MapleStory 聚焦时也有效。留空即禁用。</p>
          {Object.entries(settings.hotkeys).map(([key, value]) => (
            <label key={key}>
              {hotkeyLabel(key)}
              <input
                value={value}
                onChange={(e) =>
                  settingsUpdate({
                    hotkeys: { ...settings.hotkeys, [key]: e.target.value },
                  })
                }
              />
            </label>
          ))}
          <button
            onClick={() =>
              applyNativeSettings()
                .then(() => useApp.setState({ error: "" }))
                .catch(report)
            }
          >
            注册快捷键并检查冲突
          </button>
        </div>
      </details>
    </div>
  );
}
function AliasField({
  label,
  aliases,
  save,
}: {
  label: string;
  aliases: string[];
  save: (aliases: string[]) => void;
}) {
  const stored = aliases.join("，");
  return (
    <label>
      {label}
      <input
        defaultValue={stored}
        placeholder="多个别名用逗号分隔"
        onBlur={(event) => {
          const input = event.currentTarget;
          const values = [
            ...new Set(
              input.value
                .split(/[,，]/)
                .map((value) => value.trim())
                .filter(Boolean),
            ),
          ];
          if (values.join("，") === stored) return;
          try {
            if (values.length > 5) throw new Error("每项最多可添加 5 个别名");
            save(values);
            input.value = values.join("，");
          } catch (error) {
            input.value = stored;
            report(error);
          }
        }}
      />
    </label>
  );
}

function VoiceCommandsPanel() {
  const config = useApp((s) => s.baseVoiceConfig);
  const settings = useApp((s) => s.settings);
  const commands = new Map<string, string[]>();
  for (const { utterance, action } of config?.commands ?? []) {
    const key = JSON.stringify(action);
    const entries = commands.get(key) ?? [];
    entries.push(utterance);
    commands.set(key, entries);
  }
  function save(patch: Partial<Settings>) {
    if (!config) return;
    const next = SettingsSchema.parse({
      ...useApp.getState().settings,
      ...patch,
    });
    voiceGrammarWithAliases(config, next);
    settingsUpdate(patch);
    useApp.setState({ error: "" });
  }
  return (
    <details>
      <summary>语音口令</summary>
      <div className="settings">
        <p className="muted">
          给现有口令添加自己的说法，留空可恢复默认。技能简称可搭配「开始」「校准」或秒数。
        </p>
        {config && (
          <>
            {(["p1", "p2", "p3"] as const).map((phase) => (
              <fieldset key={phase}>
                <legend>{phase.toUpperCase()} 技能简称</legend>
                {mechanics.skills
                  .filter((skill) => skill.phase === phase)
                  .map((skill) => (
                    <div key={skill.id}>
                      <small>
                        {skill.name} · {config.aliases[skill.id].join("、")}
                      </small>
                      <AliasField
                        label={`${skill.name}自定义简称`}
                        aliases={settings.voiceSkillAliases[skill.id] ?? []}
                        save={(aliases) =>
                          save({
                            voiceSkillAliases: {
                              ...useApp.getState().settings.voiceSkillAliases,
                              [skill.id]: aliases,
                            },
                          })
                        }
                      />
                    </div>
                  ))}
              </fieldset>
            ))}
            <fieldset>
              <legend>战斗与转区口令</legend>
              {[...commands].map(([key, phrases]) => (
                <div key={key}>
                  <small>{phrases.join("、")}</small>
                  <AliasField
                    label={`${phrases[0]}自定义口令`}
                    aliases={settings.voiceCommandAliases[key] ?? []}
                    save={(aliases) =>
                      save({
                        voiceCommandAliases: {
                          ...useApp.getState().settings.voiceCommandAliases,
                          [key]: aliases,
                        },
                      })
                    }
                  />
                </div>
              ))}
            </fieldset>
          </>
        )}
      </div>
    </details>
  );
}
function App() {
  useOverlayBridge();
  const s = useApp(),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    connect().catch(report);
    const id = setInterval(() => setNow(serverNow() ?? Date.now()), 100);
    return () => clearInterval(id);
  }, []);
  const memberZone = s.room?.members.find(
    (m) => m.id === s.session?.memberId,
  )?.zone;
  useEffect(() => {
    applyNativeSettings().catch(report);
  }, [
    s.room?.code,
    s.room?.hostId,
    s.room?.battle.phase,
    s.session?.memberId,
    memberZone,
  ]);
  const voiceAllowed = !!s.room && canUseVoice(s.room, s.session?.memberId);
  useEffect(() => {
    refreshVoiceHints().catch(report);
  }, [
    s.settings.voiceConfigPath,
    s.settings.voiceSkillAliases,
    s.settings.voiceCommandAliases,
  ]);
  useEffect(() => {
    syncLocalFeatures();
  }, [
    s.room?.code,
    s.session?.memberId,
    voiceAllowed,
    s.settings.remindersEnabled,
    s.settings.voiceEnabled,
    s.settings.inputDevice,
    s.settings.outputDevice,
    s.settings.voiceConfigPath,
    s.settings.leads,
    s.settings.announcementNames,
    s.settings.voiceSkillAliases,
    s.settings.voiceCommandAliases,
  ]);
  const audioOn = s.audio === "已启用";
  const voiceOn = s.mic.startsWith("监听中");
  return (
    <main
      className={
        s.settings.compact && s.room?.battle.phase !== "lobby" ? "compact" : ""
      }
    >
      <header>
        <h1>Kaling Timer</h1>
        <span role="status" className={s.connected ? "online" : "offline"}>
          {s.connected ? (s.synced ? "已连接" : "同步中") : "离线 · 重连中"}
        </span>
      </header>
      {s.room && s.room.battle.phase !== "lobby" && (
        <button
          onClick={() => settingsUpdate({ compact: !s.settings.compact })}
        >
          {s.settings.compact ? "展开控制" : "精简视图"}
        </button>
      )}
      <div className="status">
        <span>麦克风：{s.mic}</span>
        <span>音频：{s.audio}</span>
      </div>
      {s.mic !== "关闭" && (
        <details className="voice-diagnostics">
          <summary>麦克风与识别详情</summary>
          <p className="muted">
            麦克风设备：{s.micDevice || "准备中"} · 输入电平 {s.micLevel}%
            <br />
            最近识别：{s.voiceResult || "等待讲话"}
          </p>
        </details>
      )}
      {s.error && (
        <div role="alert" className="error">
          {s.error}
          <button
            aria-label="清除错误"
            onClick={() => useApp.setState({ error: "" })}
          >
            ×
          </button>
        </div>
      )}
      <div className="buttons">
        <button
          aria-pressed={audioOn}
          className={audioOn ? "toggle-active" : ""}
          disabled={!isTauri() || !s.room}
          onClick={() =>
            settingsUpdate({ remindersEnabled: !s.settings.remindersEnabled })
          }
        >
          本地提醒
        </button>
        <button
          aria-pressed={voiceOn}
          className={voiceOn ? "toggle-active" : ""}
          disabled={!isTauri() || !voiceAllowed || !s.connected}
          onClick={() =>
            settingsUpdate({ voiceEnabled: !s.settings.voiceEnabled })
          }
        >
          语音识别
        </button>
        <button
          disabled={!isTauri()}
          aria-pressed={s.settings.overlayEnabled}
          className={s.settings.overlayEnabled ? "toggle-active" : ""}
          onClick={() =>
            settingsUpdate({ overlayEnabled: !s.settings.overlayEnabled })
          }
        >
          悬浮窗
        </button>
        <button
          disabled={!isTauri() || !s.settings.overlayEnabled}
          aria-pressed={s.settings.overlayLocked}
          onClick={() =>
            settingsUpdate({ overlayLocked: !s.settings.overlayLocked })
          }
        >
          {s.settings.overlayLocked ? "解锁悬浮窗" : "锁定悬浮窗"}
        </button>
      </div>
      {!isTauri() && (
        <p className="muted">
          浏览器可测试联机计时；离线语音、预载语音提醒、全局快捷键和托盘需要
          Windows 桌面版。
        </p>
      )}
      {s.room ? <Room now={now} /> : <Admission />}
      <SettingsPanel />
      <footer>
        同步误差估计 ±
        {Number.isFinite(s.syncErrorMs) ? s.syncErrorMs.toFixed(1) : "—"}ms ·
        调度最大迟到 {s.audioLatenessMs.toFixed(1)}ms
        <br />
        仅为软件测量，实际扬声器延迟需实测 · mechanics {mechanics.version}
      </footer>
    </main>
  );
}
const overlayMode = new URLSearchParams(location.search).get("overlay") === "1";
if (overlayMode) document.documentElement.classList.add("overlay-mode");
createRoot(document.getElementById("root")!).render(
  overlayMode ? <Overlay /> : <App />,
);
