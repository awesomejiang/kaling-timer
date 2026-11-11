import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import {
  DifficultySchema,
  ZoneSchema,
  HotkeyActions,
  type Action,
  type Difficulty,
  type SkillId,
  type Zone,
} from "@kaling/shared";
import { project } from "@kaling/timer-engine";
import { mechanics } from "./mechanics";
import {
  useApp,
  connect,
  report,
  createRoom,
  joinRoom,
  assign,
  sendAction,
  retryPending,
  serverNow,
  settingsUpdate,
} from "./client";
import { AudioRuntime } from "./audio";
import { VoiceRuntime, applyNativeSettings } from "./native";
import "./style.css";
const audio = new AudioRuntime(mechanics),
  voice = new VoiceRuntime(audio);
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
  "last-peril-death": "三兽死亡",
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
    [code, setCode] = useState(
      new URLSearchParams(location.search).get("room") ?? "",
    ),
    [difficulty, setDifficulty] = useState<Difficulty>("normal"),
    [busy, setBusy] = useState(false);
  const state = useApp();
  async function submit(join: boolean) {
    setBusy(true);
    try {
      if (join) await joinRoom(code, name, password);
      else await createRoom(name, password, difficulty);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>建立或加入队伍</h2>
      <label>
        称呼
        <input
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
        disabled={!name.trim() || !state.connected || busy}
        onClick={() => submit(false)}
      >
        创建房间 / 单人
      </button>
      <label>
        房间码
        <input
          value={code}
          maxLength={6}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
      </label>
      <button
        disabled={!name.trim() || code.length !== 6 || !state.connected || busy}
        onClick={() => submit(true)}
      >
        加入房间
      </button>
      <p className="muted">
        无需账号。浏览器会话凭据仅保存在当前页面内存；Windows
        版使用凭据管理器保存重连信息。
      </p>
    </section>
  );
}
function TimerCard({
  id,
  now,
  host,
  editable,
}: {
  id: SkillId;
  now: number;
  host: boolean;
  editable: boolean;
}) {
  const room = useApp((s) => s.room)!;
  const config = mechanics.skills.find((s) => s.id === id)!,
    timer = room.battle.timers[id];
  const next = project(room.battle, mechanics, id, now),
    [remaining, setRemaining] = useState(50),
    [shift, setShift] = useState(5);
  return (
    <article className="timer">
      <div className="timer-title">
        <h3>{config.name}</h3>
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
        {next
          ? next.status === "manual"
            ? "手动倒计时"
            : "预测激活 · 未确认施法"
          : config.startEvent === "manual-trigger"
            ? "等待手动触发"
            : id === "p3_fullscreen" && room.battle.lastPerilDeathAt === null
              ? "等待“三兽死亡”事件"
              : timer.firstAt === null
                ? "首轮延迟未配置 · 需要房主校准"
                : "本次倒计时已结束"}
      </p>
      {timer.basis === "last-peril-reference" && (
        <small>
          以三兽死亡作校准参考，下一次 = 参考 + 冷却；首轮延迟仍未知。
        </small>
      )}
      {timer.confirmedAt !== null && (
        <small>
          上次确认施法：{new Date(timer.confirmedAt).toLocaleTimeString()}
        </small>
      )}
      {host && (
        <fieldset disabled={!editable}>
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
    editable = s.connected && s.synced && !s.pending;
  const member = room.members.find((m) => m.id === s.session?.memberId);
  return (
    <>
      <section>
        <div className="row">
          <h2>房间 {room.code}</h2>
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
        <label>
          我的主区域（每区 2 人）
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
              <option
                value={z}
                key={z}
                disabled={
                  member?.zone !== z &&
                  room.members.filter((m) => m.zone === z).length >= 2
                }
              >
                {names[z]} ({room.members.filter((m) => m.zone === z).length}/2)
              </option>
            ))}
          </select>
        </label>
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
                三兽死亡
              </button>
              <button
                className="danger"
                onClick={() => perform({ type: "reset" })}
              >
                重置战斗
              </button>
            </div>
            {room.battle.phase === "p1" &&
              ZoneSchema.options.map((zone) => (
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
                    {names[zone]}区域校准
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
          {mechanics.skills
            .filter((skill) => skill.phase === room.battle.phase)
            .map((skill) => (
              <TimerCard
                key={skill.id}
                id={skill.id}
                now={now}
                host={host}
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
  const s = useApp(),
    settings = s.settings,
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [server, setServer] = useState(settings.serverUrl);
  async function devicesRefresh() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    setDevices(await navigator.mediaDevices.enumerateDevices());
  }
  return (
    <details>
      <summary>本地设置</summary>
      <div className="settings">
        <label>
          服务地址
          <input
            value={server}
            placeholder="默认本机服务器"
            onChange={(e) => setServer(e.target.value)}
          />
        </label>
        <button
          disabled={!!s.room}
          onClick={() => {
            try {
              if (server && !/^https?:\/\//.test(server))
                throw new Error("服务地址需要 HTTP(S)");
              settingsUpdate({ serverUrl: server });
              connect().catch(report);
            } catch (error) {
              report(error);
            }
          }}
        >
          应用服务地址
        </button>
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
            onChange={(e) => settingsUpdate({ volume: Number(e.target.value) })}
          />
        </label>
        <button onClick={() => devicesRefresh().catch(report)}>
          授权并刷新设备
        </button>
        {(["input", "output"] as const).map((kind) => (
          <label key={kind}>
            {kind === "input" ? "麦克风" : "扬声器"}
            <select
              value={
                kind === "input" ? settings.inputDevice : settings.outputDevice
              }
              onChange={(e) => {
                audio.stop();
                voice.stop().catch(report);
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
          修改语法或输入设备后重新启用语音。完整句式、无唤醒词；建议使用耳机，输入启用回声消除。
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
        <label>
          鸟区同时激活优先项
          <select
            value={settings.birdPriority}
            onChange={(e) =>
              settingsUpdate({
                birdPriority: e.target.value as typeof settings.birdPriority,
              })
            }
          >
            <option value="p1_bird_scroll">鸟画卷</option>
            <option value="p1_bird_flight">鸟飞行</option>
          </select>
        </label>
        <fieldset>
          <legend>P1 额外区域订阅（不占主区域名额）</legend>
          {ZoneSchema.options.map((zone) => (
            <label key={zone}>
              <input
                type="checkbox"
                checked={settings.extraZones.includes(zone)}
                onChange={(e) =>
                  settingsUpdate({
                    extraZones: e.target.checked
                      ? [...settings.extraZones, zone]
                      : settings.extraZones.filter((z) => z !== zone),
                  })
                }
              />
              {names[zone]}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>每技能提醒（启用时始终包含 5、4、3、2、1）</legend>
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
                      audio.stop();
                    } catch (error) {
                      report(error);
                    }
                  }}
                />
              </label>
            </div>
          ))}
        </fieldset>
        <fieldset>
          <legend>全局快捷键（MapleStory 聚焦时也有效）</legend>
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
        </fieldset>
      </div>
    </details>
  );
}
function App() {
  const s = useApp(),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    connect().catch(report);
    applyNativeSettings().catch(report);
    const id = setInterval(() => setNow(serverNow() ?? Date.now()), 100);
    return () => clearInterval(id);
  }, []);
  const host = !!s.room && s.session?.memberId === s.room.hostId;
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
          onClick={() =>
            audio.enable().catch((error) => {
              audio.stop();
              report(error);
            })
          }
        >
          启用本地提醒
        </button>
        <button onClick={() => audio.stop()}>停止提醒</button>
        <button
          disabled={!host || !s.connected}
          onClick={() => voice.start().catch(report)}
        >
          启用语音
        </button>
        <button onClick={() => voice.stop().catch(report)}>停止语音</button>
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
createRoot(document.getElementById("root")!).render(<App />);
