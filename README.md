# schedule-helper

Operator console for running a speedrunning marathon. Pulls the schedule
from [Oengus](https://oengus.io) or [Horaro](https://horaro.net), syncs
state across every operator's browser in real time, and verifies the
on-stream timer against the live Twitch broadcast via Tesseract OCR.

Live at **<https://schedule.skenmy.com>** — built for UKSG marathons
but works against any Oengus/Horaro schedule.

## What it does

- **Real-time room sync.** Every browser on the same `#marathonId/slug`
  hash sees the same state — timer, current run, run-status pills,
  edited times, message panel, kiosk config. Anyone can drive it; the
  server holds the authoritative state and broadcasts full snapshots
  on every mutation (no deltas, no merge logic).
- **Schedule timeline + Conductor UI.** Runs render as blocks on a
  horizontal timeline with two playheads (scheduled vs actual). The
  "drift gap" between them is the live delta — colour-coded ahead /
  behind / on-time. Setup blocks are stacked separately so you can see
  the buffer between runs.
- **Live elapsed timer.** Click the digits to set elapsed manually
  (useful when you start the timer late). Keyboard: `Space` toggle,
  `N` advance, `⌘K` palette.
- **Run-edit modal.** Override actualStart / actualEnd / actualDuration
  per row; missing fields are inferred from the other two and broadcast.
- **Stream OCR.** `streamlink → ffmpeg → tesseract` grabs two frames a
  second apart from the live Twitch channel, identifies which detected
  timer incremented exactly 1s, and reports the elapsed value plus the
  matched game name. The matcher tolerates Tesseract's frequent inline
  spaces (`00:1 1:42` → `00:11:42`) and joined lines (`EST:` on one
  line, value on the next).
- **Kiosk mode.** `?kiosk=1` overlays a configurable multi-panel grid
  (delta, current, on-deck, schedule, controls, log, message, marathon,
  progress, timing, twitch). 10 preset layouts + four canned presets
  (host / tech / runner green room / schedule-only).
- **Mobile shell.** Below 820 px the layout swaps to a single column,
  bottom-nav (Now / Up next / Schedule / Log / More), sticky Start /
  Next action bar, swipe between views, long-press a row to open the
  action sheet, pull-to-refresh, haptics, and Screen Wake Lock while
  the timer is running.
- **Auth gate.** Read access is open to everyone — viewers see the
  schedule update live. Any state-mutating action (timer, advance,
  edit, runner status, log, message, twitch channel) is gated behind a
  Twitch sign-in via [tools.skenmy.com](https://tools.skenmy.com). The
  signed-in operator's name + role is shown in the chrome.
- **Twitch overlay.** A tiny iframe of the configured channel docks
  into the chrome so the operator can watch the stream alongside the
  controls.

## Architecture

Two files do almost everything:

- `server.js` (~900 lines) — Express + the `ws` library on `/ws`.
  Hosts the Oengus/Horaro proxies, the OCR pipeline, the room model
  (state object + dirty flag + debounced disk persist), and the
  auth check against `tools-skenmy`.
- `public/index.html` + `public/conductor/{styles.css,tabs.js,edit.js,
  app.js,kiosk.js,mobile.css,mobile.js}` — the Conductor UI. No bundler,
  no framework. `render()` rebuilds the DOM on every state arrival;
  `tickFrame()` only updates text content per tick to keep the timeline
  smooth.

Each room is keyed by `{marathonId}/{slug}`. The state file lives at
`./data/{marathonId}--{slug}.json` (or `DATA_DIR` if set) and is
written atomically (`.tmp` → rename) with a 1-second debounce. Rooms
expire from memory 7 days after the last client leaves, but the JSON
on disk is permanent.

## WebSocket protocol

Client → server `{ action, ...data }`:

| action | data |
|---|---|
| `join` | `{ marathonId, slug, scheduleSource? }` |
| `timer:start` | `{ seconds }` |
| `timer:stop` / `timer:reset` | `{}` |
| `run:select` | `{ index }` |
| `run:advance` / `run:skip` | `{}` |
| `runner:cycle` | `{ index }` (per-run, cycles unchecked → ready → missing) |
| `log:add` | `{ text, type? }` (type ∈ note/tech/runner/start/delta) |
| `log:remove` / `log:clear` | `{ id }` / `{}` |
| `twitch:set` | `{ channel }` |
| `run:edit` | `{ index, actualStart?, actualEnd?, actualDuration? }` (all seconds) |
| `run:editClear` | `{ index }` |
| `message:set` / `message:clear` | `{ text, color }` / `{}` |

Server → client:

- `{ type: 'state', ...stateFields }` — full state, broadcast on every mutation
- `{ type: 'users', count }` — connected-client count
- `{ type: 'auth', authenticated, canWrite, root, user, loginUrl }` — per-socket identity (sent on connect + every 5 min)
- `{ type: 'denied', action, reason, loginUrl }` — sent to the originator when a mutation is blocked

## Env

| var | default | notes |
|---|---|---|
| `PORT` | `3000` | |
| `DATA_DIR` | `./data` | Room JSON lives here; mount as a volume in prod. |
| `TOOLS_AUTH_URL` | *(empty)* | URL of tools-skenmy. Empty = wide-open (local dev). |
| `AUTH_APP_ID` | `schedule` | Passed to `/auth/me?app=…` when checking write permission. |

System tools needed in the container: `streamlink`, `ffmpeg`,
`tesseract-ocr`. All baked into the published image.

## Local dev

```sh
npm install
npm start
open http://localhost:3000
```

State persists to `./data/`. Paste any Oengus URL on the landing page
(e.g. `https://oengus.io/marathon/uksggrn26/schedule/event`) or a
Horaro URL (`https://horaro.net/esa/2026-winter1`). No auth is enforced
unless you set `TOOLS_AUTH_URL`.

## Deploy

Standard skenmy-vps pattern: a push to `main` triggers CI which builds
+ pushes `ghcr.io/skenmy/schedule-helper`, then fires the deploy
workflow on `skenmy/skenmy-vps`. Live at <https://schedule.skenmy.com>.
