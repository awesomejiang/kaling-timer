# Windows acceptance run

These hardware/OS checks are outstanding until performed on Windows 10/11.
The Linux cloud browser and Windows-target Rust type check cannot establish them.

The [2026-11-10 local Windows report](windows-validation-local.md) records the
native build, installer and automated speech checks completed on the local PC.
Interactive desktop, microphone, game-focus and acoustic checks remain pending.

## Prerequisites and build

Install Node 24 LTS, Rust stable MSVC, Visual Studio C++ Build Tools with a Windows
SDK, and WebView2. Enable microphone access for desktop apps in Windows privacy
settings. Install Simplified Chinese speech recognition and a Chinese TTS voice.
The recognizer uses .NET Framework `System.Speech` in Windows PowerShell 5.1,
not the online Windows dictation service or browser speech recognition. Some
Windows language installations expose only OneCore voices, which are not visible
to System.Speech; the app reports the missing recognizer/voice explicitly.

```powershell
npm ci
npm run typecheck
npm test
npm run build
# Windows-only, silent synthetic PCM check; does not open or use the microphone
npm run test:windows:speech
# Terminal 1
npm run dev -w @kaling/server
# Terminal 2
npm run desktop
# Release NSIS installer (unsigned)
npm run tauri -w @kaling/desktop -- build
```

Release installers are under `apps/desktop/src-tauri/target/release/bundle/nsis`.
There is no code-signing identity configured; distribution signing is a deployment
prerequisite, not a reason to disable Windows security checks.

## Required interactive checks

1. Create a solo room. Choose a primary zone. Start P1 and calibrate each active
   skill. Confirm unknown initial delays were not silently populated.
2. Enable local reminders. The app synthesizes Chinese clips once via local SAPI,
   rejects last-five clips longer than 900ms, then decodes/schedules Web Audio.
   Choose an output device, verify volume/mute and all spoken 5,4,3,2,1 numbers.
   Test Bird and P2 cases from PRD acceptance tests 6 and 7 by setting remaining
   times as a Bird-assigned member in P1 and as host in P2. Check both underlying
   timers keep advancing. P1 audio must follow the assigned primary zone only.
3. Enable voice, choose the intended microphone, and focus MapleStory. Say
   `狗校准`, `狗校准五十秒`, `鸟飞行减两秒`, `撤销狗校准`, phase commands,
   tiger and zone commands. Verify accepted commands appear in the server event
   log and acknowledgement is local. `鸟校准`, partial sentences and unrelated
   speech must have no effect. Verify the recognizer stays active during reminders.
   Test with headphones and speakers separately; confirm echo cancellation works
   for the selected driver. Raw PCM is sent only to the local PowerShell process.
   In P1, use the member assigned to the command's zone. Both members of that zone
   may control it; unassigned and cross-zone commands must be rejected, including
   from the host. Battle lifecycle and P2/P3 controls remain host-only.
4. Register each desired global shortcut in settings while MapleStory is focused.
   Test an occupied shortcut and verify conflict reporting. No input is injected
   into MapleStory. Calibration, undo and zone actions have optional blank bindings.
5. Test at least 10 minutes hidden/minimized. The Windows WebView is configured
   to disable Chromium background timer/renderer throttling; this is still a
   device/runtime acceptance check, not a timing guarantee. Close the window: it hides to the tray. Restore with tray Show, verify timers,
   listening and reminders continued. Toggle always-on-top, resize the window,
   verify settings persist, then exit using tray Quit.
6. Restart the desktop/server. The Windows credential manager restores the session;
   SQLite restores battle, history and assignments. Disconnect the host while other
   members remain; reconnect and confirm full authoritative state. Offline clients
   must not submit edits. Exercise 1–6 players and two primary slots per zone.
7. Measure actual speaker onset against authoritative deadlines for at least 100
   last-five cues, including background/tray operation. The footer reports scheduler
   lateness and RTT/2 clock uncertainty, not acoustic latency. Record p50/p95/max
   and verify the PRD <100ms local-audio and <250ms typical healthy-network sync
   targets. OS device buffers, WebView background behavior and physical playback
   cannot be validated by unit tests.

Do not mark PRD acceptance test 10, audio timing targets, or Windows packaging as
passed based only on compilation or mocked tests. Keep this file updated with
actual Windows version, device/driver, results and any failed cases.
