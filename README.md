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
  estimate and setup from where the live run will realistically end. Once a few runs have
  finished, a **likely end** sits beside it: the same chain at this event's own pace (the median
  run against its estimate, the median changeover against its setup, eased towards plan while
  there's little data). It's in the status strip, the Progress tab and the overlay feed
  (`likelyEnd`, `pace`).
- **Catch-up planner.** When the end is projected more than five minutes late, the Progress tab
  lists what could give the time back, least visible first: setup buffers still to come trimmed to
  five minutes (largest first), then interludes. Each shows when it happens and where the end lands
  with it, and the point where you're back on schedule is marked. Advisory only.
- **Event report.** Planned against actual, for the debrief or the next event's planning: when it
  started and finished against the schedule, run time against estimates, the median changeover
  against plan, a chart of how far ahead or behind each run started, the runs furthest over and
  under their estimates, and every run with its scheduled and actual times. It updates live while
  the marathon runs and works offline from the last state the device saw. Open it from the
  Progress tab, the command palette, the More sheet, or the status strip once the marathon is
  complete (`?report=1` on any room). Export as CSV (spreadsheet-safe) or JSON, or print it.
- **Timeline.** A plan lane (scheduled) over a live lane (actual and projected), so drift is
  visible at a glance. 3h / 6h / 12h / all zoom.
- **Run control.** Start, stop, resume, advance, back, skip / restore, set the timer after a late
  start, and edit actual start/end times (absolute timestamps — multi-day marathons work).
- **Runner check-ins** per run (ready / missing), summarised for the next five runs.
- **Runner self check-in.** Every run has its own link (a QR code in the run's sheet, or
  **Copy runner check-in links** in the command palette for all of them at once). A runner opens it
  on their phone, sees when their run is expected to start and how it works (check in 1–2 hours
  before your run, once you're ready to go), and taps **I'm here** or **Running late** (how far
  away, plus an optional note). **Clear my check-in** takes back what they said, but never what an
  organiser set. It shows on every operator's screen as it happens:
  an amber "late" state with the ETA in Up next, On deck, the schedule and kiosks, and a warning in
  the log. Runners need no account; a link can only check in its own run. Operator check-ins still
  work as before and replace whatever the runner said.
- **Alerts on your phone.** Operators can turn on push notifications per schedule (bell in the
  top bar, the More sheet, or the command palette) and hear about what needs them, even with the
  app closed:
  - runners who say they're running late, or are marked missing
  - the next run's runners not checked in 15 minutes before it starts
  - a run 15 minutes over its estimate
  - a run change spotted on stream (or auto-tracking moving on by itself)
  - stream timer warnings from the drift check

  Nobody is alerted about what they did themselves. On iPhone and iPad this needs the app added
  to the Home Screen (iOS 16.4+). A followed schedule stays loaded on the server so the timed
  alerts keep coming with nobody looking at it.

- **Undo and audit trail.** Every change is logged with who made it; undo reverts the most recent
  change to runs, timers, check-ins or broadcasts.
- **Reset marathon.** Schedule tab → **Reset…** (or the command palette) starts the marathon over
  for a rehearsal: no live run, no timings, skips or check-ins, an empty log, no broadcasts,
  capture reading or undo history. The schedule, Twitch channel, drift and tracking settings stay. You type
  `reset` to confirm, and the previous state is kept as a backup file (see below).
- **Stream capture.** `streamlink → ffmpeg → Claude` reads the run timer and game off the live
  Twitch stream, compares it with ours and offers a one-click correction. The optional **auto
  drift check** does this every few minutes while a run is live and logs a warning when the
  timers diverge or the stream shows a different run.
- **Auto-tracking.** Notices when the stream moves on to the next run and puts a banner on every
  operator's screen — “Spyro the Dragon is on stream · Advance & start” — so following it is one
  tap, with the start back-dated when the stream timer shows it. Signals come from the Twitch
  category and title (free, every 30 s) and from reading the stream with Claude, every minute near a
  run's estimated end and between runs. Only the live run and the next three are ever suggested.
  Optionally it acts by itself when two signals agree (Twitch and the stream, or two stream
  readings a minute apart); every change is logged and undoable.
- **NodeCG speedcontrol.** The stream PC's speedcontrol can report its active run and timer
  directly, through a small NodeCG bundle (`integrations/nodecg-schedule-helper`, no changes to
  speedcontrol) or, where nothing can be installed, a bridge page opened on the stream PC. It runs
  the real timer, so a run change or a timer start is suggested at once, with the exact start time,
  and so is a finish: **Stop timer** stops ours when speedcontrol's finished. With auto-apply on
  it's followed straight away. Set it up under Stream capture → Stream PC.
- **Broadcast.** An announcement banner for all operators, and a message board for kiosk screens.
- **Kiosk mode.** Configurable multi-panel displays for venue TVs (delta, now running, up next,
  check-ins, schedule, progress, clock, message board, controls, log, stream). The layout lives in
  the URL, so set up a screen once and bookmark it. Kiosks keep the screen awake.
- **Overlay feed.** Read-only JSON and Server-Sent Events for stream overlays, NodeCG or bots.
- **iPad interface.** A touch-first console: on a landscape iPad the live run and its controls sit
  in one pane and the workspace tabs (timeline, schedule, log, tools) in another, each scrolling on
  its own. In portrait the page scrolls, with the controls docked along the bottom. A **Floor**
  mode (switch in the top bar, remembered per iPad) shows the live run, a big timer and one-tap
  Ready / Missing check-ins for the next runs. Hardware-keyboard shortcuts still work.
- **Phone interface.** Bottom tab bar (Now / Up next / Schedule / Log / More), Start / Next under
  your thumb, one-tap runner check-ins in Up next, swipe between views, swipe-down-to-close sheets
  and haptics. Landscape switches to a side rail with Start / Next on the right. Phones and iPads
  keep the screen awake while the app is open.
- **Installable, works without signal.** Add it to the Home Screen (Safari → Share → Add to Home
  Screen) and it opens full screen, back on the schedule you last had open. With no connection it
  still opens and shows the last state it saw, run timer ticking, with every control disabled until
  it reconnects — nothing is ever sent from a stale view. The layout is picked from the screen and
  pointer; More → _Layout on this device_ overrides it.
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
    capture/  frame grab, Claude Vision reading, drift checks, capture cadence
    tracking/ auto-tracking: Twitch source, signal matching, detections, auto-apply
    feed.ts   overlay feed · http.ts routes · ws.ts sessions · auth.ts tools.skenmy.com
  client/   Svelte 5 (runes) single-page app, built by Vite
    lib/        room connection, derived view model, clock, prefs, router, kiosk config
    views/      Landing, Conductor (desktop), TabletConductor (iPad), MobileConductor, Kiosk
    components/ conductor panels, workspace tabs, dialogs, kiosk panels, touch controls, UI
    sw.ts       service worker: caches the app shell so the installed app opens offline
```

Rooms are keyed by `{source}/{event}/{slug}` and served at the same path (for example
`/oengus/uksgred26/main`). Old `#event/slug` links redirect. Each room's schedule, state and undo
stack persist to `DATA_DIR/rooms/{source}--{event}--{slug}.json`, written atomically with a
one-second debounce and flushed on shutdown. Schedules refresh from upstream every 10 minutes
while someone is watching, and on demand via **Re-import**.

A reset first writes the room's previous state to `{source}--{event}--{slug}.json.reset-{epoch ms}`
next to the room file (the newest five are kept). To restore one, stop the server, copy it over the
room file and start it again.

Timers are absolute server timestamps. Clients measure their clock offset against the server,
so every screen shows the same elapsed time even when laptop clocks disagree.

Each browser keeps the last state it received for its four most recent rooms in `localStorage`
(`src/client/lib/offline.ts`), and the service worker (`src/client/sw.ts`) caches the app shell.
So the installed app opens with no connection, and every launch paints at once instead of showing
a spinner. Until the server sends fresh state over a live connection, controls stay disabled.

## WebSocket protocol (`/ws`)

Client → server messages are validated with zod (`src/shared/protocol.ts`):

| action                                                                   | data                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------ |
| `join`                                                                   | `{ ref: { source, event, slug } }`               |
| `ping`                                                                   | `{ t }` (clock sync)                             |
| `timer:start` / `timer:stop` / `timer:reset`                             | —                                                |
| `timer:set`                                                              | `{ seconds }`                                    |
| `run:select` / `run:unskip`                                              | `{ key }`                                        |
| `run:advance` / `run:back`                                               | —                                                |
| `run:skip`                                                               | `{ key? }` (defaults to the current run)         |
| `run:edit`                                                               | `{ key, startedAt, endedAt }` (epoch ms or null) |
| `runner:checkin`                                                         | `{ key, status: 'ready' \| 'missing' \| null }`  |
| `log:add` / `log:remove` / `log:clear`                                   | `{ text, kind }` / `{ id }` / —                  |
| `twitch:set`                                                             | `{ channel }`                                    |
| `message:set` / `announcement:set`                                       | `{ text, color }`                                |
| `message:clear` / `announcement:clear` / `capture:run` / `capture:apply` | —                                                |
| `undo`                                                                   | `{ id? }` (refused if the latest change differs) |
| `drift:configure`                                                        | `{ enabled, intervalMin, thresholdSec }`         |
| `tracking:configure`                                                     | `{ twitch, vision, autoApply }`                  |
| `detection:accept` / `detection:dismiss`                                 | `{ id }` (the detection the operator saw)        |
| `schedule:refresh`                                                       | —                                                |
| `room:reset`                                                             | — (clears progress; not undoable)                |

Everything except `join` and `ping` needs operator access. Any action may carry a string `rid`;
the server then answers that sender with `applied` (`{ rid, undo }`, the undo entry the change
created) or an `error` carrying the same `rid`. Server → client: `hello` (build id, server time),
`auth`, `joined`, `schedule` (full schedule), `state` (full room state on every change),
`presence`, `pong`, `applied`, and `error` (`signin_required`, `forbidden`, `invalid`,
`not_found`, `upstream`, `conflict`, `not_joined`).

## Overlay feed

Read-only and CORS-open — the same information any viewer can already see.

- `GET /api/rooms/{source}/{event}/{slug}/feed` — JSON snapshot: event, phase, current run (with
  `startedAt` so overlays can tick the timer locally), next five runs with projected starts and
  check-ins (and `late`: when and ETA, when a runner said they're on their way), delta, scheduled
  and projected end, progress, message and announcement.
- `GET /api/rooms/{source}/{event}/{slug}/feed/stream` — the same snapshot as Server-Sent Events
  (`event: feed`), pushed on every change.
- `GET /api/rooms/{source}/{event}/{slug}/report.json` / `report.csv` — the event report
  (`shared/report.ts`): per run, the scheduled and actual start and end, estimate and time taken,
  start against schedule, and the changeover after it against its plan; plus the overall
  figures. CSV times are ISO 8601 UTC, durations `HH:MM:SS`, deltas signed seconds.

## NodeCG speedcontrol

The stream PC reports to `POST /api/rooms/{ref}/nodecg` with
`{ t, via: 'bundle' | 'bridge', run: { externalID, game, category, players }, timer: { state,
elapsedMs } }`. `t` is the room's stream PC token (`GET /api/rooms/{ref}/source-token`, operators
only), an HMAC like the check-in links' with its own purpose: it can report what's on stream and
nothing else. Operators can replace it (`POST …/source-token`, "Replace the token" in the app) for
one room without touching any other or any runner link. The elapsed time is a duration, so the
stream PC's clock doesn't matter.

- **The bundle** (`integrations/nodecg-schedule-helper`) reads speedcontrol's `runDataActiveRun`
  and `timer` replicants and reports on every change of run or timer state, and every 15 s. Copy it
  into NodeCG's `bundles/` and put the config Schedule Helper shows into
  `cfg/nodecg-schedule-helper.json`. Its README has the details.
- **The bridge page** (`/bridge.html?room=…&nodecg=http://localhost:9090#t=…[&key=…]`) does the
  same from a browser on the stream PC, using NodeCG's own socket.io client (`key` is NodeCG's login
  key, if it has one). It runs a script from whatever NodeCG address it's given, so it's served
  sandboxed (`Content-Security-Policy: sandbox allow-scripts`): no origin, no cookies, no storage,
  and only the report endpoint accepts its cross-origin requests. Browsers may refuse an `https`
  page talking to NodeCG over plain `http` on another machine; NodeCG on the same PC usually works.
  It joins speedcontrol's replicant rooms, so NodeCG pushes each change and a new run or a timer
  starting or finishing is reported at once, even from a background tab (Chrome runs a hidden
  tab's timers once a minute, so its one-second poll is only a fallback there).

Runs imported into speedcontrol from Oengus keep their line ID (`externalID`), which names our run
exactly. If that run isn't the live one or the next three (speedcontrol lagging behind), the report
matches nothing rather than guess. Without a known ID, the game, category and runners are matched
against the same runs. Reports become `nodecg` signals (`src/server/tracking/nodecg.ts`).
Speedcontrol is a trusted source: with auto-apply on, it acts on its own word once the same report
has stood for 3 seconds with nothing contradicting it, so a misclick on the stream PC (next, next,
back) settles first. Operators can
switch it off (Stream capture), and the last report is shown there either way.

It's also the one source that can say when a run finished. Reports carry elapsed time, not clock
times, so the server remembers when speedcontrol's timer started (from the last report while it
ran: now minus elapsed, which also absorbs pauses), and a finished timer's final time added to that
is the finish. If our live run is still running, that's a `finish` suggestion; accepting stops our
timer at that moment (never before it started, never in the future). If the stream has already
moved on (Twitch, a stream reading or speedcontrol shows the next run), that suggestion stays, and
accepting it ends the previous run at speedcontrol's finish. A bridge or bundle that only connected
after the finish has no start to go on, so it offers nothing. Stopping our timer by hand deals with
the finish: resume it and the same finish isn't raised again, and neither is one more than two
minutes old.

## Push alerts

- `GET /api/push/key` — the VAPID public key.
- `POST /api/rooms/{ref}/push` with `{ subscription, on }` — operators only, up to 100 devices
  per schedule. Endpoints must be canonical `https` URLs on a known push service (FCM, Mozilla,
  Apple, Windows), and sending refuses any host that resolves to a private or loopback address, so
  the server never posts anywhere else.
- `POST /api/rooms/{ref}/push/status` / `push/test` with `{ endpoint }`.

What's worth an alert is `src/server/push/alerts.ts` (pure, tested); delivery, the 30-second clock
for timed alerts and cleaning up dead subscriptions is `push/service.ts`. Subscriptions live in
`DATA_DIR/push-subscriptions.json`. A followed schedule is watched (kept loaded) until its marathon
has been finished for two hours, or a day after its scheduled end with nothing live; following it
again or opening it brings it back. Alerts already due when watching starts (a restart, a new
device) aren't sent. The VAPID keys in `DATA_DIR/vapid.json` must stay put: a broken file stops
the server rather than quietly orphaning every device.

## Runner check-in links

A link is `/{source}/{event}/{slug}?checkin={run key}#t={token}`, where the token is an HMAC of
the room and run key (`src/server/checkin.ts`). It authorises exactly one thing: that run's check-in.
The token sits in the fragment (and in a header or body on the API calls), so it never lands in an
access log.

- `GET /api/rooms/{ref}/checkin-links` — every run's token. Operators only (the same
  tools.skenmy.com cookie check as the socket).
- `GET /api/rooms/{ref}/checkin/{key}` with `x-checkin-token` — 200 if the link is good, 403 if
  not.
- `POST /api/rooms/{ref}/checkin/{key}` with `{ t, status: 'ready' }`,
  `{ t, status: 'late', minutes: 1–240 | null, note }` or `{ t, status: 'clear' }` — dispatches
  `runner:checkin` / `runner:late` as `{runners} (check-in link)`. `clear` is refused (409) when an
  organiser set the current status. Logged, but not on the operators' undo stack: an
  operator's undo reverts their own change and keeps whatever runners said since. Refused once the
  run has started, been skipped, or left the schedule, or when a link is used more than once a
  second or 20 times an hour. The note is plain text (control characters stripped) and isn't in
  the overlay feed.

The secret is generated into `DATA_DIR/checkin-secret` on first start, so links survive restarts
and deploys. Delete it (or change `CHECKIN_SECRET`, 32+ characters) to invalidate every link. A
secret file that's empty or unreadable stops the server starting rather than quietly breaking every
link already handed out.

## Environment

| var                    | default                                      | notes                                                                                  |
| ---------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------- |
| `PORT`                 | `3000`                                       |                                                                                        |
| `DATA_DIR`             | `./data`                                     | Room files live in `DATA_DIR/rooms/`. Mount as a volume.                               |
| `TOOLS_AUTH_URL`       | _(empty)_                                    | tools-skenmy base URL. Empty = everyone can write (local dev only).                    |
| `AUTH_APP_ID`          | `schedule`                                   | Passed to `/auth/me?app=…&role=admin`.                                                 |
| `AUTH_LOGIN_URL`       | `https://tools.skenmy.com/auth/twitch/login` | Sign-in link shown to viewers.                                                         |
| `AUTH_MANAGE_URL`      | `https://tools.skenmy.com/`                  | Linked from the user chip.                                                             |
| `PUBLIC_URL`           | `https://schedule.skenmy.com`                | Where sign-in redirects back to; also an origin allowed to open `/ws`.                 |
| `ANTHROPIC_API_KEY`    | _(empty)_                                    | Required for stream capture.                                                           |
| `VISION_MODEL`         | `claude-sonnet-5`                            | Model that reads stream frames (needs `effort` support: Sonnet/Opus 4.6+).             |
| `BUILD_SHA`            | `dev`                                        | Set by CI for the client build and the server; clients offer a reload on a mismatch.   |
| `CAPTURE_FRAME_FILE`   | _(empty)_                                    | Dev/testing: use this image instead of grabbing a live frame.                          |
| `TWITCH_CLIENT_ID`     | _(empty)_                                    | Twitch app for auto-tracking (category and title). Same app as other services is fine. |
| `TWITCH_CLIENT_SECRET` | _(empty)_                                    | Its secret. Without both, Twitch tracking says it isn't set up.                        |
| `STREAM_INFO_FILE`     | _(empty)_                                    | Dev/testing: read channel info from this JSON file instead of Twitch.                  |
| `TRACKING_TICK_MS`     | `30000`                                      | How often auto-tracking polls Twitch.                                                  |
| `VAPID_PUBLIC_KEY`     | _(empty)_                                    | Push notification keys. Empty: generated once into `DATA_DIR/vapid.json`.              |
| `VAPID_PRIVATE_KEY`    | _(empty)_                                    | Set both or neither. New keys orphan every device's subscription.                      |
| `VAPID_SUBJECT`        | `PUBLIC_URL`                                 | Contact the push services see (an `https:` or `mailto:` URL).                          |
| `CHECKIN_SECRET`       | _(empty)_                                    | Signs runner check-in links. Empty: generated once into `DATA_DIR/checkin-secret`.     |
| `CLIENT_DIR`           | `dist/client`                                | Built client assets.                                                                   |
| `LOG_LEVEL`            | `info`                                       | `debug`, `info`, `warn` or `error`.                                                    |

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
| `npm run build`    | production client build into `dist/client`, including the service worker         |
| `npm run icons`    | re-render the PNG app icons from `favicon.svg` (uses Playwright's Chromium)      |
| `npm start`        | production server                                                                |

Node 22.18+ is required locally (native TypeScript type stripping); the image uses Node 24.

## Deploy

A push to `main` runs the checks and browser tests, builds and pushes
`ghcr.io/skenmy/schedule-helper`, then triggers the `skenmy/skenmy-vps` deploy workflow. The
container listens on `3000` and keeps state in `/data`.
