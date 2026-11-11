# Implementation evidence

Local Windows follow-up: see the [2026-11-10 report](windows-validation-local.md).
Subsequent P1 requirements update: assigned members now control their own zone,
including calibration/undo and tiger triggering; the host has no cross-zone
override. P1 audio follows only the primary zone, and extra-zone subscriptions
have been removed with migration of saved settings. Shared server/client
permission checks cover buttons, voice and shortcuts.
The MSVC release build, NSIS installation, real System.Speech synthetic PCM smoke
check, 50 tests and two Windows Chromium e2e tests have now passed on the local PC.
On the local PC, human speech start/calibration/undo with acknowledgement and
native solo-room reconnect after app/server restarts have also been verified.
The user also verified the full 5–1 countdown, short tray/background voice operation
and tray restoration, plus a global phase shortcut with another application focused.
Game focus, physical audio timing, full speech grammar, ten-minute background
endurance and multi-PC reconnect acceptance remain unverified. The cloud evidence below is
historical and does not describe the current local execution environment.

Overlay follow-up: after native Z-order maintenance was added, the user confirmed
the locked overlay remains visible over windowed MapleStory while game input
works normally. Exclusive-fullscreen and endurance checks remain open.

Milestones 2 and 3 have working tested vertical slices. Milestones 4–6 have their
core implementation, pure/browser tests, and a successful Windows-target Rust
compile check. They still require the [Windows acceptance run](windows-validation.md)
before claiming completed Windows behavior or release readiness.

Verified in this cloud instance:

- TypeScript type checking and Vite production build.
- 50 unit/integration tests, including actual Socket.IO clients and SQLite reopening.
- Two Chromium e2e workflows: host/member shared battle lifecycle, and offline
  projection/disabled edits/reconnect reconciliation.
- `cargo check --locked --target x86_64-pc-windows-gnu` with the actual Windows
  branches of the speech bridge, Credential Manager, tray and global shortcut code.
- Server Docker image build with TLS verification; container health, admission,
  battle start, and full snapshot restoration after container restart using the
  same named SQLite volume. The validation volume/credentials were removed.
- Production npm dependency audit: no known vulnerabilities reported by npm.

| PRD acceptance                                                         | Evidence                                                        | Remaining verification                               |
| ---------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------- |
| 1. Difficulty cooldowns                                                | mechanics tests for every skill and all difficulties            | None for shipped data                                |
| 2. Zone references, calibration independence, tiger single-shot        | timer engine tests and browser host/member flow                 | Actual hotkey/voice triggers on Windows              |
| 3. Automatic predictions, delayed cast correction, stale audio         | engine, policy and stateful scheduler tests                     | Physical clip cancellation/timing                    |
| 4. P2 fixed minigame independence                                      | engine tests and independent version keys                       | Physical playback                                    |
| 5. Remaining-time speech reference, one compensation, undo             | grammar, event-time and absolute-history tests                  | System.Speech onset/latency on device                |
| 6. Bird asymmetric pair suppression                                    | pure audio and stateful scheduler tests                         | Listening test on Windows                            |
| 7. P2 priority, later flight, no expired numbers                       | pure policy/scheduler tests including late drops and preemption | Listening test on Windows                            |
| 8. P3 last-peril gating and difficulty                                 | engine tests and two-client e2e                                 | Native voice event                                   |
| 9. Player counts/slots, host enforcement                               | room tests for 1–6 players, real socket authorization, e2e      | Multi-PC healthy-network measurements                |
| 10. Game focus, recognition during reminders, hotkeys, reconnect, tray | Reconnect tests; Windows code compiles                          | Windows 10/11 with MapleStory and actual mic/speaker |

Unknown initial offsets are unchanged and remain visibly unconfigured. P3's
fallback calibrated-reference semantics are explicit in README and UI. No code
inspects MapleStory, detects phases, injects inputs or recommends burst windows.

The Windows CI workflow was added but has not been run remotely from this task.
A cross-target compile check is not a Windows runtime test, installer build, or
proof of the <100ms audio / <250ms sync performance targets. Release code signing
is not configured. The current cloud lacks Windows and its System.Speech runtime;
those remaining acceptance items are concrete platform blockers.
