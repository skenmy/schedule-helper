# Schedule Helper

Marathon schedule tracker for speedrun events (built for UKSG RED 2026). Single-page app with a Node/Express backend.

## Architecture

Two files make up the entire app:

- `server.js` (~840 lines) — Express backend: Oengus API proxy, Twitch stream capture + OCR pipeline, WebSocket sync server
- `public/index.html` (~3575 lines) — Entire frontend SPA: CSS, state management, rendering, kiosk mode, all inline

No build step. No framework. Vanilla JS with server-rendered-style `render()` function that rebuilds the DOM.

## Key Systems

### Schedule Data
- Fetched from Oengus.io API (v1 for marathon info, v2 for schedule lines)
- Cached server-side for 1 minute per marathon/slug combo
- Durations are ISO 8601 (`PT1H30M`) parsed client-side

### Twitch Stream Capture (the complex part)
Pipeline: `streamlink` → `ffmpeg` → `tesseract` → timer parsing

1. **Two-frame capture**: `captureStreamFrames()` grabs 2 frames ~1 second apart using `ffmpeg -vf fps=1 -frames:v 2`. This is the key innovation — comparing frames lets us identify the *running* timer.
2. **Preprocessing**: Grayscale + high contrast (`format=gray,eq=contrast=2:brightness=0.1`) for better OCR
3. **OCR**: Tesseract with `--psm 11` (sparse text mode)
4. **Timer detection** (3-strategy cascade in `parseOCRResults()`):
   - **Frame comparison** (best): Find a timer that incremented 1-3 seconds between frames → that's the elapsed timer
   - **EST prefix**: If comparison fails and only one frame worked, exclude timers near "EST:" label
   - **Heuristic**: Last resort — pick the largest non-estimate timer
5. **Break screen handling**: If both frames have timers but none are incrementing, report no running timer (don't guess)

### OCR Quirks
Tesseract frequently inserts spaces within timer digits. `cleanOCRSpaces()` handles patterns like:
- `00:1 1:42` → `00:11:42` (space between digits)
- `00:12: 55` → `00:12:55` (space after colon)
- `00 :12:55` → `00:12:55` (space before colon)

Space collapsing is done **per-line** to avoid merging adjacent numbers across lines (e.g., `00:20:00\n00:14:05` must stay separate).

EST detection joins lines first (OCR often splits `EST:` and the time value onto separate lines) and supports both `HH:MM:SS` and `MM:SS` (Tesseract sometimes drops leading `00:`).

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

**System tools** (must be installed):
- `streamlink` — extracts live Twitch stream to stdout
- `ffmpeg` — frame capture and image preprocessing
- `tesseract` — OCR engine

## Deployment

- **Server**: `root@89.167.17.202`
- **Path**: `/opt/schedule-helper/`
- **Service**: `schedule-helper.service` (systemd, auto-restart on failure)
- **Port**: 3000

Deploy with:
```
scp server.js root@89.167.17.202:/opt/schedule-helper/
scp public/index.html root@89.167.17.202:/opt/schedule-helper/public/index.html
ssh root@89.167.17.202 "cd /opt/schedule-helper && npm install ws && systemctl restart schedule-helper"
```

First-time setup also needs:
```
ssh root@89.167.17.202 "mkdir -p /opt/schedule-helper/data"
```

## Data Directory

Synced state persisted as JSON files in `./data/` (dev) or `/opt/schedule-helper/data/` (server):
- `{marathonId}--{slug}.json` — per-room state (timer, run index, event log, runner status, run edits, etc.)
- Written atomically on every state mutation (debounced to max once per second)
- Loaded on room creation (first client joins)

## Temp Files

Frame captures go to `$TMPDIR/schedule-helper/` (`/tmp/schedule-helper/` on the server):
- `frame_1.png`, `frame_2.png` — raw captured frames
- `frame_ocr_1.png`, `frame_ocr_2.png` — preprocessed for OCR

These are overwritten on each capture.

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/marathon/:id` | Marathon metadata from Oengus |
| GET | `/api/schedules/:id` | List published schedules |
| GET | `/api/schedule/:id/:slug` | Full schedule lines (cached) |
| POST | `/api/capture` | Capture stream frame + OCR. Body: `{ channel, gameNames[] }`. Returns: `{ elapsed, estimate, allTimers, matchedGames, detectionMethod, rawText, frameBase64 }` |
| WS | `/ws` | WebSocket endpoint for real-time sync. See WebSocket protocol section above. |

## Known Limitations

- Tesseract OCR is unreliable — timer detection depends on font, contrast, and overlay layout. The two-frame comparison approach mitigates this but still requires OCR to read the timer correctly in both frames.
- The channel input accepts both bare slugs (`uksgmarathon`) and full URLs (`https://twitch.tv/uksgmarathon`), including with query strings and trailing slashes.
- Capture takes several seconds (streamlink connection + waiting for 2 frames 1s apart + 2x preprocessing + 2x OCR).
