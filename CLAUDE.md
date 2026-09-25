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
  - `ws.ts` sessions (ordered queue, auth gate, heartbeat) · `http.ts` routes · `feed.ts` overlay feed
- `src/client/` — Svelte 5 runes, Vite root:
  - `lib/room.svelte.ts` WebSocket connection (`RoomConnection`), reconnect, clock sync
  - `lib/live.svelte.ts` derived view model (`Live`) + operator actions (`Ops`); get via
    `getRoom()` / `getLive()` / `getOps()` context helpers
  - `lib/ui.svelte.ts` open dialogs/tabs; `lib/prefs.svelte.ts` localStorage prefs
  - `views/` Landing, RoomView (connection owner), Conductor, MobileConductor, Kiosk

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
  snapshot. The log, capture results and drift settings are deliberately not undoable.
- **Never let broadcasts clobber drafts.** The server sends a new state object on every change
  and the clock ticks every 250 ms. Effects that seed form fields must read state via `untrack`
  or key off a primitive `$derived` (see `CaptureTab.svelte`, `EditTimesDialog.svelte`).
- Mutating actions are auth-gated in `ws.ts`; `join`/`ping` and all HTTP reads are public.

## Commands

```sh
npm run dev        # server :3000 + Vite :5173 (open /demo/demo/main — works offline)
npm run check      # tsc (server rules) + svelte-check + eslint + prettier --check
npm test           # vitest: shared maths, reducer, capture, upstream mapping, WS/SSE integration
npm run test:e2e   # playwright smoke tests (set CHROMIUM_PATH to use a preinstalled browser)
npm run format     # prettier --write
```

Run `npm run check && npm test` before pushing; CI runs those plus the e2e suite.

## Auth

tools.skenmy.com issues the shared `.skenmy.com` cookie. `auth.ts` calls
`TOOLS_AUTH_URL/auth/me?app=schedule&role=admin` (cached 60 s per cookie). Empty
`TOOLS_AUTH_URL` = everyone can write (local dev). Sign-in returns to `/`; the router restores
the room from `sessionStorage`.

## Stream capture

`capture:run` (WebSocket) → `grabFrame` → `readFrame` (Claude, `VISION_MODEL`, default
`claude-sonnet-4-6`) → `evaluateReading` compares with our timer at the frame's capture time →
result stored in `state.capture`, frame served from memory at
`/api/rooms/{ref}/frames/{id}`. `capture:apply` back-dates the matched run's `startedAt` from the
frame time, so processing latency doesn't matter. Set `CAPTURE_FRAME_FILE=fixtures/stream-frame.png`
to develop without a live stream.

## Deployment

Shared **skenmy-vps** box via docker compose. Push to `main` → CI (check, test, e2e) → builds
`ghcr.io/skenmy/schedule-helper` → dispatches `skenmy-vps` deploy (`deploy.yml`). The Caddy
fragment is `skenmy-vps/conf.d/30-schedule.skenmy.com.caddy`; the service block
`skenmy-vps/services.d/schedule-helper.yml`. Room files persist in the `./data/schedule-helper/`
volume (`/data` in the container, rooms under `/data/rooms/`).
