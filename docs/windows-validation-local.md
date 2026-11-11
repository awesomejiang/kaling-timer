# Local Windows validation — 2026-11-10

Executed in `E:\git\kaling-timer` on the user's local Windows PC, not a cloud
`/workspace`. Times and date refer to America/New_York. Desktop interaction was
paused at the user's request; no further window input is authorized until resumed.

## Installed prerequisites

| Component           | Observed result                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| OS                  | Windows 10 Pro x64, 10.0.19045                                                                                   |
| Shell               | PowerShell 7.6.9; Windows PowerShell 5.1.19041.6456 executes successfully                                        |
| Node/npm            | Node 24.22.1 / npm 11.19.1; official Windows archive SHA256 checked                                              |
| User Node directory | `%LOCALAPPDATA%\Programs\kaling-node\node-v24.22.1-win-x64` (added to user PATH; reopen terminals to pick it up) |
| Rust                | stable x86_64-pc-windows-msvc; rustc 1.99.1, cargo 1.99.1                                                        |
| C++ tools           | Visual Studio 2022 Build Tools, installation version 17.14.37827.9, VCTools workload with recommended components |
| SDK                 | Windows SDK 10.0.26100.0; x64 resource compiler present                                                          |
| WebView2            | Existing installed runtime 157.0.4341.42                                                                         |
| Offline recognition | System.Speech loads in Windows PowerShell; zh-CN recognizer MS-2052-80-DESK present                              |
| TTS                 | Microsoft Huihui Desktop zh-CN present                                                                           |
| Browser tests       | Playwright Chromium 1254 and supporting binaries installed                                                       |

## Completed checks

- `npm ci`: completed. Initial audit found three development dependency
  vulnerabilities. Upgraded Vitest from 3.x to 4.1.12 and updated the lockfile;
  `npm audit` then reported zero vulnerabilities.
- `npm run typecheck`: passed.
- `npm test`: 7 suites, 50 tests passed on Windows, including after a build.
- `npm run build`: passed. Vite emitted non-failing third-party PURE annotation
  warnings from Zod.
- `npm run test:e2e`: both Chromium workflows passed on Windows (host/member
  lifecycle and offline projection/reconciliation).
- `cargo check --locked --manifest-path apps/desktop/src-tauri/Cargo.toml`:
  passed with the native MSVC target.
- `npm run test:windows:speech`: real System.Speech synthesis plus streamed
  synthetic 16 kHz mono PCM recognition passed without microphone capture or
  speaker playback. The grammar in this smoke check has three phrases; it does
  not establish performance of the full application grammar.
- Synthesized countdown durations: 5 = 875.0 ms, 4 = 863.9 ms, 3 = 886.1 ms,
  2 = 819.4 ms, 1 = 819.2 ms; all satisfy the application's 900 ms clip limit.
- Synthetic `狗校准五十秒` recognized with confidence approximately 0.995,
  above the application's 0.7 acceptance threshold. This is not human speech
  accuracy or end-to-end voice command timing validation.
- `npm run tauri -w @kaling/desktop -- build`: native optimized release and
  NSIS x64 installer built successfully, including the speech fix below.
- NSIS silent installation returned exit code 0; installed application 0.2.0
  registered under the current user's uninstall registry and launched.
- Native WebView loaded `http://tauri.localhost/` and displayed `已连接` to
  the local server. `/health` reported protocol 1 and mechanics 1.0.0.

Initial installed baseline installer (subsequent local builds replace this file):
`apps/desktop/src-tauri/target/release/bundle/nsis/Kaling Timer_0.2.0_x64-setup.exe`

Initial installed baseline SHA256:
`B33A759827975369CA6218793C468C68026CC8399CCBB2ADDF9636F4E36E91FF`

Installed application: `%LOCALAPPDATA%\Kaling Timer\kaling-timer.exe`.
Installer remains unsigned. Signing and distribution validation are outstanding.

## Fixes and observed issues

1. The original speech bridge failed at `SetInputToAudioStream` because the stdin
   pipe does not expose `Length`/`Position`. Added a forward-only PCM adapter that
   tracks position and exposes an unbounded live length without retaining audio.
   Its reads fill the requested buffer so a normal short pipe chunk is not
   interpreted by COM as EOF. The real streamed PCM smoke check reproduces the
   original failure and passes with the fix.
2. A post-build test run discovered compiled `dist/tests` copies and failed on
   missing `dist/config` files. Added an explicit Vitest include for
   `tests/**/*.test.ts`; all 50 source tests pass after the build.
3. The native UI correctly reported that default `Ctrl+Alt+T` was already
   registered on this PC. Registration is rolled back by the application when
   any binding fails. Choose an unused tiger binding in Local Settings and apply
   it before testing global hotkeys. No local shortcut settings were changed.
4. Desktop automation could read the native accessibility tree, but screenshot
   capture of the installer timed out and an attempted Create Room click reported
   `coordinate input geometry is unavailable`. The click outcome is unverified;
   no native room lifecycle or credential persistence pass is claimed.

## Pending interactive acceptance

- Enable desktop microphone access if needed and select the intended input/output
  devices. No Windows privacy settings were changed automatically.
- Create/confirm a solo room, assign a primary zone, and enable voice/reminders.
  Say `开始战斗`, `狗校准五十秒`, `狗校准`, `撤销狗校准`, and phase/tiger/zone
  commands. Check the shared event log and local acknowledgement.
- Test rejection of ambiguous/partial/unrelated utterances, then test continued
  recognition during reminders with headphones and speakers separately.
- Resolve `Ctrl+Alt+T` conflict, then test each global shortcut with MapleStory
  focused. No game input injection is implemented or tested.
- Check Bird/P2 reminder conflicts by listening; test volume, mute, devices,
  calibration cancellation and full 5–1 countdown.
- Tray hide/Show/Quit, always-on-top, resizing, settings persistence and at least
  ten minutes of background operation.
- Native Credential Manager reconnect after app/server restarts; temporary
  host/client disconnects and multi-PC healthy-network measurements.
- At least 100 acoustic cue onset measurements with p50/p95/max. Software clock
  uncertainty shown in the footer does not measure physical speaker latency.

PRD acceptance test 10 and the <100 ms acoustic / <250 ms typical multi-PC sync
targets remain open. Automated and synthetic checks do not establish them.

## P1 permissions and audio follow-up

The user changed the requirements after the initial installation: P1 timer control
belongs to assigned zone members, and extra-zone audio subscriptions are removed.
Both members of a zone can calibrate/shift/undo; tiger members can trigger their
single-shot. The host has no cross-zone override. Battle lifecycle and P2/P3 timer
controls remain host-only. Voice and shortcut handling use the same permission
policy as the server; native shortcuts are re-registered on phase/assignment changes.

The updated source passed type checking, all 52 tests, a production frontend build,
and both Windows Chromium e2e flows. Coverage includes a dog-zone member operating
their timer while the bird-zone host cannot, same-zone concurrent stale commands,
assignment changes revoking control, tiger permissions, removed subscription UI,
and migration preserving other settings. E2E services now use a separate port 3002
and test SQLite database so the existing local server on 3001 remains untouched.

The updated installer was subsequently installed after the user resumed desktop
control; silent installation returned 0 and the local server was restarted with
the updated permission policy. Installer SHA256:
`BE6B76DDBB4B92225CACEDC94F09D38F97F6017CE291DE705F2C82A858DBC133`.
The installed binary differs from the build output only at the three-byte Tauri
bundle marker (`R_NSS` vs `R_UNK`).

## Resumed native validation

- Native screenshot capture still fails (`FrameArrived timed out`, then
  `window capture timed out` after refreshing the window). Accessibility text is
  readable, but automated clicking is unavailable; the user performed the clicks.
- The user created a solo room named Windows验收, selected dog, and enabled
  reminders and voice. Native accessibility state confirms `已连接`,
  `监听中 · 本地离线`, and `音频：已启用` without a speech/audio error.
- The host's lifecycle binding `Ctrl+Alt+R` is occupied on this PC. The native UI
  reports the conflict and rolls back shortcut registration. Remapped the local
  reset binding to `Ctrl+Alt+Shift+R`; after clicking registration the user confirmed
  no error remained. Actual hotkey execution with another app/game focused remains
  outstanding.
- The speech smoke test now loads the full shipped YAML grammar (9,614 phrases)
  and passes streamed synthetic recognition with confidence approximately 0.994.
  This supersedes the earlier three-phrase smoke-check limitation.
- Human voice initially had no effect. After the user refreshed/selected the
  microphone and re-enabled listening, `开始战斗` succeeded. The user then
  confirmed `狗校准五十秒`, `狗校准`, and `撤销狗校准` produced correct
  timer changes and local acknowledgement sounds. All four actions appear in the
  authoritative server event log (room versions 2–5). This establishes this command
  subset on the selected device, not every command or game-focus behavior.
- Added local microphone device/level and last-result diagnostics, including
  rejected utterance feedback, to help distinguish silent input from recognition
  failure. Raw audio is neither recorded nor uploaded. The updated native installer
  built and installed successfully (exit 0); SHA256:
  `2AD8DF77574F3E05A4664B46AE0A00D2504A0EBA75547F9238CB8C1B6C5AAE48`.
- After stopping/reopening the installed app, it automatically resumed the same
  room, dog assignment, P1 battle and version-5 history. This exercises native
  Credential Manager restoration. The server was subsequently stopped/restarted;
  the client reconnected and retained the same state from SQLite.
- The user confirmed the complete 5,4,3,2,1 countdown after `狗校准十秒`,
  continued voice-triggered countdown with the window closed to tray, tray Show
  restoration, and `Ctrl+Alt+2` changing to P2 with another application focused.
  MapleStory was not running; game-focus acceptance remains open. This was a
  short background check, not the required ten-minute endurance run.
- Physical Bird/P2 reminder conflict tests, the full voice command set and
  game-focus checks remain pending. User-reported playback and acknowledgement
  sounds are not acoustic timing measurements.

## Opt-in hotkeys follow-up

At the user's request, all global hotkeys now default to blank. A one-time
migration clears bindings from the earlier version (including this PC's remapped
reset key) while preserving other local settings. Later manually entered bindings
are retained. Settings UI explains that blank disables a binding. Type checking
and all 53 tests passed, including legacy migration and later binding persistence.
The updated NSIS installer built and installed successfully (exit 0); the app was
reopened to apply the migration to this PC's saved settings.

## Reminder and voice toggles follow-up

Replaced four start/stop buttons with two toggle buttons, using green highlighting
and `aria-pressed` only when running. Both preferences default on; native room
admission/reconnect starts eligible features automatically. Explicit off choices
persist. Device/grammar changes are serialized with feature startup/shutdown.
Microphone permission and zone-based authorization still apply. Type checking,
54 tests and both browser e2e flows passed. The build installed successfully
(exit 0). After reopening, native accessibility state confirmed exactly two
feature toggle buttons and automatic `监听中 · 本地离线` / `音频：已启用`
without a manual start click or new error. Prior room state was restored. Actual
highlight colors are defined in CSS; screenshot capture remains unavailable.

## Default window and voice hints follow-up

Changed the default native client size from 480×760 to 760×900 and tightened the
compact layout. Microphone diagnostics are collapsed by default. A headless
Chromium layout check at 760×870 (allowing for the native title bar) confirms the
P1 compact screen fits through the footer; at 360 px width there is no horizontal
overflow. The generated default-layout screenshot was visually inspected.

Each skill displays calibration voice examples generated from the configured
aliases/templates and checked against the actual grammar. Tiger shows its
configured manual-trigger phrase. External command configuration is reflected
in the hints. Type checking, 55 tests and all three browser e2e flows passed.
The native installer was built and installed successfully (exit 0), then reopened
with the new default size and current room restored.

## Overlay follow-up

Added a separate transparent, frameless, always-on-top, resizable overlay with
drag region, primary-zone filtering, phase and prediction status, voice hints,
local audio/voice status, background opacity, mouse pass-through lock, and
main-window/tray editing recovery. Main remains the single socket/microphone/audio
runtime; only public display state crosses to the overlay. Stale updates are
labelled as offline projection while absolute deadlines continue locally.

Type checking and the native MSVC compile check passed. All 55 unit/integration
tests and four browser e2e flows passed. The new overlay flow verifies real
main-to-overlay updates, zone filtering, P2 transition, opacity, lack of an extra
Socket.IO connection and projection after main updates cease. Dog/Bird overlay
screenshots were inspected. Native drag/resize, transparency, pass-through and
tray recovery need interactive confirmation after installation; MapleStory was
not used for these browser checks.

First native launch exposed WebView2 `0x8007139F` when creating the second window:
the overlay's browser arguments differed from the main window's shared WebView2
environment. Matched the autoplay/background arguments and rebuilt. This is a
native runtime finding that browser-only tests did not cover.
After reinstalling (exit 0), both `Kaling Timer` and `Kaling Timer Overlay`
windows were observed. Native overlay accessibility confirms the P2 skill names,
cooldowns, voice hints, synchronized status and reminder/voice-on indicators;
the main window has no runtime error. The user was asked to verify native
drag/resize, mouse pass-through and editing recovery. Those interaction checks and
game visibility remain pending until explicitly reported.

The user then reported that windowed MapleStory covered the overlay when focused
(no administrator prompt reported). This fails the game-focus topmost acceptance.
Added a native Win32 Z-order reassertion for the app's visible overlay on focus
loss and every 750 ms. Uses `HWND_TOPMOST` with `SWP_NOACTIVATE`, `SWP_NOMOVE`,
`SWP_NOSIZE` and `SWP_NOOWNERZORDER`; it neither activates nor shows hidden windows.
Tao's normal `set_always_on_top(true)` short-circuits when its cached flag is
unchanged, so repeating that call alone would not reassert Z order. The native
MSVC check and release/NSIS build passed. The new installer completed with exit
0 and both windows relaunched. The user retested inside windowed MapleStory with
the overlay locked and confirmed: "一直可见，游戏操作正常". This verifies the
reported occlusion issue is resolved on this PC. Exclusive fullscreen and
long-duration stability remain untested.

Renamed the lock control to “锁定悬浮窗” / “解锁悬浮窗”, including tray and
footer wording. Settings explains that locking lets the mouse operate the game
behind the overlay. This changes labels only, not pass-through behavior.
