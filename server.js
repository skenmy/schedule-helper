const express = require('express');
const http = require('http');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const PORT = parseInt(process.env.PORT, 10) || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Per-marathon cache
const scheduleCache = {};
const CACHE_TTL = 60 * 1000; // 1 minute

function fetchJSON(url, redirectCount) {
  redirectCount = redirectCount || 0;
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'ScheduleHelper/1.0' }
    }, (res) => {
      // Follow redirects (Horaro API uses 302 slug→id redirects)
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        if (redirectCount >= 5) return reject(new Error('Too many redirects'));
        const loc = res.headers.location;
        const redirectUrl = loc.startsWith('http') ? loc : new URL(loc, url).href;
        return resolve(fetchJSON(redirectUrl, redirectCount + 1));
      }
      if (res.statusCode !== 200) {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => reject(new Error(`API returned ${res.statusCode}: ${body}`)));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Failed to parse JSON')); }
      });
    }).on('error', reject);
  });
}

app.get('/api/marathon/:marathonId', async (req, res) => {
  try {
    const data = await fetchJSON(`https://oengus.io/api/v1/marathons/${encodeURIComponent(req.params.marathonId)}`);
    res.json({
      name: data.name || '',
      startDate: data.startDate || '',
      endDate: data.endDate || '',
      location: data.location || '',
      onsite: data.onsite || false,
      twitch: data.twitch || '',
      twitter: data.twitter || '',
      youtube: data.youtube || '',
      discord: data.discord || '',
      bluesky: data.bluesky || '',
      supportedCharity: data.supportedCharity || '',
      donationCurrency: data.donationCurrency || '',
    });
  } catch (err) {
    console.error('Error fetching marathon info:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/schedules/:marathonId', async (req, res) => {
  try {
    const data = await fetchJSON(`https://oengus.io/api/v2/marathons/${encodeURIComponent(req.params.marathonId)}/schedules`);
    res.json({ schedules: (data.data || []).filter(s => s.published) });
  } catch (err) {
    console.error('Error fetching schedules:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/schedule/:marathonId/:slug', async (req, res) => {
  const { marathonId, slug } = req.params;
  const cacheKey = `${marathonId}/${slug}`;
  try {
    const now = Date.now();
    const cached = scheduleCache[cacheKey];
    if (cached && (now - cached.time) < CACHE_TTL) return res.json(cached.data);

    const data = await fetchJSON(`https://oengus.io/api/v2/marathons/${encodeURIComponent(marathonId)}/schedules/for-slug/${encodeURIComponent(slug)}`);
    const lines = (data.lines || []).map(line => {
      const runners = (line.runners || []).map(r => r.displayName || r.runnerName || 'Unknown');
      return {
        id: line.id, position: line.position,
        game: line.game || 'Unknown', category: line.category || '',
        console: line.console || '', type: line.type || 'SINGLE',
        runners, estimate: line.estimate || 'PT0S', setupTime: line.setupTime || 'PT0S',
        scheduledStart: line.date, setupBlock: line.setupBlock || false,
        setupBlockText: line.setupBlockText || '',
        customRun: line.customRun || false,
      };
    });
    lines.sort((a, b) => a.position - b.position);
    const result = { marathonId, slug, lines };
    scheduleCache[cacheKey] = { data: result, time: now };
    res.json(result);
  } catch (err) {
    console.error('Error fetching schedule:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Horaro API Proxy ───

app.get('/api/horaro/event/:eventSlug', async (req, res) => {
  try {
    const data = await fetchJSON(`https://horaro.net/-/api/v1/events/${encodeURIComponent(req.params.eventSlug)}`);
    const d = data.data || data;
    res.json({
      name: d.name || '',
      twitch: d.twitch || '',
      twitter: d.twitter || '',
      website: d.website || '',
      bluesky: d.bluesky || '',
    });
  } catch (err) {
    console.error('Error fetching Horaro event:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/horaro/schedules/:eventSlug', async (req, res) => {
  try {
    const data = await fetchJSON(`https://horaro.net/-/api/v1/events/${encodeURIComponent(req.params.eventSlug)}/schedules`);
    const schedules = (data.data || []).map(s => ({
      id: s.id, name: s.name, slug: s.slug,
    }));
    res.json({ schedules });
  } catch (err) {
    console.error('Error fetching Horaro schedules:', err);
    res.status(500).json({ error: err.message });
  }
});

function stripMarkdownLinks(str) {
  if (!str) return '';
  return str.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}

function mapHoraroColumns(columns, itemData) {
  const colMap = {};
  const matchers = {
    game: [/^game$/i, /^title$/i],
    category: [/^category$/i, /^run$/i],
    console: [/^console$/i, /^platform$/i, /^system$/i],
    runners: [/^runner/i, /^player/i],
  };
  for (const [field, patterns] of Object.entries(matchers)) {
    const idx = columns.findIndex(c => patterns.some(p => p.test(c)));
    if (idx >= 0) colMap[field] = idx;
  }
  // Fall back to first column as game name
  if (colMap.game == null) colMap.game = 0;

  return {
    game: stripMarkdownLinks(itemData[colMap.game] || '') || 'Unknown',
    category: colMap.category != null ? stripMarkdownLinks(itemData[colMap.category] || '') : '',
    console: colMap.console != null ? stripMarkdownLinks(itemData[colMap.console] || '') : '',
    runners: colMap.runners != null
      ? stripMarkdownLinks(itemData[colMap.runners] || '').split(/,\s*/).filter(Boolean)
      : [],
  };
}

app.get('/api/horaro/schedule/:eventSlug/:scheduleSlug', async (req, res) => {
  const { eventSlug, scheduleSlug } = req.params;
  const cacheKey = `horaro/${eventSlug}/${scheduleSlug}`;
  try {
    const now = Date.now();
    const cached = scheduleCache[cacheKey];
    if (cached && (now - cached.time) < CACHE_TTL) return res.json(cached.data);

    const data = await fetchJSON(`https://horaro.net/-/api/v1/events/${encodeURIComponent(eventSlug)}/schedules/${encodeURIComponent(scheduleSlug)}`);
    const sched = data.data || data;
    const columns = sched.columns || [];
    const setupTime = sched.setup || 'PT0S';

    const lines = (sched.items || []).map((item, index) => {
      const mapped = mapHoraroColumns(columns, item.data || []);
      return {
        id: index, position: index,
        game: mapped.game, category: mapped.category,
        console: mapped.console, type: 'SINGLE',
        runners: mapped.runners,
        estimate: item.length || 'PT0S',
        setupTime: setupTime,
        scheduledStart: item.scheduled,
        setupBlock: false, setupBlockText: '',
        customRun: false,
      };
    });

    const result = {
      marathonId: eventSlug, slug: scheduleSlug, lines,
      scheduleName: sched.name || '',
      twitch: sched.twitch || '',
    };
    scheduleCache[cacheKey] = { data: result, time: now };
    res.json(result);
  } catch (err) {
    console.error('Error fetching Horaro schedule:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Twitch Stream Capture + OCR ───

const tmpDir = path.join(os.tmpdir(), 'schedule-helper');
fs.mkdirSync(tmpDir, { recursive: true });

function captureStreamFrames(channel) {
  // Grab a single frame from the live stream. Claude Vision identifies the
  // running timer from one frame; no diff needed.
  return new Promise((resolve, reject) => {
    const sl = spawn('streamlink', [
      '--stdout',
      `https://twitch.tv/${channel}`,
      '720p,720p60,best',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    const ff = spawn('ffmpeg', [
      '-i', 'pipe:0',
      '-vf', 'fps=1',
      '-frames:v', '1',
      '-y', path.join(tmpDir, 'frame_1.png'),
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    sl.stdout.pipe(ff.stdin);
    // ffmpeg exits after 1 frame while streamlink is still writing — ignore EPIPE
    ff.stdin.on('error', () => {});

    let slErr = '';
    sl.stderr.on('data', d => slErr += d.toString());

    let ffErr = '';
    ff.stderr.on('data', d => ffErr += d.toString());

    const timeout = setTimeout(() => {
      sl.kill();
      ff.kill();
      reject(new Error('Stream capture timed out (20s). Is the channel live?'));
    }, 20000);

    ff.on('close', (code) => {
      clearTimeout(timeout);
      sl.kill();
      const frame1 = path.join(tmpDir, 'frame_1.png');
      if (code !== 0 || !fs.existsSync(frame1)) {
        return reject(new Error(`Capture failed. streamlink: ${slErr.slice(-200)}`));
      }
      // Mark the moment the frame hits disk so the client can compensate for
      // every step that follows (vision call + network round-trip + click).
      const capturedAt = Date.now();
      resolve({ frame1, capturedAt });
    });

    ff.on('error', (err) => {
      clearTimeout(timeout);
      sl.kill();
      reject(err);
    });

    sl.on('error', () => {
      clearTimeout(timeout);
      ff.kill();
      reject(new Error('streamlink not found. Install with: brew install streamlink'));
    });
  });
}

// ─── Claude Vision OCR ───
//
// Send the captured frame to Claude with a structured prompt that asks for:
// (1) the elapsed timer, (2) the estimate, (3) the game name (best-matched
// against the loaded schedule). Claude returns JSON; adaptVisionResult
// rewraps it into {elapsed,estimate,matchedGames,allTimers,rawText,
// detectionMethod} for the client.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const VISION_MODEL = process.env.VISION_MODEL || 'claude-sonnet-4-6';

function parseHMS(str) {
  if (typeof str !== 'string') return null;
  const m = str.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const ss = m[3] != null ? parseInt(m[3], 10) : 0;
  if (mm >= 60 || ss >= 60) return null;
  // Two-segment values from the model (MM:SS) come back via the H slot — treat
  // them as MM:SS rather than HH:MM, matching how speedrun overlays read.
  if (m[3] == null) return { display: `${pad2(0)}:${pad2(h)}:${pad2(mm)}`, seconds: h * 60 + mm };
  return { display: `${pad2(h)}:${pad2(mm)}:${pad2(ss)}`, seconds: h * 3600 + mm * 60 + ss };
}
function pad2(n) { return String(n).padStart(2, '0'); }

function buildVisionPrompt(gameNames) {
  const list = (gameNames || []).slice(0, 200).map(g => `- ${g}`).join('\n') || '(no schedule loaded)';
  return `You're reading a single frame from a Twitch broadcast of a speedrunning marathon.

Find these three things in the image and report them as JSON:

1. The **elapsed run timer** — the count-up timer ticking forward in real time. Usually large, often labelled "TIMER", "ELAPSED", or unlabelled. Report as HH:MM:SS.
2. The **estimate** — usually labelled "EST", "ESTIMATE", "Goal", or shown alongside the elapsed timer. Same format. Skip if you can't see it.
3. The **game being played** — pick the closest match from the schedule below. Game overlays often show the full title. If nothing on screen plausibly matches any scheduled run, return null.

Schedule on file for this marathon (pick the closest match by name):
${list}

Return JSON only, exactly this shape, no markdown fences, no commentary:
{"elapsed":"HH:MM:SS"|null,"estimate":"HH:MM:SS"|null,"game":"<exact name from list>"|null,"confidence":"high"|"medium"|"low"}`;
}

async function callClaudeVision(framePath, gameNames) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set on the server');
  const data = fs.readFileSync(framePath).toString('base64');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data } },
          { type: 'text', text: buildVisionPrompt(gameNames) },
        ],
      }],
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${json.error?.message || JSON.stringify(json).slice(0, 200)}`);
  const text = (json.content || []).map(c => c.text).filter(Boolean).join('\n');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Claude response had no JSON block');
  let parsed;
  try { parsed = JSON.parse(m[0]); }
  catch (e) { throw new Error('Claude response JSON parse failed: ' + e.message); }
  return { parsed, rawText: text };
}

function adaptVisionResult({ parsed, rawText }, gameNames) {
  const elapsed = parseHMS(parsed.elapsed);
  const estimate = parseHMS(parsed.estimate);
  const confidenceMap = { high: 0.95, medium: 0.7, low: 0.4 };
  const matchedGames = [];
  if (parsed.game && (gameNames || []).includes(parsed.game)) {
    matchedGames.push({ name: parsed.game, confidence: confidenceMap[parsed.confidence] ?? 0.7 });
  } else if (parsed.game) {
    // Claude returned something not in the schedule — still surface it so the
    // operator can see what was on screen, just at low confidence.
    matchedGames.push({ name: parsed.game, confidence: confidenceMap.low });
  }
  return {
    elapsed,
    estimate,
    allTimers: [elapsed, estimate].filter(Boolean),
    matchedGames,
    rawText,
    detectionMethod: 'claude-vision',
  };
}

app.post('/api/capture', async (req, res) => {
  // Admin gate — viewers can't trigger Twitch capture + a paid Vision call.
  const identity = await resolveIdentity(req.headers.cookie || '');
  if (!identity || !identity.canWrite) {
    return res.status(403).json({ error: 'Stream capture requires admin sign-in.' });
  }

  const { channel, gameNames } = req.body;

  if (!channel) {
    return res.status(400).json({ error: 'channel is required' });
  }

  const cleanChannel = channel.trim()
    .replace(/^(https?:\/\/)?(www\.)?twitch\.tv\//i, '')  // strip URL prefix
    .split(/[/?#\s]/)[0]                                   // take slug before query/fragment
    .replace(/[^a-zA-Z0-9_]/g, '');                        // sanitize
  if (!cleanChannel) {
    return res.status(400).json({ error: 'Invalid channel name' });
  }

  try {
    console.log(`Capturing one frame from twitch.tv/${cleanChannel}…`);
    const { frame1, capturedAt } = await captureStreamFrames(cleanChannel);

    console.log(`Running Claude Vision (${VISION_MODEL})…`);
    const vision = await callClaudeVision(frame1, gameNames || []);
    const result = adaptVisionResult(vision, gameNames || []);

    const frameData = fs.readFileSync(frame1);
    result.frameBase64 = `data:image/png;base64,${frameData.toString('base64')}`;
    result.capturedAt = capturedAt;

    res.json(result);
  } catch (err) {
    console.error('Capture error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── WebSocket Sync ───

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const rooms = new Map(); // key: "marathonId/slug" → { state, clients, dirty, saveTimeout, scheduleSource }

function defaultState() {
  return {
    actualRunIndex: -1,
    timerRunning: false,
    timerEpoch: null,
    elapsedSeconds: 0,
    eventLog: [],
    runnerStatus: {},
    skippedRuns: [],
    actualTimes: {},
    runEdits: {},
    eventLogNextId: 1,
    twitchChannel: '',
    messageText: '',
    messageColor: '',
    // Persistent announcement banner across the top of the conductor — set by any
    // operator with write access for "important things everyone should see".
    announcement: null, // { text, color, setBy, setAt } or null when cleared
    lastUpdated: null,
  };
}

function stateFilePath(key) {
  // key is "marathonId/slug", replace / with -- for filename
  return path.join(DATA_DIR, key.replace(/\//g, '--') + '.json');
}

function loadRoomState(key) {
  const fp = stateFilePath(key);
  try {
    if (fs.existsSync(fp)) {
      const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
      // Ensure all fields exist (backwards compat)
      const state = { ...defaultState(), ...data };
      // Reconstruct running timer from epoch
      if (state.timerRunning && state.timerEpoch) {
        state.elapsedSeconds = Math.round((Date.now() - state.timerEpoch) / 1000);
      }
      return state;
    }
  } catch (e) {
    console.error('Failed to load state for', key, e.message);
  }
  return defaultState();
}

function persistRoom(room, key) {
  room.dirty = true;
  if (room.saveTimeout) return; // already scheduled
  room.saveTimeout = setTimeout(() => {
    room.saveTimeout = null;
    if (!room.dirty) return;
    room.dirty = false;
    const fp = stateFilePath(key);
    const tmp = fp + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(room.state, null, 2));
      fs.renameSync(tmp, fp);
    } catch (e) {
      console.error('Failed to persist state for', key, e.message);
    }
  }, 1000);
}

function getOrCreateRoom(key) {
  if (rooms.has(key)) return rooms.get(key);
  const room = {
    state: loadRoomState(key),
    clients: new Set(),
    dirty: false,
    saveTimeout: null,
    scheduleSource: null, // set on first join
  };
  rooms.set(key, room);
  return room;
}

function broadcastState(room) {
  const msg = JSON.stringify({ type: 'state', ...room.state });
  for (const ws of room.clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

function broadcastUsers(room) {
  const msg = JSON.stringify({ type: 'users', count: room.clients.size });
  for (const ws of room.clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

// Fetch schedule for a room (needed for advance/skip logic)
async function getScheduleForRoom(key, room) {
  const [marathonId, slug] = key.split('/');
  const cacheKey = room.scheduleSource === 'horaro' ? `horaro/${marathonId}/${slug}` : `${marathonId}/${slug}`;
  const now = Date.now();
  const cached = scheduleCache[cacheKey];
  if (cached && (now - cached.time) < CACHE_TTL) return cached.data.lines || [];

  try {
    const url = room.scheduleSource === 'horaro'
      ? `https://horaro.net/-/api/v1/events/${encodeURIComponent(marathonId)}/schedules/${encodeURIComponent(slug)}`
      : `https://oengus.io/api/v2/marathons/${encodeURIComponent(marathonId)}/schedules/for-slug/${encodeURIComponent(slug)}`;
    const data = await fetchJSON(url);

    let lines;
    if (room.scheduleSource === 'horaro') {
      const sched = data.data || data;
      const columns = sched.columns || [];
      const setupTime = sched.setup || 'PT0S';
      lines = (sched.items || []).map((item, index) => {
        const mapped = mapHoraroColumns(columns, item.data || []);
        return {
          id: index, position: index,
          game: mapped.game, category: mapped.category,
          console: mapped.console, type: 'SINGLE',
          runners: mapped.runners,
          estimate: item.length || 'PT0S',
          setupTime: setupTime,
          scheduledStart: item.scheduled,
          setupBlock: false, setupBlockText: '',
          customRun: false,
        };
      });
    } else {
      lines = (data.lines || []).map(line => {
        const runners = (line.runners || []).map(r => r.displayName || r.runnerName || 'Unknown');
        return {
          id: line.id, position: line.position,
          game: line.game || 'Unknown', category: line.category || '',
          console: line.console || '', type: line.type || 'SINGLE',
          runners, estimate: line.estimate || 'PT0S', setupTime: line.setupTime || 'PT0S',
          scheduledStart: line.date, setupBlock: line.setupBlock || false,
          setupBlockText: line.setupBlockText || '',
          customRun: line.customRun || false,
        };
      });
      lines.sort((a, b) => a.position - b.position);
    }

    const result = { marathonId, slug, lines };
    scheduleCache[cacheKey] = { data: result, time: now };
    return lines;
  } catch (e) {
    console.error('Failed to fetch schedule for room', key, e.message);
    return [];
  }
}

function findNextRun(schedule, fromIndex, skippedRuns) {
  const skippedSet = new Set(skippedRuns);
  let next = fromIndex + 1;
  while (next < schedule.length && (schedule[next].setupBlock || skippedSet.has(next))) {
    next++;
  }
  return next < schedule.length ? next : -1;
}

// ─── WebSocket Server ───

const wss = new WebSocketServer({ server, path: '/ws' });

// ─── Auth (tools-skenmy forward-auth) ───
//
// Schedule-helper accepts read-only WS connections from anyone, but every
// state-mutating action is gated behind a Twitch-authenticated session
// brokered by tools-skenmy. The cookie is shared on .skenmy.com, so any
// HTTP request that reaches us already carries it; we just bounce it off
// the tools-skenmy /auth/me endpoint to get (login, display, avatar,
// canWrite). Behavior degrades to "everyone can write" when TOOLS_AUTH_URL
// is empty — that keeps local dev one less env var.
const TOOLS_AUTH_URL = process.env.TOOLS_AUTH_URL || ''; // e.g. http://tools-skenmy:3000
const AUTH_APP_ID = process.env.AUTH_APP_ID || 'schedule';
const AUTH_REFRESH_MS = 5 * 60 * 1000;
const MUTATING_ACTIONS = new Set([
  'timer:start', 'timer:stop', 'timer:reset',
  'run:select', 'run:advance', 'run:skip',
  'runner:cycle',
  'log:add', 'log:remove', 'log:clear',
  'twitch:set',
  'run:edit', 'run:editClear',
  'message:set', 'message:clear',
  'announcement:set', 'announcement:clear',
  'schedule:refresh',
]);

async function resolveIdentity(cookieHeader) {
  if (!TOOLS_AUTH_URL) return { authenticated: false, canWrite: true, user: null, root: false, mocked: true };
  try {
    const u = new URL('/auth/me', TOOLS_AUTH_URL);
    u.searchParams.set('app', AUTH_APP_ID);
    u.searchParams.set('role', 'admin');
    const res = await fetch(u, { headers: { cookie: cookieHeader || '' } });
    if (!res.ok) return { authenticated: false, canWrite: false, user: null, root: false };
    return await res.json();
  } catch (e) {
    console.error('[auth] /auth/me failed:', e.message);
    return { authenticated: false, canWrite: false, user: null, root: false };
  }
}

function sendAuthState(ws) {
  if (ws.readyState !== 1) return;
  const a = ws.auth || { authenticated: false, canWrite: !TOOLS_AUTH_URL, user: null };
  ws.send(JSON.stringify({
    type: 'auth',
    authenticated: !!a.authenticated,
    canWrite: !!a.canWrite,
    root: !!a.root,
    user: a.user || null,
    loginUrl: TOOLS_AUTH_URL ? 'https://tools.skenmy.com/auth/twitch/login?redirect=https://schedule.skenmy.com/' : null,
  }));
}

const BUILD_SHA = (process.env.BUILD_SHA || 'dev').slice(0, 12);

wss.on('connection', async (ws, req) => {
  let roomKey = null;
  let room = null;

  // First message on the wire: which build the server is. Used by the client to
  // detect when a deploy lands while a long-lived session is open and prompt
  // the operator to reload.
  try { ws.send(JSON.stringify({ type: 'version', sha: BUILD_SHA })); } catch {}

  // Identify the operator behind this socket from the shared .skenmy.com cookie.
  ws.cookieHeader = req.headers.cookie || '';
  ws.auth = await resolveIdentity(ws.cookieHeader);
  sendAuthState(ws);
  const refresh = setInterval(async () => {
    ws.auth = await resolveIdentity(ws.cookieHeader);
    sendAuthState(ws);
  }, AUTH_REFRESH_MS);
  ws.on('close', () => clearInterval(refresh));

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const { action, ...data } = msg;

    // Read-only viewers may join + receive state, but every mutation is blocked.
    if (MUTATING_ACTIONS.has(action) && !(ws.auth && ws.auth.canWrite)) {
      try {
        ws.send(JSON.stringify({
          type: 'denied',
          action,
          reason: ws.auth?.authenticated ? 'not_admin' : 'not_signed_in',
          loginUrl: TOOLS_AUTH_URL ? 'https://tools.skenmy.com/auth/twitch/login?redirect=https://schedule.skenmy.com/' : null,
        }));
      } catch {}
      return;
    }

    if (action === 'join') {
      const { marathonId, slug, scheduleSource } = data;
      if (!marathonId || !slug) return;
      // Leave previous room if any
      if (room) {
        room.clients.delete(ws);
        broadcastUsers(room);
      }
      roomKey = `${marathonId}/${slug}`;
      room = getOrCreateRoom(roomKey);
      if (scheduleSource) room.scheduleSource = scheduleSource;
      room.clients.add(ws);
      // Send full state to joining client
      ws.send(JSON.stringify({ type: 'state', ...room.state }));
      broadcastUsers(room);
      return;
    }

    if (!room || !roomKey) return;
    const state = room.state;

    switch (action) {
      case 'timer:start': {
        const seconds = typeof data.seconds === 'number' ? data.seconds : state.elapsedSeconds;
        state.timerEpoch = Date.now() - seconds * 1000;
        state.elapsedSeconds = seconds;
        state.timerRunning = true;
        state.lastUpdated = new Date().toISOString();
        break;
      }
      case 'timer:stop': {
        if (state.timerRunning && state.timerEpoch) {
          state.elapsedSeconds = Math.round((Date.now() - state.timerEpoch) / 1000);
        }
        state.timerRunning = false;
        state.timerEpoch = null;
        state.lastUpdated = new Date().toISOString();
        break;
      }
      case 'timer:reset': {
        state.timerRunning = false;
        state.timerEpoch = null;
        state.elapsedSeconds = 0;
        state.lastUpdated = new Date().toISOString();
        break;
      }
      case 'run:select': {
        const index = parseInt(data.index);
        if (isNaN(index)) return;
        state.actualRunIndex = index;
        if (!state.timerRunning) state.elapsedSeconds = 0;
        state.lastUpdated = new Date().toISOString();
        break;
      }
      case 'run:advance': {
        if (state.actualRunIndex < 0) return;
        const schedule = await getScheduleForRoom(roomKey, room);
        if (schedule.length === 0) return;
        const nextIdx = findNextRun(schedule, state.actualRunIndex, state.skippedRuns);
        if (nextIdx < 0) return; // no more runs
        // Record actual finish time
        if (state.timerRunning && state.timerEpoch) {
          state.elapsedSeconds = Math.round((Date.now() - state.timerEpoch) / 1000);
        }
        if (state.elapsedSeconds > 0) state.actualTimes[state.actualRunIndex] = state.elapsedSeconds;
        const prevName = schedule[state.actualRunIndex]?.game || 'Unknown';
        const nextName = schedule[nextIdx]?.game || 'Unknown';
        state.actualRunIndex = nextIdx;
        state.timerRunning = false;
        state.timerEpoch = null;
        state.elapsedSeconds = 0;
        // Auto log entry
        state.eventLog.unshift({
          id: state.eventLogNextId++,
          timestamp: new Date().toISOString(),
          text: 'Advanced to: ' + nextName + ' (from: ' + prevName + ')',
          type: 'auto',
          runIndex: nextIdx,
          runName: nextName,
        });
        state.lastUpdated = new Date().toISOString();
        break;
      }
      case 'run:skip': {
        if (state.actualRunIndex < 0) return;
        const schedule = await getScheduleForRoom(roomKey, room);
        if (schedule.length === 0) return;
        const skipName = schedule[state.actualRunIndex]?.game || 'Unknown';
        if (!state.skippedRuns.includes(state.actualRunIndex)) {
          state.skippedRuns.push(state.actualRunIndex);
        }
        state.eventLog.unshift({
          id: state.eventLogNextId++,
          timestamp: new Date().toISOString(),
          text: 'Skipped: ' + skipName,
          type: 'auto',
          runIndex: state.actualRunIndex,
          runName: skipName,
        });
        const nextIdx = findNextRun(schedule, state.actualRunIndex, state.skippedRuns);
        if (nextIdx >= 0) {
          state.actualRunIndex = nextIdx;
          state.timerRunning = false;
          state.timerEpoch = null;
          state.elapsedSeconds = 0;
        }
        state.lastUpdated = new Date().toISOString();
        break;
      }
      case 'runner:cycle': {
        const index = parseInt(data.index);
        if (isNaN(index)) return;
        const current = state.runnerStatus[index] || 'unchecked';
        const cycle = { unchecked: 'ready', ready: 'missing', missing: 'unchecked' };
        state.runnerStatus[index] = cycle[current];
        state.lastUpdated = new Date().toISOString();
        break;
      }
      case 'log:add': {
        if (!data.text) return;
        state.eventLog.unshift({
          id: state.eventLogNextId++,
          timestamp: new Date().toISOString(),
          text: data.text,
          type: data.type || 'note',
          runIndex: state.actualRunIndex,
          runName: data.runName || '',
        });
        state.lastUpdated = new Date().toISOString();
        break;
      }
      case 'log:remove': {
        if (data.id == null) return;
        state.eventLog = state.eventLog.filter(e => e.id !== data.id);
        state.lastUpdated = new Date().toISOString();
        break;
      }
      case 'log:clear': {
        state.eventLog = [];
        state.lastUpdated = new Date().toISOString();
        break;
      }
      case 'twitch:set': {
        state.twitchChannel = data.channel || '';
        state.lastUpdated = new Date().toISOString();
        break;
      }
      case 'run:edit': {
        const index = parseInt(data.index);
        if (isNaN(index)) return;
        if (!state.runEdits[index]) state.runEdits[index] = {};
        if (data.actualStart != null) state.runEdits[index].actualStart = data.actualStart;
        if (data.actualEnd != null) state.runEdits[index].actualEnd = data.actualEnd;
        if (data.actualDuration != null) state.runEdits[index].actualDuration = data.actualDuration;
        state.lastUpdated = new Date().toISOString();
        break;
      }
      case 'run:editClear': {
        const index = parseInt(data.index);
        if (isNaN(index)) return;
        delete state.runEdits[index];
        state.lastUpdated = new Date().toISOString();
        break;
      }
      case 'message:set': {
        state.messageText = data.text || '';
        state.messageColor = data.color || '';
        state.lastUpdated = new Date().toISOString();
        break;
      }
      case 'message:clear': {
        state.messageText = '';
        state.messageColor = '';
        state.lastUpdated = new Date().toISOString();
        break;
      }
      case 'announcement:set': {
        const text = String(data.text || '').trim();
        if (!text) return;
        state.announcement = {
          text: text.slice(0, 500),
          color: typeof data.color === 'string' ? data.color : '#fbbf24',
          setBy: ws.auth?.user?.display || ws.auth?.user?.login || 'operator',
          setAt: new Date().toISOString(),
        };
        state.lastUpdated = new Date().toISOString();
        break;
      }
      case 'announcement:clear': {
        state.announcement = null;
        state.lastUpdated = new Date().toISOString();
        break;
      }
      case 'schedule:refresh': {
        // Bust the shared HTTP cache for this room's schedule URL, re-fetch from
        // upstream, then broadcast the fresh lines to every client in the room.
        // Fire-and-forget — the actor doesn't get an extra ack beyond the
        // broadcast that lands on every socket once the fetch finishes.
        const cacheKey = room.scheduleSource === 'horaro' ? `horaro/${roomKey}` : roomKey;
        delete scheduleCache[cacheKey];
        const requester = ws.auth?.user?.login || 'operator';
        getScheduleForRoom(roomKey, room).then(lines => {
          const payload = JSON.stringify({
            type: 'schedule', marathonId: roomKey.split('/')[0], slug: roomKey.split('/')[1],
            lines, refreshedBy: requester, refreshedAt: new Date().toISOString(),
          });
          for (const c of room.clients) if (c.readyState === 1) c.send(payload);
        }).catch(e => console.error('[schedule:refresh] failed', e.message));
        return; // skip the standard broadcastState — the schedule payload above is enough
      }
      default:
        return; // unknown action, don't broadcast
    }

    broadcastState(room);
    persistRoom(room, roomKey);
  });

  ws.on('close', () => {
    if (room) {
      room.clients.delete(ws);
      broadcastUsers(room);
      // Clean up empty rooms after a generous delay (7 days).
      // Marathons can run for days — don't evict state prematurely.
      // State is always on disk anyway, so this just frees in-memory room objects.
      if (room.clients.size === 0) {
        const ROOM_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
        setTimeout(() => {
          if (room.clients.size === 0 && rooms.has(roomKey)) {
            // Final persist before cleanup
            if (room.dirty) {
              const fp = stateFilePath(roomKey);
              const tmp = fp + '.tmp';
              try {
                fs.writeFileSync(tmp, JSON.stringify(room.state, null, 2));
                fs.renameSync(tmp, fp);
              } catch (e) {}
            }
            if (room.saveTimeout) clearTimeout(room.saveTimeout);
            rooms.delete(roomKey);
          }
        }, ROOM_TTL);
      }
    }
  });
});

// ─── Graceful Shutdown ───
// Flush all dirty rooms to disk before exiting so no state is lost on restart.

function flushAllRooms() {
  let flushed = 0;
  for (const [key, room] of rooms) {
    if (room.saveTimeout) {
      clearTimeout(room.saveTimeout);
      room.saveTimeout = null;
    }
    // Always write on shutdown — even if not marked dirty, the debounce
    // timer may have already cleared the flag while state was still only in memory.
    const fp = stateFilePath(key);
    const tmp = fp + '.tmp';
    try {
      // Sync elapsed from epoch so the persisted value is current
      if (room.state.timerRunning && room.state.timerEpoch) {
        room.state.elapsedSeconds = Math.round((Date.now() - room.state.timerEpoch) / 1000);
      }
      fs.writeFileSync(tmp, JSON.stringify(room.state, null, 2));
      fs.renameSync(tmp, fp);
      flushed++;
    } catch (e) {
      console.error('Shutdown: failed to flush', key, e.message);
    }
  }
  return flushed;
}

function shutdown(signal) {
  console.log(`\n${signal} received — flushing state...`);
  const count = flushAllRooms();
  console.log(`Flushed ${count} room(s) to disk.`);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, () => {
  console.log(`Schedule Helper running at http://localhost:${PORT}`);
});
