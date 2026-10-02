# Schedule Helper

Real-time operator console for speedrun marathons (built for UKSG). Svelte 5 client, Node +
TypeScript server, shared pure logic. See README.md for features, the protocol and env vars.

## Layout

- `src/shared/` — isomorphic, dependency-free except zod in `protocol.ts`:
  - `types.ts` domain types (`ScheduleLine`, `RoomState`, `RunRecord`, …)
  - `protocol.ts` zod schemas for client actions + `ServerMessage` union
  - `derive.ts` ALL schedule maths: run timing, delta, projections, stats. Never duplicate this
    logic in a component or on the server — import it.
  - `time.ts` duration parsing/formatting · `sources.ts` URL parsing, room paths, brand detection
- `src/server/` — run directly by Node (type stripping, no build):
  - `rooms/reducer.ts` pure `reduce(state, action, ctx)`; every user-visible state rule lives here
  - `rooms/room.ts` dispatch → reduce → undo snapshot → commit (rev++, broadcast, notify, persist)
  - `rooms/registry.ts` load from disk or upstream, background schedule refresh, idle eviction
  - `sources/` Oengus / Horaro / demo adapters (zod-parsed, cached 60s, 10s timeouts)
  - `capture/` frame grab (streamlink → ffmpeg → JPEG in memory), `vision.ts` (Anthropic SDK,
    structured outputs), `service.ts` (drift evaluation, auto drift scheduler)
  - `tracking/` auto-tracking: `twitch.ts` (Helix, app token), `match.ts` (category/title → run),
    `detect.ts` (signals → `state.detection`, pure), `service.ts` (polling, vision hook, auto-apply)
  - `ws.ts` sessions (ordered queue, auth gate, heartbeat) · `http.ts` routes · `feed.ts` overlay feed
- `src/client/` — Svelte 5 runes, Vite root:
  - `lib/room.svelte.ts` WebSocket connection (`RoomConnection`), reconnect, clock sync, offline
    snapshot hydration (`lib/offline.ts`)
  - `lib/live.svelte.ts` derived view model (`Live`) + operator actions (`Ops`); get via
    `getRoom()` / `getLive()` / `getOps()` context helpers
  - `lib/ui.svelte.ts` open dialogs/tabs; `lib/prefs.svelte.ts` localStorage prefs
  - `lib/layout.ts` (pure, tested) + `layout.svelte.ts`: phone / tablet / desktop from window size,
    `pointer: coarse` and iPad detection, plus the per-device `prefs.layout` override. Sets
    `<html data-layout data-touch>` for CSS.
  - `views/` Landing, RoomView (connection owner, picks the view by `layout.kind`), Conductor
    (desktop), TabletConductor (iPad: console / floor modes), MobileConductor, Kiosk
  - `components/touch/` Transport (run controls for touch), OnDeck (floor check-ins), MoreSheet
  - `sw.ts` service worker (app shell only), built by the plugin in `vite.config.ts` and
    type-checked by `tsconfig.sw.json` (WebWorker globals, not the DOM)

## Rules that keep this working

- **Server code must be erasable TypeScript** (no enums, namespaces, parameter properties) and
  import local files with the `.ts` extension. `tsconfig.base.json` enforces this.
- **Keep zod out of the browser bundle**: the client may only `import type` from
  `shared/protocol.ts`. Runtime constants shared with the client live in `shared/sources.ts`.
- **State is keyed by run key, not index.** Oengus keys are `o{lineId}`; Horaro/demo keys are
  content hashes. Re-imports can insert or reorder runs without breaking check-ins or timings.
- **The timer is the current run's record**: `startedAt` without `endedAt` = running. Only the
  current run may be running; leaving it (advance/select/back/skip) closes it.
- **Times are absolute epoch ms** everywhere (including edits). Clients use `clock.now` /
  `clock.read()` (server-corrected), never raw `Date.now()`, for anything compared with state.
- **Undoable actions** are listed in `reducer.ts` (`UNDOABLE`); undo restores `UNDO_FIELDS` from a
  snapshot. The log, capture results and drift settings are deliberately not undoable. Undo
  entries have ids; the client always sends the id it showed, so an undo never reverts a change
  someone made in between. Undo toasts appear only after the server's `applied` reply
  (`room.request()`), never optimistically.
- **`room:reset` is the one irreversible action.** It lives on `Room` (not the reducer): writes a
  backup via `store.backup()` (refusing to reset if that fails), clears progress/log/broadcasts/
  capture/undo but keeps the schedule, Twitch channel, drift and tracking settings, and bumps `room.epoch` so
  a capture in flight is discarded. The client asks for a typed confirmation (`ui.ask({ typeToConfirm })`).
- **Never guess the live run.** If `currentKey` points at a run that's gone from the schedule,
  actions that need it are refused; a stale capture (taken before the live run changed) can't be
  applied.
- **Never let broadcasts clobber drafts.** The server sends a new state object on every change
  and the clock ticks every 250 ms. Effects that seed form fields must read state via `untrack`
  or key off a primitive `$derived` (see `CaptureTab.svelte`, `EditTimesDialog.svelte`).
- Mutating actions are auth-gated in `ws.ts`; `join`/`ping` and all HTTP reads are public.
- **WebSockets only open from our own pages.** `ws.ts` answers 403 to an upgrade whose `Origin` is
  present but is neither `PUBLIC_URL` nor the request's own `Host`, so another site can't use an
  operator's cookie to act as them (cross-site WebSocket hijacking). No `Origin` (tests, scripts)
  is allowed. Serving from a new hostname needs `PUBLIC_URL` set or the proxy to pass `Host` through.
- **Nothing acts on cached state.** A room paints from its offline snapshot before the socket
  connects, and keeps showing state after it drops. `room.canWrite` is operator access **and** a
  live socket with fresh state (`room.synced`); gate every control that sends an action on it. Use
  `room.isOperator` only for identity (role chip, "sign in" prompts). There is no offline queue.
  After the app returns to the foreground nothing is sent until the socket answers a ping.
  **Bump `VERSION` in `lib/offline.ts`** when `Schedule` or `RoomState` change shape in a way an
  old snapshot would break (new optional `RoomState` fields are filled from `EMPTY_STATE`).
- **Size components by their container, not the viewport.** Tabs and cards render in a phone view,
  an iPad pane and a desktop column, so their breakpoints are `@container panel` / `nowcard` /
  `timer` queries. Touch sizing hangs off `[data-touch]`; hover-only affordances need a
  `@media (hover: hover)` guard (hover sticks after a tap on iPad).
- **The service worker never touches `/api` or `/ws`**, navigations are network-first, and the
  precache list comes from the build. Non-hashed static files are served `no-cache` so deploys
  reach installed apps. The client is built with `__BUILD__` (`BUILD_SHA`), so a page served from
  the cache still sees the server's newer build and offers a reload.

## Commands

```sh
npm run dev        # server :3000 + Vite :5173 (open /demo/demo/main — works offline)
npm run check      # tsc (server rules, service worker) + svelte-check + eslint + prettier --check
npm test           # vitest: shared maths, reducer, capture, upstream mapping, WS/SSE integration
npm run test:e2e   # playwright smoke tests (set CHROMIUM_PATH to use a preinstalled browser)
npm run format     # prettier --write
npm run icons      # re-render the PNG app icons from favicon.svg
```

Run `npm run check && npm test` before pushing; CI runs those plus the e2e suite.

## Auth

tools.skenmy.com issues the shared `.skenmy.com` cookie. `auth.ts` calls
`TOOLS_AUTH_URL/auth/me?app=schedule&role=admin` (cached 60 s per cookie). Empty
`TOOLS_AUTH_URL` = everyone can write (local dev). Sign-in returns to `/`; the router restores
the room from `sessionStorage`.

## Stream capture

`capture:run` (WebSocket) → `grabFrame` → `readFrame` (Claude, `VISION_MODEL`, default
`claude-sonnet-5`, adaptive thinking at `effort: low`) → `evaluateReading` compares with our timer at the frame's capture time →
result stored in `state.capture`, frame served from memory at
`/api/rooms/{ref}/frames/{id}`. `capture:apply` back-dates the matched run's `startedAt` from the
frame time, so processing latency doesn't matter. Set `CAPTURE_FRAME_FILE=fixtures/stream-frame.png`
to develop without a live stream.

## Auto-tracking

Sources report what the stream shows as a `Signal` (`{ runKey, source, at, detail, startedAt }`);
`observe()` folds signals into `state.detection`, which operators accept (`detection:accept`, an
ordinary undoable action that back-dates the start from a timer reading) or dismiss.

- **Never guess the live run, still.** Only the live run and the next `LOOKAHEAD` (3) runs can be
  suggested; a live run that's gone from the schedule stops detection. A detection is dropped as
  soon as the live run changes (`reconcile()` runs on every commit) or after 20 minutes unbacked.
- **What's dealt with stays dealt with.** Accepting or dismissing records `state.settled`
  (`{ runKey, kind, currentKey }`): the same suggestion isn't raised again while the room is on the
  run where it was dealt with or the run it pointed at (30 minutes at most), so an undo (which lands
  back where it was dealt with) or a dismissal sticks however often the stream repeats itself. Vision readings are level-triggered against that; Twitch only signals when the run its
  category/title points at changes. A source that now sees the live run withdraws only its own
  signals. A back-dated start before the live run's start (or the previous run's end) is treated as
  a misread timer.
- **Auto-apply** (`tracking.autoApply`, off by default) needs `corroborated()`: a trusted
  stream-PC source (`TRUSTED_SOURCES`), two different sources, or two timer readings ≥20 s apart
  implying the same start. It dispatches as `Auto-tracking`, so it's logged and undoable.
- **Adding a source** (NodeCG speedcontrol, a stream-PC push): build a `Signal`, call `signal()`.
- Vision reading reuses stream capture; `captureInterval()` decides the cadence: every minute while
  a suggestion is pending or a change is due (near a run's estimated end, between runs), backing
  off to every 10 after 30 minutes due, none while Twitch says offline, and only while an operator
  (not a kiosk) is connected. `capture:apply` carries the reading's `id`.
  Set `STREAM_INFO_FILE` to fake Twitch locally; e2e does (`e2e/tracking.spec.ts`).

## Deployment

Shared **skenmy-vps** box via docker compose. Push to `main` → CI (check, test, e2e) → builds
`ghcr.io/skenmy/schedule-helper` → dispatches `skenmy-vps` deploy (`deploy.yml`). The Caddy
fragment is `skenmy-vps/conf.d/30-schedule.skenmy.com.caddy`; the service block
`skenmy-vps/services.d/schedule-helper.yml`. Room files persist in the `./data/schedule-helper/`
volume (`/data` in the container, rooms under `/data/rooms/`).
