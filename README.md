# schedule-helper

The operator console for speedrunning marathons. Paste an [Oengus](https://oengus.io) or
[Horaro](https://horaro.net) schedule and every operator, host and venue screen shares one
live timer, delta and run order.

Live at **<https://schedule.skenmy.com>**. Built for UKSG marathons, works with any Oengus or
Horaro schedule. Try it offline with the built-in demo marathon (`/demo/demo/main`).

## What it does

- **Real-time sync.** The server owns each schedule's state and broadcasts every change to every
  connected browser. Anyone signed in as an operator can drive it; everyone else watches live.
- **Delta and projections.** Ahead / behind is measured against the live run's slot (±15 min
  counts as on schedule). Upcoming start times and the projected finish chain every remaining
  estimate and setup from where the live run will realistically end.
- **Timeline.** A plan lane (scheduled) over a live lane (actual and projected), so drift is
  visible at a glance. 3h / 6h / 12h / all zoom.
- **Run control.** Start, stop, resume, advance, back, skip / restore, set the timer after a late
  start, and edit actual start/end times (absolute timestamps — multi-day marathons work).
- **Runner check-ins** per run (ready / missing), summarised for the next five runs.
- **Undo and audit trail.** Every change is logged with who made it; undo reverts the most recent
  change to runs, timers, check-ins or broadcasts.
- **Stream capture.** `streamlink → ffmpeg → Claude` reads the run timer and game off the live
  Twitch stream, compares it with ours and offers a one-click correction. The optional **auto
  drift check** does this every few minutes while a run is live and logs a warning when the
  timers diverge or the stream shows a different run.
- **Broadcast.** An announcement banner for all operators, and a message board for kiosk screens.
- **Kiosk mode.** Configurable multi-panel displays for venue TVs (delta, now running, up next,
  check-ins, schedule, progress, clock, message board, controls, log, stream). The layout lives in
  the URL, so set up a screen once and bookmark it. Kiosks keep the screen awake.
- **Overlay feed.** Read-only JSON and Server-Sent Events for stream overlays, NodeCG or bots.
- **Mobile layout.** Below 820 px: bottom navigation, a thumb-reachable Start / Next bar, swipe
  between views, haptics and screen wake lock while a run is live.
- Command palette (⌘K / Ctrl K), keyboard shortcuts (`?` lists them), five colour themes, the UKSG
  brand theme for `uksg*` marathons, and a surprise if you type `huds`.

## Architecture

```
src/
  shared/   Pure TypeScript used by both sides: domain types, the WebSocket protocol (zod),
            time formatting, schedule-URL parsing, and all schedule maths (derive.ts).
  server/   Node HTTP + WebSocket server, run directly as TypeScript (Node type stripping).
    rooms/    reducer.ts (pure state transitions), room.ts (undo, broadcast, persistence),
              registry.ts (load/evict), store.ts (atomic JSON files)
    sources/  Oengus, Horaro and demo adapters behind a cached facade
    capture/  frame grab, Claude Vision reading, drift checks
    feed.ts   overlay feed · http.ts routes · ws.ts sessions · auth.ts tools.skenmy.com
  client/   Svelte 5 (runes) single-page app, built by Vite
    lib/        room connection, derived view model, clock, prefs, router, kiosk config
    views/      Landing, Conductor (desktop), MobileConductor, Kiosk
    components/ conductor panels, workspace tabs, dialogs, kiosk panels, UI primitives
```

Rooms are keyed by `{source}/{event}/{slug}` and served at the same path (for example
`/oengus/uksgred26/main`). Old `#event/slug` links redirect. Each room's schedule, state and undo
stack persist to `DATA_DIR/rooms/{source}--{event}--{slug}.json`, written atomically with a
one-second debounce and flushed on shutdown. Schedules refresh from upstream every 10 minutes
while someone is watching, and on demand via **Re-import**.

Timers are absolute server timestamps. Clients measure their clock offset against the server,
so every screen shows the same elapsed time even when laptop clocks disagree.

## WebSocket protocol (`/ws`)

Client → server messages are validated with zod (`src/shared/protocol.ts`):

| action                                                                            | data                                             |
| --------------------------------------------------------------------------------- | ------------------------------------------------ |
| `join`                                                                            | `{ ref: { source, event, slug } }`               |
| `ping`                                                                            | `{ t }` (clock sync)                             |
| `timer:start` / `timer:stop` / `timer:reset`                                      | —                                                |
| `timer:set`                                                                       | `{ seconds }`                                    |
| `run:select` / `run:unskip`                                                       | `{ key }`                                        |
| `run:advance` / `run:back`                                                        | —                                                |
| `run:skip`                                                                        | `{ key? }` (defaults to the current run)         |
| `run:edit`                                                                        | `{ key, startedAt, endedAt }` (epoch ms or null) |
| `runner:checkin`                                                                  | `{ key, status: 'ready' \| 'missing' \| null }`  |
| `log:add` / `log:remove` / `log:clear`                                            | `{ text, kind }` / `{ id }` / —                  |
| `twitch:set`                                                                      | `{ channel }`                                    |
| `message:set` / `announcement:set`                                                | `{ text, color }`                                |
| `message:clear` / `announcement:clear` / `capture:run` / `capture:apply` / `undo` | —                                                |
| `drift:configure`                                                                 | `{ enabled, intervalMin, thresholdSec }`         |
| `schedule:refresh`                                                                | —                                                |

Everything except `join` and `ping` needs operator access. Server → client: `hello` (build id,
server time), `auth`, `joined`, `schedule` (full schedule), `state` (full room state on every
change), `presence`, `pong`, and `error` (`signin_required`, `forbidden`, `invalid`, `not_found`,
`upstream`, `conflict`, `not_joined`).

## Overlay feed

Read-only and CORS-open — the same information any viewer can already see.

- `GET /api/rooms/{source}/{event}/{slug}/feed` — JSON snapshot: event, phase, current run (with
  `startedAt` so overlays can tick the timer locally), next five runs with projected starts and
  check-ins, delta, scheduled and projected end, progress, message and announcement.
- `GET /api/rooms/{source}/{event}/{slug}/feed/stream` — the same snapshot as Server-Sent Events
  (`event: feed`), pushed on every change.

## Environment

| var                  | default                                      | notes                                                               |
| -------------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| `PORT`               | `3000`                                       |                                                                     |
| `DATA_DIR`           | `./data`                                     | Room files live in `DATA_DIR/rooms/`. Mount as a volume.            |
| `TOOLS_AUTH_URL`     | _(empty)_                                    | tools-skenmy base URL. Empty = everyone can write (local dev only). |
| `AUTH_APP_ID`        | `schedule`                                   | Passed to `/auth/me?app=…&role=admin`.                              |
| `AUTH_LOGIN_URL`     | `https://tools.skenmy.com/auth/twitch/login` | Sign-in link shown to viewers.                                      |
| `AUTH_MANAGE_URL`    | `https://tools.skenmy.com/`                  | Linked from the user chip.                                          |
| `PUBLIC_URL`         | `https://schedule.skenmy.com`                | Where sign-in redirects back to.                                    |
| `ANTHROPIC_API_KEY`  | _(empty)_                                    | Required for stream capture.                                        |
| `VISION_MODEL`       | `claude-sonnet-4-6`                          | Model that reads stream frames.                                     |
| `BUILD_SHA`          | `dev`                                        | Set by CI; clients offer a reload when it changes.                  |
| `CAPTURE_FRAME_FILE` | _(empty)_                                    | Dev/testing: use this image instead of grabbing a live frame.       |
| `CLIENT_DIR`         | `dist/client`                                | Built client assets.                                                |
| `LOG_LEVEL`          | `info`                                       | `debug`, `info`, `warn` or `error`.                                 |

Stream capture needs `streamlink` and `ffmpeg` on the server; both are in the Docker image. Each
capture costs roughly $0.01 in API usage.

## Development

```sh
npm install
npm run dev          # server on :3000 (restarts on change) + Vite on :5173 with HMR
open http://localhost:5173/demo/demo/main
```

| command            | what it does                                                                     |
| ------------------ | -------------------------------------------------------------------------------- |
| `npm run check`    | typecheck (server under Node rules, client via svelte-check), lint, format check |
| `npm test`         | unit + integration tests (Vitest)                                                |
| `npm run test:e2e` | browser smoke tests (Playwright; builds and starts the server)                   |
| `npm run build`    | production client build into `dist/client`                                       |
| `npm start`        | production server                                                                |

Node 22.18+ is required locally (native TypeScript type stripping); the image uses Node 24.

## Deploy

A push to `main` runs the checks and browser tests, builds and pushes
`ghcr.io/skenmy/schedule-helper`, then triggers the `skenmy/skenmy-vps` deploy workflow. The
container listens on `3000` and keeps state in `/data`.
