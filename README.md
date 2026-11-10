# Kaling Timer

Windows 10/11 multiplayer companion timer for MapleStory Kaling. Requirements:
[Kaling_Timer_PRD.md](Kaling_Timer_PRD.md). No game detection, automation, or burst
recommendations. Phases and actual casts are confirmed by the host.

## Implementation and verification

- Milestone 1: npm monorepo, Tauri/React shell, Socket.IO server, shared Zod contracts,
  validated external mechanics.
- Milestone 2: deterministic absolute-time predictions, independent calibration,
  zone references, one-shot tiger timer and 32-entry skill/zone undo histories.
- Milestone 3: 1–6 player rooms, two primary slots per zone, host authority, clock
  sync, token reconnect, idempotency, stale-version rejection and SQLite persistence.
- Milestone 4: pure phase-specific audio policies and cancellable preloaded local
  clip scheduler. Runtime audio output/precision needs Windows hardware validation.
- Milestone 5: external no-wake-word grammar, Chinese numerals, compensation/dedup,
  Windows offline System.Speech bridge and configurable global shortcuts. The native
  integration needs the Windows acceptance run.
- Milestone 6: compact dark UI, settings/devices/subscriptions, native tray/hide,
  always-on-top, Windows Credential Manager reconnect storage, NSIS configuration,
  CI and deployment docs. Windows packaging and game-focus behavior remain unverified.

Unit/integration and browser tests exercise implemented cross-platform behavior.
See [Windows acceptance run](docs/windows-validation.md) for the remaining OS,
physical audio and packaging checks. These milestones are not a claim that every
PRD acceptance test has passed on Windows.

## Develop and test

Use the existing checkout; cloud tasks are already isolated and need no worktree.
Use Node 24 LTS and npm (minimum Node 22.16 for SQLite).

```sh
npm ci --cache /tmp/kaling-npm-cache
npm run typecheck
npm test
npm run build
npm run dev
```

The server listens on 3001, Vite on 1420 and proxies Socket.IO. Create a room in
the shell, assign a primary zone, then start and calibrate as host. `GET /health`
returns protocol/mechanics version and server time. Shared edits always go through
the server. Disconnects display projected deadlines and disable shared mutations.
Stop dev services with Ctrl+C.

```sh
npx playwright install chromium
npm run test:e2e
# Cloud system Chromium alternative:
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

Tests cover all known cooldowns; zone independence; prediction/Bind-delayed cast
reanchoring; fixed P2 minigame; remaining-time speech compensation and absolute
undo; P3 gating; Bird/P2 conflict cases; strict grammar; host permissions, player
limits, persistence/reconnect, command idempotency, real Socket.IO requests, and
host/member browser flows including offline projection/reconciliation.

For native Windows setup and build use [Windows instructions](docs/windows-validation.md).
The browser shell supports multiplayer timers but does not emulate offline voice,
native audio synthesis, global shortcuts or tray behavior. Microphone/audio are
opt-in; raw PCM is never uploaded to the server. Local reminders are synthesized
once with a Chinese Windows voice and scheduled as decoded Web Audio buffers.

## Configuration and semantics

`config/mechanics.yaml` is the single cooldown source. Unknown first delays remain
`null` and display as unconfigured. P1 initializes all three zone references at
battle start, but unknown recurring first activations require calibration and
tiger requires each explicit trigger. P2 unknown first activations also require
calibration. Selecting P3 never starts its full-screen timer.

After explicit `三兽死亡`, P3 uses a configured initial delay if present. Otherwise
that event is an explicit calibrated reference and the next prediction is
reference + difficulty cooldown (60s E/N, 30s H/EX); the UI labels this basis and
continues to state that the actual first delay is unknown. It is not an observed
cast. A later skill calibration can establish the observed or remaining-time anchor.

`狗校准50秒` means 50 seconds from speech onset, or recognition time minus the
configured compensation (default 1.5s) when onset is unavailable. Compensation is
never applied twice and never applied to buttons/hotkeys. Recognition timestamps
are translated to the synchronized server clock and validated server-side. Undo
restores absolute references, then projects forward to now; history is persistent.
Current activations are labelled predicted; observed calibration retains a separate
last-confirmed timestamp. There is no Bind state or automatic phase detection.

Edit `config/voice-commands.yaml`, or select an external YAML/JSON path in native
settings and restart listening. Full utterances only: no partial matching. `鸟校准`
is intentionally ambiguous; use `鸟画卷校准`/`鸟飞行校准`. Phase-specific aliases
are resolved only in that phase. Voice numbers default to 0–120 (editable up to
300); button remaining-time calibration supports 0–3600s. Tiger uses its separate
explicit trigger mapping. Duplicate results are rejected, and speakers use input
AEC plus strict command grammar; verify your driver in the Windows acceptance run.

Local settings include per-skill lead times plus 5,4,3,2,1 countdown capability,
extra P1 zone subscriptions (no slot consumption), P2/P3 team subscriptions,
volume/mute/devices, conflict window/tie priority, compensation, hotkeys and
always-on-top. They contain no secrets. Windows saves reconnect credentials in
Credential Manager; browser tokens remain in page memory only.

See [server deployment](docs/deployment.md) for Compose persistence, TLS, CSP,
origins, backups, rate limits, mechanics versioning and operational limits.
