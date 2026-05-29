# Schedule Helper

Marathon schedule tracker for speedrun events (built for UKSG RED 2026). Single-page app with a Node/Express backend.

## Architecture

- `server.js` (~970 lines) — Express backend: Oengus API proxy, Twitch stream capture + Claude Vision pipeline, WebSocket sync server
- `public/index.html` + `public/conductor/{styles.css,tabs.js,edit.js,app.js,kiosk.js,mobile.css,mobile.js}` — Conductor UI split across a thin shell HTML and per-concern JS/CSS modules

No build step. No framework. Vanilla JS with server-rendered-style `render()` function that rebuilds the DOM.

## Key Systems

### Schedule Data
- Fetched from Oengus.io API (v1 for marathon info, v2 for schedule lines)
- Cached server-side for 1 minute per marathon/slug combo
- Durations are ISO 8601 (`PT1H30M`) parsed client-side

### Twitch Stream Capture
Pipeline: `streamlink` → `ffmpeg` (one frame) → Claude Vision → structured JSON

1. **Single-frame capture**: `captureStreamFrames()` grabs ONE frame via `streamlink … | ffmpeg -vf fps=1 -frames:v 1`. The vision model identifies the running timer from context alone — no diff needed.
2. **Vision call**: `callClaudeVision()` POSTs the frame to `https://api.anthropic.com/v1/messages` with `VISION_MODEL` (default `claude-sonnet-4-6`) and a prompt built from the loaded schedule's game names. Claude returns JSON: `{ elapsed, estimate, game, confidence }`.
3. **Adapter**: `adaptVisionResult()` rewraps that into the existing `{ elapsed, estimate, matchedGames, allTimers, rawText, detectionMethod, frameBase64, capturedAt }` shape so the client wire format is unchanged.
4. **Admin gate**: `/api/capture` calls `resolveIdentity()` (the same forward-auth path the WS uses) and returns 403 if the caller isn't an admin. Stops viewers triggering paid Vision calls.
5. **Timing**: `capturedAt` is the wallclock when the frame hit disk on the server. The client subtracts it from `Date.now()` when applying the OCR'd elapsed back onto the live timer, compensating for Vision + JSON + network + click latency.

### Real-Time Collaborative Sync (WebSocket)
Multiple users on the same schedule see the same state. Any user can control the timer, advance runs, add notes.

**Architecture**: Server holds authoritative state per room. Clients send actions, server applies them, persists to disk, and broadcasts full state to all clients. Full-state broadcasts (not deltas) eliminate sync bugs.

**Room model**: Rooms keyed by `{marathonId}/{slug}`. Each room has: state object, connected clients set, dirty flag, save timer. Rooms are created on first join, in-memory state cleaned up 7 days after last client leaves (state is always on disk).

**WebSocket protocol** (on `/ws` path):
- Client → Server: `{action: "join"|"timer:start"|"timer:stop"|"timer:reset"|"run:select"|"run:advance"|"run:skip"|"runner:cycle"|"log:add"|"log:remove"|"log:clear"|"twitch:set"|"run:edit"|"run:editClear", ...data}`
- Server → Client: `{type: "state", ...fullState}` or `{type: "users", count: N}`

**State persistence**: JSON files in `./data/` directory (or `/opt/schedule-helper/data/` on server). Written atomically (write to .tmp, rename) debounced to at most once per second.

**Offline fallback**: If WebSocket is disconnected, all functions fall back to local-only mode (existing localStorage behavior). On reconnect, server state wins.

**Timer sync**: Server stores `timerEpoch` (absolute ms timestamp). All clients derive elapsed time locally from the shared epoch — no drift, no round-trip needed for smooth display.

### Editable Schedule Table
Each run row has a pencil icon. Clicking expands an edit panel with Actual Start (HH:MM), Actual End (HH:MM), and Actual Duration (H:MM:SS) inputs. Edits stored in `runEdits[runIndex]` on the server. Client-side inference fills missing fields (e.g., start + duration → end). Inferred values shown dimmed.

### Kiosk Mode
Configurable multi-panel grid display for role-specific views (host, tech, runner green room). Accessed via "Kiosk" button in header.

**Layouts**: 10 preset grid layouts (1x1, 1x2, 2x1, 2x2, 1+2, 2+1, 2+3, 3x3, 1+3, sidebar+main). Each uses CSS Grid with named areas for asymmetric layouts.

**Panels**: All 12 panels are available for kiosk assignment (delta, current, running, timing, ondeck, schedule, marathon, nextup, controls, twitch, log, progress). Every panel has a `data-panel` attribute.

**Presets**: Quick presets for common roles — Host View (1+2: status + running + on-deck), Tech View (2x2: controls + running + log + on-deck), Schedule Only (1x1: full schedule), Runner Green Room (2+1: on-deck + running + schedule).

**Pop-out**: Can be launched in a separate window via "Pop Out Window" button or `?kiosk=1` URL parameter. Config saved to localStorage.

### Frontend State
- All state is global variables at the top of the script block
- `render()` rebuilds the entire `#app` innerHTML on every change
- State persisted to localStorage (fallback) or synced via WebSocket (primary)
- Keyboard shortcuts: Space=timer, N=next run, Esc=exit kiosk/modal, ?=help

## External Dependencies

**npm**: `express`, `ws`

**System tools** (must be installed in the container):
- `streamlink` — extracts live Twitch stream to stdout
- `ffmpeg` — single-frame capture from the streamlink stdout

**External services:**
- Anthropic API — Claude Vision powers `/api/capture`. Set `ANTHROPIC_API_KEY` (and optionally `VISION_MODEL`, defaults to `claude-sonnet-4-6`).
- tools.skenmy.com — issues the shared `.skenmy.com` session cookie. Set `TOOLS_AUTH_URL=http://tools-skenmy:3000` so this app can call `/auth/me?app=schedule&role=admin` to gate mutations + the capture endpoint.

## Deployment

Lives on the shared **skenmy-vps** Hostinger box at `vps-uk` via docker compose.
A push to `main` triggers CI which builds + pushes `ghcr.io/skenmy/schedule-helper`,
then fires the `skenmy-vps` deploy workflow which updates the pinned tag and runs
`docker compose pull && up -d`. URL: <https://schedule.skenmy.com>.

The Caddy fragment is at `skenmy-vps/conf.d/30-schedule.skenmy.com.caddy`; the
service block at `skenmy-vps/services.d/schedule-helper.yml`. Persistent room
JSON lives in the `./data/schedule-helper/` volume mount on the host.

## Data Directory

Synced state persisted as JSON files in `./data/` (dev) or `/opt/schedule-helper/data/` (server):
- `{marathonId}--{slug}.json` — per-room state (timer, run index, event log, runner status, run edits, etc.)
- Written atomically on every state mutation (debounced to max once per second)
- Loaded on room creation (first client joins)

## Temp Files

Frame captures go to `$TMPDIR/schedule-helper/` (`/tmp/schedule-helper/` on the server):
- `frame_1.png` — single captured frame sent to Claude Vision

Overwritten on each capture.

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/marathon/:id` | Marathon metadata from Oengus |
| GET | `/api/schedules/:id` | List published schedules |
| GET | `/api/schedule/:id/:slug` | Full schedule lines (cached) |
| POST | `/api/capture` | Capture stream frame + OCR. Body: `{ channel, gameNames[] }`. Returns: `{ elapsed, estimate, allTimers, matchedGames, detectionMethod, rawText, frameBase64 }` |
| WS | `/ws` | WebSocket endpoint for real-time sync. See WebSocket protocol section above. |

## Known Limitations

- Stream OCR depends on Claude Vision being able to see the overlay. Heavily obscured timers, very low-resolution streams, or non-English UI may still confuse it.
- The channel input accepts both bare slugs (`uksgmarathon`) and full URLs (`https://twitch.tv/uksgmarathon`), including with query strings and trailing slashes.
- Capture takes several seconds (streamlink connection + single-frame ffmpeg grab + Claude Vision round-trip).
