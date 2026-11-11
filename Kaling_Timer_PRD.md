# Kaling Timer — Product Requirements Document

Version: 1.2 (P1 zone-member control and assigned-zone audio, 2026-11-10)
Platform: Windows 10/11 desktop
Stack: Tauri 2 + React + TypeScript; Node.js/TypeScript + Socket.IO cloud server
Audience: Codex implementation agent

## Goal and boundaries
Build a compact, low-overhead multiplayer companion timer for MapleStory Kaling. The app helps 1–6 players track boss mechanics and choose their own 20-second damage burst timing (typically beginning with a 24-second Bind). It does not recommend burst windows. It must not inspect game memory, inject code, automate game actions, OCR the screen, or automatically detect Bind or boss phases. Authorized member control is voice-first but also supports buttons and global hotkeys while MapleStory has focus.

## Core gameplay configuration
Difficulty selected at room creation, changeable before battle, locked during battle. All skill identifiers must be unique; cooldowns and initial delays stored in validated external mechanics configuration, not scattered through code. Known values:

| Phase | Skill ID | Chinese name | Cooldown/length | Mode |
|---|---|---|---|---|
| P1 Bird | p1_bird_scroll | 鸟画卷 | 60s | recurring, cast-based prediction |
| P1 Bird | p1_bird_flight | 鸟飞行 | Easy/Normal **20s**; Hard/Extreme **18s** | recurring, cast-based prediction |
| P1 Tiger | p1_tiger_pillars | 虎柱子连线 | **30s one-shot countdown** | manually triggered each time, never auto-restart |
| P1 Dog | p1_dog_minigame | 狗小游戏 | 60s | recurring prediction, independent calibration |
| P2 | p2_kaling_flight | 卡琳飞行 | **18s** | recurring, cast-based prediction; Bind can delay actual cast |
| P2 | p2_kaling_minigame | 卡琳小游戏 | **60s** | fixed recurring cycle; **Bind does not change the cycle** |
| P2 | p2_kaling_scroll | 卡琳画卷 | **30s** | cast-based prediction; countdown starts from the last confirmed cast |
| P3 | p3_fullscreen | 卡琳全屏 | Easy/Normal **60s**; Hard/Extreme **30s** | recurring prediction, starts only after explicit last-peril-death event |

Initial delays/first activation offsets have not all been established. Represent these as nullable config values and visibly mark unconfigured timers rather than inventing values. Allow assigned P1 zone members, and the host in P2/P3, to calibrate anchors. For P3, the host's “三凶兽死亡” command marks the death of the last of the three perils and starts the P3 full-screen timer reference; apply configured initial delay if provided, otherwise use explicit calibrated reference semantics and document them. P3 timer must not start simply on selecting phase P3.

## Battle and zone lifecycle
Room initially in lobby. Host says “开始战斗” or clicks/hotkey to begin P1. Server records authoritative battleStartAt and **starts Bird, Tiger, Dog zone reference clocks simultaneously**. Each zone has its own zoneStartAt and can later be individually calibrated. Zone-start recalibration changes only timers that have **not** been individually skill-calibrated. A Bird Flight skill calibration must survive a subsequent Bird zone-start correction. Tiger's 30-second one-shot is still only started on explicit manual trigger, not automatically at battle start.

Host changes phases manually by voice, button, or global shortcut. “进入二阶段” switches to P2 and waits for the boss. “二阶段开始” confirms that the boss has appeared and starts the P2 timers with each configured first delay or full cooldown. P3 full-screen starts from explicit “三凶兽死亡” event. Cancel previous-phase audio on transitions. No automatic phase detection. Host can reset battle.

## Prediction, Bind and correction semantics
**Predictive mode is default.** For a recurring timer, predict subsequent activations by adding the configured cooldown, automatically advancing even without confirmation. Distinguish predicted from confirmed activations in model, UI, and logs. Do not mistake predicted events for observed casts.

For cast-based skills, Bind delays actual cast and the next cooldown starts **from actual delayed release**. Do not introduce a “Bird Bound” state or ask players to operate the app during burst. The assigned zone member in P1, or the host in P2/P3, observes the actual cast after burst and manually/verbally calibrates; replace obsolete predicted timeline and cancel stale alerts. **P2 minigame's 60-second fixed cycle is never shifted by Bind or by P2 Flight recalibration.** Each skill's calibration is independent.

Voice commands:
- “狗校准”: skill just occurred; anchor at estimated spoken event time; next = anchor + cooldown.
- “狗校准50秒”: **50 seconds remaining until next activation at the spoken reference time** (not elapsed since previous cast). If speech recognition completes 1.5s later, about 48.5s should remain then.
- “狗加5秒”, “鸟飞行减2秒”: shift next activation by ±seconds, preserving cooldown.
- “撤销狗校准”: undo previous change, reconstruct from stored absolute timestamps and versioned state, not stale displayed seconds. Keep at least 10 per-skill history entries; zone corrections undoable too.
- “鸟开始” calibrates the Bird zone. If first-cast timing is unknown, use each uncalibrated skill’s cooldown as its first countdown. “鸟画卷校准” and “鸟飞行校准” calibrate the respective individual skills.

P1 timer mutations belong to members assigned to the timer's primary zone. Members in the current zone may calibrate its skills and zone reference, shift deadlines, undo changes, and trigger the tiger one-shot in the tiger zone. Host status grants no cross-zone override. Only the host controls battle start/reset, phase transitions, difficulty and P2/P3 shared timers. Enforce all permissions server-side and apply them equally to buttons, voice and hotkeys. Timestamp commands using estimated speech onset when available, otherwise adjustable recognition compensation default **1.5s**, range 0–3s. Avoid double compensation. Buttons/hotkeys do not receive speech compensation. Use server-authoritative event time, clock sync and monotonic local elapsed clocks; absolute deadlines, never decrementing interval counters.

## Voice recognition and configuration
Local/offline Windows recognition preferred. Always listening when enabled even with game focused, **no wake word**. Accept only complete valid utterances defined in an editable external YAML/JSON command configuration, with aliases, parameterized grammar and Chinese numerals. Reject unrelated conversation, ambiguous or partial matches, duplicate results and unauthorized commands. Examples: 开始战斗, 进入二阶段, 进入三阶段, 三凶兽死亡, 狗校准, 狗校准50秒, 鸟飞行减2秒, 撤销狗校准. Include configurable zone-start calibration and tiger one-shot command mappings. Local short acknowledgement on accepted commands. Recognition must continue during spoken reminders; prevent feedback from own speakers (strict grammar, deduplication, device selection and echo mitigation). No unnecessary microphone audio upload.

## Audio reminder behavior
Each player schedules local reminders based on synchronized authoritative timestamps. Support configurable lead times (e.g., 30s, 10s) and mandatory capability for individual **5, 4, 3, 2, 1** last-five-second spoken countdown. Prefer preloaded audio clips and accurate per-second scheduling; never queue stale numbers. Client-specific volume, mute, per-skill reminder selection, device selection. Invalidate and cancel audio on calibration/version changes, phase changes, resets.

**P1 Bird:** If Bird Scroll and Bird Flight predicted activations differ by **≤5s**, announce **only the earlier activation** for that pair; the later skill's current notification cycle is suppressed. Both underlying timers continue, remain visible and calibratable. If equal, use deterministic configurable tie-break priority. Outside the conflict window announce both subject to avoiding simultaneous audio.

**P2:** Minigame must receive complete priority countdown. If Flight predicted activation falls in the **5 seconds immediately before Minigame** (including equality), suppress that Flight notification cycle. If Flight is after Minigame, it may be announced; don't interrupt Minigame audio and don't replay expired Flight numbers. If sufficiently before, announce both. Conflict window configurable, default 5s. Do not globally apply a symmetric “earliest wins” policy to P2.

P1 Bird and P2 are the key multi-timer conflict cases. Other simultaneous alerts must be handled deterministically without overlapping stale audio. Suppression affects **audio only**, never underlying timer schedules. **Do not display or announce burst safety recommendations.**

## Multiplayer
Cloud Socket.IO room with short join code/link, optional password, secure host capability token and member session tokens, no accounts. **1–6 players including host**, solo supported. Each player chooses a starting zone in the lobby and can enter any P1 zone through voice or buttons. There is no per-zone player cap. The host reset restores starting assignments. P1 plays only the assigned primary zone's audio; unassigned players receive no P1 reminders. There is no extra-zone audio subscription feature. P2/P3 whole-team audio by default; every member can adjust local audio preferences.

Only host may start/reset, change phases, change difficulty before battle, and control P2/P3 timers. Each P1 zone's assigned members control that zone's calibration, shifts, one-shots and undo. All members can view timers, choose an available primary zone, and configure local audio. Changing primary assignment transfers P1 control to the new zone immediately; stale concurrent commands are rejected and reconciled. Server validates every mutation. Room and timers survive temporary host disconnect; reconnect with token. On reconnect send full authoritative snapshot, including phase, battle ID, anchors, versions, assignments and mechanics version. Do not require receiving every tick. Idempotent commands (unique commandId), monotonic state versions, stale-update rejection, deterministic concurrent update ordering, server timestamps. Persist active room/battle, calibration history, assignments and host credentials appropriately; rate limit and validate all input.

## Desktop UI
Dark compact resizable always-on-top Windows 10/11 window; tray/background mode; large readable timer digits; current phase, difficulty, room code, member/zone assignments, microphone/listening status, network status, prediction vs confirmed status, and concise event log. Host controls for start, phases, P2/P3 timers, P3 last-peril event and reset. P1 members see controls for their own zone's skill/zone calibration, tiger manual timer where applicable, and undo. Local settings for input/output devices, volume, per-skill lead times, per-skill reminder selection, always-on-top, global hotkeys, speech compensation, external command config path, conflict window. Global shortcuts work with MapleStory focused, detect shortcut conflicts, never simulate in-game inputs. Persist local settings and reconnect details securely.

Global hotkeys are opt-in: every action defaults to a blank binding. On upgrade
from the previous defaults, clear saved bindings once while preserving other
settings. Bindings explicitly configured after this migration persist normally.

Local reminders and voice recognition each use one toggle button. Highlight the
button only while that feature is running. Both preferences default to enabled;
activate them automatically on native room admission/reconnect when permitted.
Respect microphone permission and P1 zone assignment, display startup failures,
and persist an explicit user choice to disable either feature.

Default window size is 760×900, with a compact two-column timer layout that fits
the ordinary P1 screen without scrolling at that size. Detailed microphone
diagnostics start collapsed. Show voice calibration examples beside each skill,
derived from the current external command configuration; tiger shows its manual
trigger phrase instead of a recurring-cast calibration phrase.

Provide a separate transparent always-on-top overlay with assigned-zone P1 timers
and team P2/P3 timers, phase, prediction status and voice calibration hints. It can
be dragged/resized, hidden, given adjustable background opacity, and locked for
mouse pass-through. Main-window and tray controls must restore editing without
requiring a shortcut. Keep one room/audio/voice runtime in the main window;
overlay snapshots contain no session tokens. Validate visibility with the game.

## Architecture and suggested monorepo
- `apps/desktop`: Tauri 2, React, TypeScript, Vite, Tailwind, Zustand, native Rust integration for speech/hotkeys/tray where appropriate.
- `apps/server`: Node.js/TypeScript, Socket.IO, SQLite initial persistence, Docker Compose.
- `packages/shared`: schemas (e.g. Zod), event contracts, phase/difficulty/skill identifiers.
- `packages/timer-engine`: deterministic pure timer calculations, prediction, calibration, undo, absolute timestamps.
- `packages/mechanics`: difficulty-specific mechanics config schema/loader.
- `config/mechanics.yaml`, `config/voice-commands.yaml`.
- Automated unit/integration/e2e tests, README, deployment and build instructions.

No frontend-only authority for shared state. Clients locally project time and schedule audio; server handles commands, validation and state changes. Aim for <100ms local audio timing error and <250ms typical sync on healthy network, measuring rather than assuming. Offline clients can display projected timers but cannot treat unsent edits as authoritative. On reconnect reconcile state. Do not hardcode secrets.

## Mandatory acceptance tests
1. P1 Bird Flight is **20s E/N, 18s H/EX**; P3 full-screen **60s E/N, 30s H/EX**; P2 Flight **18s** independently.
2. Start battle initializes three zone references together; adjusting Bird zone after individually calibrating Flight changes Scroll but not Flight. Tiger manual 30s countdown never auto-repeats.
3. Predicted cycles auto-advance without confirmation; Bind-delayed actual cast calibration reanchors next CD and invalidates old alerts; no Bind-state UI required.
4. P2 minigame fixed 60s cycle does not shift when Flight is recalibrated, including due to Bind.
5. “狗校准50秒” sets target 50s after spoken reference; 1.5s recognition delay leaves ~48.5s at recognition completion. Undo restores timeline correctly even after several predicted cycles.
6. Bird Scroll at T+10, Flight T+13 -> only Scroll audio. Bird Flight T+10, Scroll T+13 -> only Flight audio. Both timers still run.
7. P2 Flight at T+10, Minigame T+13 -> skip Flight audio, play complete Minigame countdown. Minigame T+10, Flight T+13 -> preserve Minigame and allow eligible later Flight audio, never late numbers.
8. P3 full-screen does not start just by entering P3; starts only after host “三凶兽死亡” command; difficulty CD applied.
9. All 1–6 player counts work; players can share a P1 zone without a two-player cap and reset returns each to their starting zone; current zone members can control their own zone; cross-zone timer mutations are rejected even for the host; P1 audio is restricted to the assigned zone; no extra-zone subscription controls; battle lifecycle and P2/P3 mutations remain host-only on the server.
10. Voice recognition while MapleStory focused and while reminder audio plays; configurable no-wake-word grammar; global hotkeys; reconnect after host/client disconnect; tray and always-on-top.

## Implementation milestones
1. Monorepo, desktop shell, server, shared contracts, validated mechanics config.
2. Deterministic timer engine and comprehensive tests (prediction, zone anchors, calibration, fixed cycle, difficulty, undo).
3. Multiplayer room state, host permissions, clock sync, reconnect, persistence.
4. Audio scheduler and phase-specific conflict policies.
5. Local Windows voice recognition, configurable grammar, latency compensation and global shortcuts.
6. Polished compact UI, tray, settings, Windows packaging, docs and deployment.

Deliver working vertical slices, test each milestone, and report unknown initial delays explicitly rather than inventing game data. Do not silently simplify requirements or add burst-window recommendations.
