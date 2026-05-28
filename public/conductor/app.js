// ============================================================
// Schedule Tracker — Conductor (production)
// Drop-in replacement for public/index.html, wired to:
//   - WebSocket protocol on /ws (see server.js)
//   - REST API: /api/schedules, /api/schedule, /api/marathon, /api/capture
//   - URL hash for bookmarkable schedules
// ============================================================

// ============================================================ STATE
const STATE = {
  // routing
  marathonId: null,
  scheduleSlug: null,
  scheduleSource: 'oengus', // 'oengus' | 'horaro'

  // marathon + schedule data (REST)
  marathonInfo: null,
  schedule: [], // [{ id, position, game, category, console, type, runners[], estimate, setupTime, scheduledStart, setupBlock, setupBlockText, customRun }]

  // synced state (WS)
  actualRunIndex: -1,
  timerRunning: false,
  timerEpoch: null,
  elapsedSeconds: 0,
  eventLog: [],
  runnerStatus: {},
  skippedRuns: new Set(),
  actualTimes: {},
  runEdits: {},
  twitchChannel: '',
  messageText: '',
  messageColor: '',

  // ws / connection
  ws: null,
  wsConnected: false,
  activeUsers: 0,

  // local UI
  tab: 'schedule',
  selectedRunIndex: -1, // -1 = follow actualRunIndex
  filter: '',
  filterTag: 'live',
  zoom: 6, // hours
  paletteOpen: false,

  // local capture (not synced — but visible across the UI)
  captureResult: null,    // { elapsed, estimate, allTimers, matchedGames, detectionMethod, rawText, frameBase64 }
  captureStatus: '',       // '' | 'loading' | 'error'
  captureError: '',
};

// Hold a local elapsed ticker (visual only). Server is authoritative.
let TICKER = null;

// Expose helpers + state on window for sibling modules (kiosk.js, edit.js)
window.STATE = STATE;

// ============================================================ DOM HELPERS
const $ = (sel, parent=document) => parent.querySelector(sel);
const $$ = (sel, parent=document) => Array.from(parent.querySelectorAll(sel));
function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

// ============================================================ STREAM CAPTURE
async function runCapture() {
  const channel = $('#cap-channel')?.value.trim() || STATE.twitchChannel;
  if (!channel) {
    STATE.captureStatus = 'error';
    STATE.captureError = 'No Twitch channel set';
    renderCaptureUI();
    return;
  }
  STATE.captureStatus = 'loading';
  STATE.captureError = '';
  renderCaptureUI();
  const cur = STATE.schedule[STATE.actualRunIndex];
  const gameNames = cur ? [cur.game].filter(Boolean) : STATE.schedule.map(r => r.game).filter(Boolean).slice(0, 80);
  try {
    const res = await fetch('/api/capture', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, gameNames }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      STATE.captureStatus = 'error';
      STATE.captureError = data.error || `HTTP ${res.status}`;
    } else {
      STATE.captureStatus = '';
      STATE.captureResult = data;
    }
  } catch (e) {
    STATE.captureStatus = 'error';
    STATE.captureError = e.message;
  }
  renderCaptureUI();
}

function renderCaptureUI() {
  // Detail panel OCR row
  const ocrRead = $('#ocr-read');
  const ocrThumb = $('#ocr-thumb');
  if (ocrRead) {
    if (STATE.captureStatus === 'loading') {
      ocrRead.innerHTML = '<span class="ok" style="color:var(--warn)">capturing…</span>';
    } else if (STATE.captureStatus === 'error') {
      ocrRead.innerHTML = `<span style="color:var(--hot)">${escapeHtml(STATE.captureError)}</span>`;
    } else if (STATE.captureResult) {
      const r = STATE.captureResult;
      const detected = r.elapsed?.display || r.elapsed || '—';
      const method = r.detectionMethod ? ` <span class="ok">via ${escapeHtml(r.detectionMethod)}</span>` : '';
      ocrRead.innerHTML = `${escapeHtml(detected)}${method}`;
    } else {
      ocrRead.innerHTML = '— <span class="ok">not yet captured</span>';
    }
  }
  if (ocrThumb && STATE.captureResult?.frameBase64) {
    ocrThumb.style.background = `#050608 url(data:image/png;base64,${STATE.captureResult.frameBase64}) center/cover no-repeat`;
  }
  // Capture tab: if currently open, re-render with the fresh result
  if (STATE.tab === 'capture' && typeof renderTab === 'function') renderTab();
}

// ============================================================ FORMATTERS
function parseDuration(iso) {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}
function fmtHMS(s) {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), x = s%60;
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(x).padStart(2,'0');
}
function fmtHM(s) {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60);
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
}
function fmtDelta(s) {
  const sign = s < 0 ? '−' : '+';
  s = Math.abs(Math.floor(s));
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), x = s%60;
  if (h > 0) {
    return sign + h + ':' + String(m).padStart(2,'0') + ':' + String(x).padStart(2,'0');
  }
  return sign + String(m).padStart(2,'0') + ':' + String(x).padStart(2,'0');
}
function fmtTime(date) {
  if (!(date instanceof Date) || isNaN(date)) return '—';
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
// Publish to siblings
Object.assign(window, { parseDuration, fmtHMS, fmtHM, fmtDelta, fmtTime, escapeHtml });

// ============================================================ URL PARSING + ROUTING
function parseScheduleUrl(url) {
  url = url.trim();
  const horaroFull = url.match(/horaro\.net\/([^/\s?#]+)\/([^/\s?#]+)/i);
  if (horaroFull) return { source: 'horaro', marathonId: horaroFull[1], slug: horaroFull[2] };
  const horaroPart = url.match(/horaro\.net\/([^/\s?#]+)\/?$/i);
  if (horaroPart) return { source: 'horaro', marathonId: horaroPart[1], slug: null };
  const oengusFull = url.match(/oengus\.io\/(?:[a-z-]+\/)?marathon\/([^/]+)\/schedule\/([^/\s?#]+)/i);
  if (oengusFull) return { source: 'oengus', marathonId: oengusFull[1], slug: oengusFull[2] };
  const oengusPart = url.match(/oengus\.io\/(?:[a-z-]+\/)?marathon\/([^/\s?#]+)/i);
  if (oengusPart) return { source: 'oengus', marathonId: oengusPart[1], slug: null };
  if (/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(url)) {
    const [m, s] = url.split('/');
    return { source: 'oengus', marathonId: m, slug: s };
  }
  if (/^[a-zA-Z0-9_-]+$/.test(url)) {
    return { source: 'oengus', marathonId: url, slug: null };
  }
  return null;
}

function readHash() {
  let hash = (location.hash || '').replace('#', '');
  if (!hash) return null;
  if (hash.startsWith('horaro:')) {
    const [marathonId, slug] = hash.replace('horaro:', '').split('/');
    if (marathonId && slug) return { source: 'horaro', marathonId, slug };
  }
  const parts = hash.split('/');
  if (parts.length === 2) return { source: 'oengus', marathonId: parts[0], slug: parts[1] };
  return null;
}

function writeHash() {
  if (!STATE.marathonId || !STATE.scheduleSlug) return;
  location.hash = STATE.scheduleSource === 'horaro'
    ? `horaro:${STATE.marathonId}/${STATE.scheduleSlug}`
    : `${STATE.marathonId}/${STATE.scheduleSlug}`;
}

// ============================================================ SCHEDULE LOAD
async function loadSchedule() {
  const url = STATE.scheduleSource === 'horaro'
    ? `/api/horaro/schedule/${encodeURIComponent(STATE.marathonId)}/${encodeURIComponent(STATE.scheduleSlug)}`
    : `/api/schedule/${encodeURIComponent(STATE.marathonId)}/${encodeURIComponent(STATE.scheduleSlug)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  STATE.schedule = data.lines || [];
}

async function loadMarathonInfo() {
  const url = STATE.scheduleSource === 'horaro'
    ? `/api/horaro/event/${encodeURIComponent(STATE.marathonId)}`
    : `/api/marathon/${encodeURIComponent(STATE.marathonId)}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    STATE.marathonInfo = data;
    if (!STATE.twitchChannel && data.twitch) STATE.twitchChannel = data.twitch;
  } catch {}
}

async function resolveSlugIfNeeded() {
  if (STATE.scheduleSlug) return;
  const url = STATE.scheduleSource === 'horaro'
    ? `/api/horaro/schedules/${encodeURIComponent(STATE.marathonId)}`
    : `/api/schedules/${encodeURIComponent(STATE.marathonId)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  if (!data.schedules || !data.schedules.length) throw new Error('No published schedules found.');
  STATE.scheduleSlug = data.schedules[0].slug;
}

// ============================================================ WEBSOCKET
function wsConnect() {
  if (STATE.ws && (STATE.ws.readyState === WebSocket.CONNECTING || STATE.ws.readyState === WebSocket.OPEN)) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = proto + '//' + location.host + '/ws';
  setConnStatus('connecting');
  const ws = new WebSocket(url);
  STATE.ws = ws;

  ws.addEventListener('open', () => {
    setConnStatus('connected');
    ws.send(JSON.stringify({
      action: 'join',
      marathonId: STATE.marathonId,
      slug: STATE.scheduleSlug,
      scheduleSource: STATE.scheduleSource,
    }));
  });

  ws.addEventListener('message', e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === 'state') applyServerState(msg);
    else if (msg.type === 'users') {
      STATE.activeUsers = msg.count;
      renderConnText();
    }
  });

  ws.addEventListener('close', () => {
    setConnStatus('disconnected');
    setTimeout(() => { if (STATE.marathonId && STATE.scheduleSlug) wsConnect(); }, 1500);
  });

  ws.addEventListener('error', () => setConnStatus('disconnected'));
}

function wsSend(action, data = {}) {
  if (!STATE.ws || STATE.ws.readyState !== WebSocket.OPEN) return;
  STATE.ws.send(JSON.stringify({ action, ...data }));
}

function setConnStatus(s) {
  STATE.wsConnected = (s === 'connected');
  const el = $('#conn-status');
  el.classList.remove('connecting', 'disconnected');
  if (s === 'connecting') el.classList.add('connecting');
  else if (s === 'disconnected') el.classList.add('disconnected');
  renderConnText();
}

function renderConnText() {
  const el = $('#conn-text');
  if (!STATE.wsConnected) {
    el.textContent = STATE.ws && STATE.ws.readyState === WebSocket.CONNECTING ? 'connecting…' : 'disconnected — retrying';
    return;
  }
  el.textContent = `${STATE.activeUsers} op${STATE.activeUsers === 1 ? '' : 's'} · synced`;
}

function applyServerState(s) {
  const prevActual = STATE.actualRunIndex;
  STATE.actualRunIndex = s.actualRunIndex ?? -1;
  STATE.timerRunning = !!s.timerRunning;
  STATE.timerEpoch = s.timerEpoch || null;
  STATE.elapsedSeconds = s.elapsedSeconds || 0;
  STATE.eventLog = s.eventLog || [];
  STATE.runnerStatus = s.runnerStatus || {};
  STATE.skippedRuns = new Set(s.skippedRuns || []);
  STATE.actualTimes = s.actualTimes || {};
  STATE.runEdits = s.runEdits || {};
  if (s.twitchChannel != null) STATE.twitchChannel = s.twitchChannel;
  STATE.messageText = s.messageText || '';
  STATE.messageColor = s.messageColor || '';

  // Selected run defaults to follow actual run (compare against the PREVIOUS actual, since
  // a user looking at the live run should follow when the live run advances).
  if (STATE.selectedRunIndex === -1 || STATE.selectedRunIndex === prevActual) {
    STATE.selectedRunIndex = STATE.actualRunIndex;
  }
  renderAll();
  // Mobile shell: keep the sticky action bar (Start/Stop, Next) in sync with timer state
  if (window.syncMobileNow) window.syncMobileNow();
  if (window.refreshMobileLogBadge) window.refreshMobileLogBadge();
}

// ============================================================ ELAPSED TICKER (visual)
function elapsedNow() {
  if (STATE.timerRunning && STATE.timerEpoch) {
    return Math.round((Date.now() - STATE.timerEpoch) / 1000);
  }
  return STATE.elapsedSeconds;
}
window.elapsedNow = elapsedNow;
window.wsSend = wsSend;
// Expose for sibling modules (mobile.js shell). Assigning function declarations directly —
// wrapping them caused infinite recursion because the wrapper body's bare-name lookup of
// `setTab` resolves through the global object, which had just been overwritten by the wrapper.
function startTicker() {
  if (TICKER) return;
  TICKER = setInterval(tickFrame, 250);
}
function tickFrame() {
  // Wall clock
  $('#clock').textContent = fmtHMS(
    new Date().getHours()*3600 + new Date().getMinutes()*60 + new Date().getSeconds()
  );
  // Elapsed
  const elapsed = elapsedNow();
  const elapsedEls = [$('#elapsed-rail'), $('#elapsed-det')];
  for (const el of elapsedEls) if (el) el.textContent = fmtHMS(elapsed);
  // Rail "of estimate" subtitle (live counter)
  const railSub = $('#rail-sub');
  const cur = getCurrentRun();
  if (railSub && cur) {
    const est = parseDuration(cur.estimate);
    const over = elapsed - est;
    railSub.innerHTML = over > 0
      ? `of ${fmtHMS(est)} — <span style="color:var(--hot)">overrun ${fmtDelta(over)}</span>`
      : `of ${fmtHMS(est)} — <span style="color:var(--accent)">${fmtDelta(over)} of estimate</span>`;
  }
  // Detail panel "over by" / "should be" stats (live counters when current run is selected)
  const isNowSelected = (STATE.selectedRunIndex === STATE.actualRunIndex);
  if (isNowSelected && cur) {
    const est = parseDuration(cur.estimate);
    const over = elapsed - est;
    const overEl = $('#det-stats .s:nth-child(2) .v');
    if (overEl) overEl.textContent = fmtDelta(over);
    const shouldBeEl = $('#det-stats .s:nth-child(3) .v');
    if (shouldBeEl) shouldBeEl.textContent = over > 0 ? 'Done' : fmtHMS(est - elapsed);
    const projEl = $('#det-stats .s:nth-child(4) .v');
    if (projEl) projEl.textContent = fmtTime(new Date(Date.now() + Math.max(0, est - elapsed) * 1000));
  }
  // Delta (recompute, drives delta + headstrip)
  renderHeadstripLive();
  // Playhead position
  positionActualPlayhead();
}

// ============================================================ DERIVED
function getCurrentRun() {
  if (STATE.actualRunIndex < 0) return null;
  return STATE.schedule[STATE.actualRunIndex] || null;
}
function getSelectedRun() {
  const idx = STATE.selectedRunIndex >= 0 ? STATE.selectedRunIndex : STATE.actualRunIndex;
  return STATE.schedule[idx] || null;
}

function getNextRunIndex(fromIndex) {
  let n = fromIndex + 1;
  while (n < STATE.schedule.length && (STATE.schedule[n].setupBlock || STATE.skippedRuns.has(n))) n++;
  return n < STATE.schedule.length ? n : -1;
}

function getDeltaSeconds() {
  // Negative = behind, positive = ahead.
  const cur = getCurrentRun();
  if (!cur || !cur.scheduledStart) return 0;
  const now = Date.now();
  const elapsed = elapsedNow();
  const schedStart = new Date(cur.scheduledStart).getTime();
  const actualStart = now - elapsed * 1000;
  // Baseline: how late/early did the current run start?
  let delta = Math.round((schedStart - actualStart) / 1000);
  // If we're past when the next run was scheduled to start, that's additional behind-ness
  // (setup time is baked into the next scheduledStart, so small overruns within the buffer don't count).
  const nextRun = STATE.schedule[STATE.actualRunIndex + 1];
  if (nextRun && nextRun.scheduledStart) {
    const nextStart = new Date(nextRun.scheduledStart).getTime();
    if (now > nextStart) {
      const overrunDelta = Math.round((nextStart - now) / 1000);
      if (overrunDelta < delta) delta = overrunDelta;
    }
  }
  return delta;
}

function getMarathonStart() {
  return STATE.schedule.length ? new Date(STATE.schedule[0].scheduledStart) : null;
}
function getMarathonEnd() {
  if (!STATE.schedule.length) return null;
  const last = STATE.schedule[STATE.schedule.length - 1];
  return new Date(new Date(last.scheduledStart).getTime() + parseDuration(last.estimate) * 1000);
}

function getStats() {
  const runs = STATE.schedule.filter(r => !r.setupBlock);
  const setups = STATE.schedule.filter(r => r.setupBlock);
  const totalEstimate = runs.reduce((s, r) => s + parseDuration(r.estimate), 0);
  const totalSetup = STATE.schedule.reduce((s, r) => s + parseDuration(r.setupTime), 0);
  const allRunners = new Set();
  const readyRunners = new Set();
  runs.forEach((r, i) => {
    (r.runners || []).forEach(n => {
      if (n && n !== 'Unknown') {
        allRunners.add(n);
        if (STATE.runnerStatus[i] === 'ready') readyRunners.add(n);
      }
    });
  });
  const runnersHere = readyRunners.size;
  const completed = STATE.actualRunIndex >= 0
    ? STATE.schedule.slice(0, STATE.actualRunIndex).filter(r => !r.setupBlock).length
    : 0;
  return {
    runs: runs.length, setups: setups.length,
    totalEstimate, totalSetup,
    allRunners: allRunners.size,
    runnersHere,
    completed,
  };
}

// ============================================================ RENDER
function renderAll() {
  if (!STATE.schedule.length) {
    $('#tab-content').innerHTML = `<div class="empty-state"><h2>Schedule is empty</h2><p>The schedule loaded with zero runs. Check the source URL or try refreshing.</p></div>`;
    return;
  }
  renderTopChrome();
  renderHeadstripLive();
  renderTimeline();
  renderDetail();
  renderRail();
  renderUpNext();
  renderMinilog();
  renderTab();
  renderPaletteList();
}

function renderTopChrome() {
  $('#marathon-name').textContent = STATE.marathonInfo?.name || `${STATE.marathonId} / ${STATE.scheduleSlug}`;
}

function renderHeadstripLive() {
  const cur = getCurrentRun();
  const stats = getStats();
  const start = getMarathonStart();
  const end = getMarathonEnd();

  // ----- pre-marathon countdown
  const preMarathon = start && Date.now() < start.getTime() && STATE.actualRunIndex < 0;
  document.body.classList.toggle('pre-marathon', preMarathon);

  $('#m-runs').innerHTML = `${String(stats.completed).padStart(2,'0')} <small>/ ${stats.runs}</small>`;
  $('#m-runners').innerHTML = `${stats.runnersHere} <small style="color:var(--dim)">/ ${stats.allRunners}</small>`;
  $('#m-est').textContent = fmtHM(stats.totalEstimate);
  if (start) {
    const elapsedH = Math.max(0, Math.floor((Date.now() - start) / 3600000));
    const totalH = Math.max(1, Math.round((end - start) / 3600000));
    $('#m-hour').innerHTML = preMarathon
      ? `— <small>/ ${totalH}</small>`
      : `${String(elapsedH).padStart(2,'0')} <small>/ ${totalH}</small>`;
  }
  $('#m-end').textContent = end ? fmtTime(end) : '—';

  if (preMarathon) {
    const center = $('#h-center');
    const ph = $('#phActual');
    center.classList.remove('state-accent', 'state-warn');
    ph.classList.remove('state-accent', 'state-warn');
    const remain = Math.max(0, Math.floor((start.getTime() - Date.now()) / 1000));
    $('#state-label').textContent = 'Starts in';
    $('#delta').textContent = fmtHMS(remain);
    $('#delta').classList.toggle('small', remain >= 36000); // 10h+
    $('#sched-start').textContent = fmtTime(start);
    $('#actual-start').textContent = '—';
    $('#drift-label').textContent = 'pre-marathon';
    $('#over-est').textContent = '—';
    $('#proj-end').textContent = '—';
    return;
  }
  $('#delta').classList.remove('small');

  const delta = getDeltaSeconds();
  const center = $('#h-center');
  const ph = $('#phActual');
  center.classList.remove('state-accent', 'state-warn');
  ph.classList.remove('state-accent', 'state-warn');
  $('#deltagap').classList.remove('state-accent', 'state-warn');
  let stateLabel = 'Running behind', stateColor = '';
  if (!cur) {
    stateLabel = STATE.schedule.length && new Date() < new Date(STATE.schedule[0].scheduledStart) ? 'Pre-marathon' : 'No run selected';
    stateColor = 'state-warn';
  } else if (Math.abs(delta) <= 60) {
    stateLabel = 'On schedule'; stateColor = 'state-accent';
  } else if (delta > 0) {
    stateLabel = 'Running ahead'; stateColor = 'state-accent';
  } else {
    stateLabel = 'Running behind'; stateColor = '';
  }
  if (stateColor === 'state-accent') {
    center.classList.add('state-accent');
    ph.classList.add('state-accent');
    $('#deltagap').classList.add('state-accent');
  } else if (stateColor === 'state-warn') {
    center.classList.add('state-warn');
    ph.classList.add('state-warn');
    $('#deltagap').classList.add('state-warn');
  }
  $('#state-label').textContent = stateLabel;
  $('#delta').textContent = fmtDelta(delta);

  if (cur) {
    const schedStart = new Date(cur.scheduledStart);
    const actualStart = new Date(Date.now() - elapsedNow() * 1000);
    $('#sched-start').textContent = fmtTime(schedStart);
    $('#actual-start').textContent = fmtTime(actualStart);
    $('#drift-label').textContent = `drift ${fmtDelta(delta).replace(/^[+−]/, '')}`;
  } else {
    $('#sched-start').textContent = start ? fmtTime(start) : '—';
    $('#actual-start').textContent = '—';
    $('#drift-label').textContent = '—';
  }

  // h-right
  if (cur) {
    const est = parseDuration(cur.estimate);
    const elapsed = elapsedNow();
    const over = elapsed - est;
    $('#over-est').textContent = fmtDelta(over);
    $('#over-label').textContent = over > 0 ? 'Over est. by' : 'Under est. by';
    const projEnd = new Date(Date.now() + Math.max(0, est - elapsed) * 1000);
    $('#proj-end').textContent = fmtTime(projEnd);
  } else {
    $('#over-est').textContent = '—';
    $('#proj-end').textContent = '—';
  }
}

function renderTimeline() {
  const cur = getCurrentRun();
  const start = getMarathonStart();
  if (!start) return;

  // Window: centered around now, span = STATE.zoom hours
  const windowMs = STATE.zoom * 3600 * 1000;
  const nowMs = Date.now();
  // Anchor window at marathon start if we haven't progressed enough; otherwise center on now
  let windowStart = Math.min(start.getTime(), nowMs - windowMs * 0.2);
  let windowEnd = windowStart + windowMs;
  if (cur && nowMs > windowStart + windowMs * 0.4) {
    windowStart = nowMs - windowMs * 0.2;
    windowEnd = windowStart + windowMs;
  }

  // Hour lines
  const hourlines = $('#hourlines');
  hourlines.innerHTML = '';
  const firstHour = Math.ceil(windowStart / 3600000) * 3600000;
  for (let t = firstHour; t <= windowEnd; t += 3600000) {
    const pct = ((t - windowStart) / (windowEnd - windowStart)) * 100;
    if (pct < 0 || pct > 100) continue;
    const ln = document.createElement('div'); ln.className = 'hl'; ln.style.left = pct + '%';
    hourlines.appendChild(ln);
    const lbl = document.createElement('div'); lbl.className = 'hl-label'; lbl.style.left = pct + '%';
    lbl.textContent = fmtTime(new Date(t));
    hourlines.appendChild(lbl);
  }

  // Blocks: render each run as a run-block + a setup-block immediately after.
  const blocks = $('#blocks');
  blocks.innerHTML = '';
  const isNowRunning = STATE.actualRunIndex;
  const drawSpan = (leftMs, rightMs, render) => {
    if (rightMs < windowStart || leftMs > windowEnd) return;
    const leftPct = ((Math.max(leftMs, windowStart) - windowStart) / windowMs) * 100;
    const widthPct = ((Math.min(rightMs, windowEnd) - Math.max(leftMs, windowStart)) / windowMs) * 100;
    if (widthPct <= 0) return;
    const el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.left = leftPct + '%';
    el.style.width = widthPct + '%';
    el.style.height = '100%';
    render(el);
    blocks.appendChild(el);
  };
  for (let i = 0; i < STATE.schedule.length; i++) {
    const r = STATE.schedule[i];
    if (!r.scheduledStart) continue;
    const startMs = new Date(r.scheduledStart).getTime();
    const estSec = parseDuration(r.estimate);
    const setupSec = parseDuration(r.setupTime || 'PT0S');
    const runEndMs = startMs + estSec * 1000;
    const setupEndMs = runEndMs + setupSec * 1000;
    const isNow = i === STATE.actualRunIndex;

    // The run block
    drawSpan(startMs, runEndMs, el => {
      let klass = 'blk';
      if (r.setupBlock) klass += ' setup';
      else if (isNow) klass += ' now';
      else if (i < STATE.actualRunIndex) klass += ' done';
      else {
        klass += ' up';
        if (STATE.runnerStatus[i] === 'missing') klass += ' late';
      }
      if (r.customRun) klass += ' custom';
      if (i === STATE.selectedRunIndex) klass += ' selected';
      el.className = klass;
      el.dataset.idx = i;
      const label = r.setupBlock ? (r.setupBlockText || 'setup') : (r.game || '—');
      const meta = fmtHM(estSec);
      const typeBadge = r.type && r.type !== 'SINGLE'
        ? `<span class="typebadge ${r.type.toLowerCase()}">${r.type[0]}</span>` : '';
      el.innerHTML = `${typeBadge}<div class="name">${escapeHtml(label)}</div><div class="meta">${meta}${isNow ? ' · LIVE' : ''}</div>${isNow ? '<div class="progress"></div>' : ''}`;
      el.addEventListener('click', () => selectRun(i));
    });

    // The trailing setup block (if any)
    if (setupSec > 0 && !r.setupBlock) {
      drawSpan(runEndMs, setupEndMs, el => {
        el.className = 'blk setup';
        el.dataset.idx = i;
        el.title = `Setup · +${fmtHM(setupSec)}`;
        el.innerHTML = `<div class="name">setup</div><div class="meta">+${fmtHM(setupSec)}</div>`;
        el.addEventListener('click', () => selectRun(i));
      });
    }
  }

  // Reset blocks container to absolute positioning (override flex from prototype)
  blocks.style.display = 'block';
  blocks.style.gap = '0';

  // Playheads
  const cur2 = getCurrentRun();
  if (cur2) {
    const schedNowMs = new Date(cur2.scheduledStart).getTime() + Math.min(parseDuration(cur2.estimate), elapsedNow()) * 1000;
    // Scheduled position: where the schedule expected us to be by now
    // We compute it as: where the playhead would be if we'd been on time
    const expectedNowMs = Date.now() + getDeltaSeconds() * 1000;
    const schedPct = clamp01((expectedNowMs - windowStart) / windowMs) * 100;
    const actualPct = clamp01((Date.now() - windowStart) / windowMs) * 100;
    const phSched = $('#phSched');
    const phActual = $('#phActual');
    phSched.style.left = schedPct + '%';
    phSched.querySelector('.cap').textContent = `scheduled · ${fmtTime(new Date(expectedNowMs))}`;
    phActual.style.left = actualPct + '%';
    phActual.querySelector('.cap').textContent = `▼ now · ${fmtTime(new Date())}`;
    phSched.style.display = phActual.style.display = '';

    const gap = $('#deltagap');
    const lo = Math.min(schedPct, actualPct);
    const hi = Math.max(schedPct, actualPct);
    if (Math.abs(hi - lo) < 0.4) {
      gap.classList.add('hidden');
    } else {
      gap.classList.remove('hidden');
      gap.style.left = lo + '%';
      gap.style.width = (hi - lo) + '%';
      const delta = getDeltaSeconds();
      gap.querySelector('.label').textContent = `${fmtDelta(delta)} ${delta < 0 ? 'behind' : 'ahead'}`;
    }
  } else {
    $('#phSched').style.display = 'none';
    $('#phActual').style.display = 'none';
    $('#deltagap').classList.add('hidden');
  }

  // Save window for the actual-playhead live ticker
  STATE._tlWindow = { start: windowStart, end: windowEnd };
}
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function positionActualPlayhead() {
  if (!STATE._tlWindow) return;
  const { start, end } = STATE._tlWindow;
  const actualPct = clamp01((Date.now() - start) / (end - start)) * 100;
  const phActual = $('#phActual');
  if (phActual.style.display === 'none') return;
  phActual.style.left = actualPct + '%';
  phActual.querySelector('.cap').textContent = `▼ now · ${fmtTime(new Date())}`;
}

function renderDetail() {
  const run = getSelectedRun();
  if (!run) {
    $('#det-title').textContent = '—';
    $('#det-cat').textContent = 'No run selected — click a block in the timeline above';
    $('#det-runners').innerHTML = '';
    $('#det-stats').innerHTML = '';
    hide($('#det-ocr'));
    return;
  }
  const isNow = (STATE.selectedRunIndex === STATE.actualRunIndex);

  $('#det-eyebrow').className = 'eyebrow' + (isNow ? ' live' : '');
  $('#det-eyebrow').style.color = isNow ? '' : 'var(--signal)';
  $('#det-eyebrow-text').textContent = isNow ? 'Now playing' : `Upcoming · #${STATE.selectedRunIndex + 1}`;

  $('#det-title').textContent = run.game || run.setupBlockText || 'Setup';
  const schedTime = run.scheduledStart ? fmtTime(new Date(run.scheduledStart)) : '—';
  $('#det-cat').textContent = `${run.category || '—'} · ${run.console || '—'} · sched. ${schedTime} · est. ${fmtHM(parseDuration(run.estimate))}`;

  const runners = run.runners || [];
  const runStatus = STATE.runnerStatus[STATE.selectedRunIndex] || 'unchecked';
  const statusList = [
    { v: 'unchecked', label: 'Unchecked', cls: 'deck' },
    { v: 'ready',     label: 'Ready',     cls: 'here' },
    { v: 'missing',   label: 'Missing',   cls: 'away' },
  ];
  const runnerRows = runners.map((nm, i) => `
    <div class="runner">
      <div class="avatar a${(i % 5) + 1}">${escapeHtml((nm[0]||'?').toUpperCase())}</div>
      <div class="nm">${escapeHtml(nm)}<small>${i === 0 ? 'runner' : 'co-runner'}</small></div>
    </div>`).join('') || '<div style="color:var(--dim);font-size:13px;font-style:italic">no runners listed</div>';
  const statusBtns = statusList.map(s => `
    <button class="runner-status-btn ${s.cls}${runStatus === s.v ? ' active' : ''}" data-status="${s.v}">${s.label}</button>
  `).join('');
  $('#det-runners').innerHTML = `
    ${runnerRows}
    ${runners.length ? `
      <div class="runner-status-row">
        <span class="runner-status-label">Check-in</span>
        ${statusBtns}
      </div>
    ` : ''}
  `;

  $$('.runner-status-btn', $('#det-runners')).forEach(el => {
    el.addEventListener('click', () => {
      const target = el.dataset.status;
      const current = STATE.runnerStatus[STATE.selectedRunIndex] || 'unchecked';
      if (current === target) return;
      // server cycles unchecked → ready → missing → unchecked; click as many times as needed
      const order = ['unchecked', 'ready', 'missing'];
      let steps = (order.indexOf(target) - order.indexOf(current) + 3) % 3;
      for (let k = 0; k < steps; k++) wsSend('runner:cycle', { index: STATE.selectedRunIndex });
    });
  });

  // Stats
  if (isNow) {
    const elapsed = elapsedNow();
    const est = parseDuration(run.estimate);
    const over = elapsed - est;
    $('#det-stats').innerHTML = `
      <div class="s"><div class="k">Elapsed</div><div class="v num" id="elapsed-det">${fmtHMS(elapsed)}</div></div>
      <div class="s ${over > 0 ? 'hot' : 'accent'}"><div class="k">${over > 0 ? 'Over est. by' : 'Under by'}</div><div class="v num">${fmtDelta(over)}</div></div>
      <div class="s dim"><div class="k">Should be</div><div class="v">${over > 0 ? 'Done' : fmtHMS(est - elapsed)}</div></div>
      <div class="s warn"><div class="k">Proj. end</div><div class="v">${fmtTime(new Date(Date.now() + Math.max(0, est - elapsed) * 1000))}</div></div>
    `;
    show($('#det-ocr'));
  } else {
    const est = parseDuration(run.estimate);
    $('#det-stats').innerHTML = `
      <div class="s"><div class="k">Estimate</div><div class="v">${fmtHM(est)}</div></div>
      <div class="s dim"><div class="k">Scheduled</div><div class="v">${schedTime}</div></div>
      <div class="s"><div class="k">Setup</div><div class="v">+${Math.round(parseDuration(run.setupTime)/60)}m</div></div>
      <div class="s dim"><div class="k">Status</div><div class="v" style="font-size:14px;font-weight:600;font-family:'Inter Tight',sans-serif">${run.setupBlock ? 'Setup block' : 'Upcoming'}</div></div>
    `;
    hide($('#det-ocr'));
  }
}

function renderRail() {
  const elapsed = elapsedNow();
  const cur = getCurrentRun();
  $('#elapsed-rail').textContent = fmtHMS(elapsed);
  if (cur) {
    const est = parseDuration(cur.estimate);
    const over = elapsed - est;
    const overTxt = over > 0
      ? `<span style="color:var(--hot)">overrun ${fmtDelta(over)}</span>`
      : `<span style="color:var(--accent)">${fmtDelta(over)} of estimate</span>`;
    $('#rail-sub').innerHTML = `of ${fmtHMS(est)} — ${overTxt}`;
  } else {
    $('#rail-sub').textContent = STATE.actualRunIndex < 0 ? 'no run selected' : '—';
  }
  const btn = $('#primaryBtn');
  btn.innerHTML = STATE.timerRunning
    ? '■ Stop <span class="kbd">␣</span>'
    : '▶ Start <span class="kbd">␣</span>';
  btn.classList.toggle('primary', STATE.timerRunning);
  btn.classList.toggle('go', !STATE.timerRunning);
}

function renderUpNext() {
  const list = $('#upnext-list');
  list.innerHTML = '';
  // Next 4 non-setup runs after actualRunIndex
  const start = Math.max(0, STATE.actualRunIndex) + (STATE.actualRunIndex < 0 ? 0 : 1);
  const deltaSec = getDeltaSeconds();
  let count = 0;
  for (let i = start; i < STATE.schedule.length && count < 4; i++) {
    const r = STATE.schedule[i];
    if (r.setupBlock || STATE.skippedRuns.has(i)) continue;
    count++;
    const schedDate = r.scheduledStart ? new Date(r.scheduledStart) : null;
    const sched = schedDate ? fmtTime(schedDate) : '—';
    // Predicted = scheduled - delta. If running behind (delta < 0), predicted is later.
    const predDate = schedDate ? new Date(schedDate.getTime() - deltaSec * 1000) : null;
    const driftMs = schedDate && predDate ? predDate.getTime() - schedDate.getTime() : 0;
    const showPred = predDate && Math.abs(driftMs) > 60000;
    const predCls = driftMs > 0 ? 'behind' : 'ahead';
    const runners = (r.runners || []).join(', ');
    const missing = STATE.runnerStatus[i] === 'missing';
    const ready = STATE.runnerStatus[i] === 'ready';
    const row = document.createElement('div');
    row.className = 'deck-row' + (i === start ? ' queued' : '') + (i === STATE.selectedRunIndex ? ' selected' : '');
    row.dataset.idx = i;
    row.innerHTML = `
      <div class="when-col">
        <div class="when ${showPred ? predCls : ''}">${predDate ? fmtTime(predDate) : sched}</div>
        ${showPred ? `<div class="pred dim">sched ${sched}</div>` : `<div class="pred dim">on schedule</div>`}
      </div>
      <div>
        <div class="nm">${escapeHtml(r.game)}<small>${escapeHtml(runners)} · ${escapeHtml(r.console || '—')}${r.category ? ' · ' + escapeHtml(r.category) : ''}</small></div>
        ${missing ? '<div style="margin-top:5px"><span class="chip late">runner missing</span></div>' : ready && runners ? '<div style="margin-top:5px"><span class="chip here">ready</span></div>' : ''}
      </div>
      <div class="est">${fmtHM(parseDuration(r.estimate))}</div>
    `;
    row.addEventListener('click', () => selectRun(i));
    list.appendChild(row);
  }
  // Count remaining
  let remain = 0;
  for (let i = start; i < STATE.schedule.length; i++) if (!STATE.schedule[i].setupBlock) remain++;
  $('#upnext-count').textContent = `${count} of ${remain}`;
}

function renderMinilog() {
  const list = $('#minilog-list');
  const items = STATE.eventLog.slice(0, 6);
  list.innerHTML = items.map(e => `
    <div class="log-row">
      <span class="t">${escapeHtml(e.timestamp ? fmtTime(new Date(e.timestamp)) : '')}</span>
      <div class="l">${escapeHtml(e.text || '')}<small>${escapeHtml(e.runName || e.type || '')}</small></div>
    </div>
  `).join('') || `<div style="color:var(--dim);font-size:12.5px;padding:8px 0">No events yet.</div>`;
}

function renderTab() {
  const stats = getStats();
  const ctx = {
    schedule: STATE.schedule,
    actualRunIndex: STATE.actualRunIndex,
    selectedRunIndex: STATE.selectedRunIndex,
    runnerStatus: STATE.runnerStatus,
    skippedRuns: STATE.skippedRuns,
    filter: STATE.filter,
    filterTag: STATE.filterTag,
    twitchChannel: STATE.twitchChannel,
    messageText: STATE.messageText,
    messageColor: STATE.messageColor,
    eventLog: STATE.eventLog,
    marathonInfo: STATE.marathonInfo,
    actualTimes: STATE.actualTimes,
    runEdits: STATE.runEdits,
    deltaSec: getDeltaSeconds(),
    elapsedSec: elapsedNow(),
    captureResult: STATE.captureResult,
    captureError: STATE.captureError,
    captureStatus: STATE.captureStatus,
    stats,
    helpers: { parseDuration, fmtHMS, fmtHM, fmtTime, escapeHtml },
  };
  const fn = window.TABS && window.TABS[STATE.tab];
  $('#tab-content').innerHTML = fn ? fn(ctx) : `<div class="empty-state"><p>Tab not implemented yet.</p></div>`;
  $$('#tab-bar button[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === STATE.tab));
  $('#ct-schedule').textContent = stats.runs;
  $('#ct-log').textContent = STATE.eventLog.length;
  wireTabEvents();
}

function wireTabEvents() {
  const fi = $('#filter-input');
  if (fi) {
    fi.addEventListener('input', e => {
      STATE.filter = e.target.value;
      const rows = $('#schedule-rows');
      if (rows) rows.innerHTML = window.TABS.scheduleRows({
        schedule: STATE.schedule, actualRunIndex: STATE.actualRunIndex, selectedRunIndex: STATE.selectedRunIndex,
        runnerStatus: STATE.runnerStatus, skippedRuns: STATE.skippedRuns,
        filter: STATE.filter, filterTag: STATE.filterTag,
        helpers: { parseDuration, fmtHM, fmtTime, escapeHtml },
      });
      wireScheduleRows();
    });
  }
  $$('.chip-filter[data-tag]').forEach(el => {
    el.addEventListener('click', () => {
      STATE.filterTag = el.dataset.tag;
      renderTab();
    });
  });
  wireScheduleRows();

  // message editor
  const msgInput = $('#msg-text');
  if (msgInput) {
    msgInput.addEventListener('input', () => {
      $('#msg-preview-text') && ($('#msg-preview-text').textContent = msgInput.value || ' ');
    });
    $$('.msg-colors .sw').forEach(sw => {
      sw.addEventListener('click', () => {
        $$('.msg-colors .sw').forEach(s => s.classList.remove('selected'));
        sw.classList.add('selected');
        if ($('#msg-preview-text')) $('#msg-preview-text').style.color = sw.dataset.c;
      });
    });
    $$('.msg-preset').forEach(p => p.addEventListener('click', () => {
      const t = p.textContent.trim();
      if (t.startsWith('+')) return;
      msgInput.value = t;
      if ($('#msg-preview-text')) $('#msg-preview-text').textContent = t;
    }));
    $('#msg-send')?.addEventListener('click', () => {
      const color = $('.msg-colors .sw.selected')?.dataset.c || '';
      wsSend('message:set', { text: msgInput.value, color });
    });
    $('#msg-clear')?.addEventListener('click', () => wsSend('message:clear'));
  }

  // capture: wire all triggers (multiple #cap-go buttons + detail-panel re-capture)
  $$('#cap-go, #btn-recapture').forEach(btn => btn.addEventListener('click', runCapture));
  $('#cap-channel')?.addEventListener('change', e => {
    const v = e.target.value.trim();
    if (v && v !== STATE.twitchChannel) wsSend('twitch:set', { channel: v });
  });

  // log composer
  $('#log-add')?.addEventListener('click', () => {
    const txt = $('#log-input')?.value?.trim();
    if (!txt) return;
    const tag = $('.log-composer .tag-pick button.selected')?.dataset.tag || 'note';
    wsSend('log:add', { text: txt, type: tag });
    $('#log-input').value = '';
  });
  $('#log-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#log-add')?.click();
  });
  $$('.log-composer .tag-pick button').forEach(b => b.addEventListener('click', () => {
    $$('.log-composer .tag-pick button').forEach(x => x.classList.remove('selected'));
    b.classList.add('selected');
  }));
  // kiosk presets
  $$('.kiosk-preset[data-preset]').forEach(el => {
    el.addEventListener('click', () => {
      const preset = el.dataset.preset;
      const PRESETS = {
        host:    { layout: '1+2', panels: ['delta', 'running', 'ondeck'] },
        tech:    { layout: '2x2', panels: ['controls', 'running', 'log', 'ondeck'] },
        sched:   { layout: '1x1', panels: ['schedule'] },
        green:   { layout: '2+1', panels: ['ondeck', 'running', 'schedule'] },
        message: { layout: '1x1', panels: ['message'] },
      };
      const cfg = PRESETS[preset];
      if (!cfg) return;
      try { localStorage.setItem('sched-kiosk-config', JSON.stringify(cfg)); } catch {}
      // Open in new window
      window.open(location.pathname + '?kiosk=1' + location.hash, '_blank', 'width=1280,height=800');
    });
  });
}

function wireScheduleRows() {
  $$('#schedule-rows tr[data-idx]').forEach(tr => {
    tr.addEventListener('click', e => {
      if (e.target.closest('.row-edit-btn')) return; // edit click handled separately
      selectRun(parseInt(tr.dataset.idx, 10));
    });
  });
  $$('#schedule-rows .row-edit-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx, 10);
      if (window.RunEdit) window.RunEdit.open(idx);
    });
  });
}

// ============================================================ ACTIONS
function selectRun(idx) {
  STATE.selectedRunIndex = idx;
  renderTimeline();
  renderDetail();
  renderUpNext();
  if (STATE.tab === 'schedule') {
    // surgical: just toggle classes
    $$('#schedule-rows tr').forEach(tr => tr.classList.toggle('selected', parseInt(tr.dataset.idx, 10) === idx));
  }
}

function toggleTimer() {
  if (STATE.actualRunIndex < 0) {
    // auto-select first non-setup run if user hasn't yet
    const firstRun = STATE.schedule.findIndex(r => !r.setupBlock);
    if (firstRun >= 0) wsSend('run:select', { index: firstRun });
  }
  if (STATE.timerRunning) wsSend('timer:stop');
  else wsSend('timer:start', { seconds: STATE.elapsedSeconds });
}
function advance() { wsSend('run:advance'); }
function reset() { wsSend('timer:reset'); }
function skip() { wsSend('run:skip'); }

function setElapsed() {
  if (STATE.actualRunIndex < 0) {
    const firstRun = STATE.schedule.findIndex(r => !r.setupBlock);
    if (firstRun >= 0) wsSend('run:select', { index: firstRun });
  }
  const cur = fmtHMS(elapsedNow());
  const input = prompt('Set elapsed (HH:MM:SS or MM:SS)', cur);
  if (input == null) return;
  const parts = input.trim().split(':').map(s => parseInt(s, 10));
  if (parts.some(isNaN) || parts.length < 1 || parts.length > 3) {
    alert('Invalid format. Use HH:MM:SS, MM:SS, or just SS.');
    return;
  }
  let seconds;
  if (parts.length === 3) seconds = parts[0]*3600 + parts[1]*60 + parts[2];
  else if (parts.length === 2) seconds = parts[0]*60 + parts[1];
  else seconds = parts[0];
  if (seconds < 0) return;
  const wasRunning = STATE.timerRunning;
  // timer:start sets epoch + elapsedSeconds AND marks running. If user wasn't running, stop it back.
  wsSend('timer:start', { seconds });
  if (!wasRunning) setTimeout(() => wsSend('timer:stop'), 80);
}

// ============================================================ PALETTE
function renderPaletteList(filter = '') {
  const list = $('#palette-list');
  if (!list) return;
  const items = [
    { ico: '▶', t: STATE.timerRunning ? 'Stop timer' : 'Start timer', s: 'Toggle the current run timer', act: toggleTimer, kbd: '␣' },
    { ico: '↦', t: 'Advance to next run', s: 'Mark current done, start next', act: advance, kbd: 'N' },
    { ico: '↺', t: 'Reset elapsed', s: 'Set elapsed back to 00:00:00', act: reset },
    { ico: '⌖', t: 'Set elapsed time…', s: 'Manually set the current elapsed (HH:MM:SS) — for catching up after a late start', act: setElapsed },
    { ico: '⏭', t: 'Skip current run', s: 'Mark skipped and advance', act: skip },
    { ico: '✎', t: 'Edit timing on current run', s: 'Open actual start/end/duration editor', act: () => { const i = STATE.selectedRunIndex >= 0 ? STATE.selectedRunIndex : STATE.actualRunIndex; if (i >= 0 && window.RunEdit) window.RunEdit.open(i); } },
    { ico: '📷', t: 'Open stream capture', s: 'OCR-verify timer against stream', act: () => setTab('capture') },
    { ico: '📋', t: 'Open message panel', s: 'Set kiosk overlay message', act: () => setTab('message') },
    { ico: '⊞', t: 'Open kiosk config', s: 'Multi-panel role view', act: () => setTab('kiosk') },
    { ico: '⏏', t: 'Change schedule', s: 'Disconnect and load another marathon', act: showLanding },
  ];
  // Add jump-to-run items
  STATE.schedule.forEach((r, i) => {
    if (r.setupBlock) return;
    items.push({
      ico: '▦',
      t: r.game,
      s: `Jump to run #${i + 1} — ${(r.runners||[]).join(', ')} · ${r.console || '—'}`,
      act: () => { selectRun(i); closePalette(); },
    });
  });
  const f = filter.trim().toLowerCase();
  const filtered = f
    ? items.filter(it => (it.t + ' ' + it.s).toLowerCase().includes(f))
    : items;
  list.innerHTML = filtered.slice(0, 12).map((it, i) => `
    <li class="${i === 0 ? 'sel' : ''}" data-idx="${i}">
      <div class="ico">${it.ico}</div>
      <div class="lbl"><div class="t">${escapeHtml(it.t)}</div><div class="s">${escapeHtml(it.s)}</div></div>
      ${it.kbd ? `<span class="kbd">${it.kbd}</span>` : ''}
    </li>
  `).join('');
  // wire
  $$('#palette-list li').forEach(li => {
    li.addEventListener('click', () => {
      const idx = parseInt(li.dataset.idx, 10);
      const it = filtered[idx];
      if (it && it.act) { it.act(); closePalette(); }
    });
  });
  STATE._paletteItems = filtered;
}

function openPalette() {
  STATE.paletteOpen = true;
  $('#palette').classList.add('on');
  renderPaletteList('');
  setTimeout(() => { const i = $('#palette-input'); if (i) { i.value = ''; i.focus(); } }, 50);
}
function closePalette() { STATE.paletteOpen = false; $('#palette').classList.remove('on'); }

function hudsModeOn() {
  if (document.body.classList.contains('huds-mode')) return;
  document.body.classList.add('huds-mode');
  let toast = document.getElementById('hudsToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'hudsToast';
    toast.className = 'huds-toast';
    toast.innerHTML = `🏳️‍🌈 <span>HUDS MODE UNLOCKED</span> 🏳️‍🌈 · <a href="https://huds601.co.uk" target="_blank" rel="noopener">huds601.co.uk</a> · <small style="opacity:.85;font-weight:600">esc to exit</small>`;
    document.body.appendChild(toast);
  }
  hudsConfetti(140);
  // periodic top-ups so it keeps raining
  if (!window._hudsConfettiTimer) {
    window._hudsConfettiTimer = setInterval(() => hudsConfetti(20), 1500);
  }
}
function hudsModeOff() {
  document.body.classList.remove('huds-mode');
  document.getElementById('hudsToast')?.remove();
  if (window._hudsConfettiTimer) { clearInterval(window._hudsConfettiTimer); window._hudsConfettiTimer = null; }
  document.querySelectorAll('.huds-confetti').forEach(el => el.remove());
}
function hudsConfetti(n) {
  const colors = ['#e40303','#ff8c00','#ffed00','#008026','#004dff','#750787','#ff69b4','#00d4ff','#ffffff'];
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.className = 'huds-confetti';
    el.style.left = Math.random() * 100 + 'vw';
    el.style.background = colors[Math.floor(Math.random() * colors.length)];
    el.style.animationDuration = (2.5 + Math.random() * 3.5) + 's';
    el.style.animationDelay = (Math.random() * 0.6) + 's';
    el.style.transform = `rotate(${Math.random() * 360}deg)`;
    el.style.width = (6 + Math.random() * 8) + 'px';
    el.style.height = (10 + Math.random() * 10) + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 7000);
  }
}

// ============================================================ NAVIGATION
function setTab(name) { STATE.tab = name; renderTab(); }

function showLanding() {
  if (STATE.ws) try { STATE.ws.close(); } catch {}
  STATE.ws = null;
  STATE.marathonId = STATE.scheduleSlug = null;
  STATE.schedule = [];
  STATE.marathonInfo = null;
  location.hash = '';
  $('#trackerView').classList.add('hidden');
  $('#landingView').classList.remove('hidden');
  $('#urlInput').focus();
}

async function showTracker() {
  $('#landingView').classList.add('hidden');
  $('#trackerView').classList.remove('hidden');
  await loadMarathonInfo();
  await loadSchedule();
  writeHash();
  $('#marathon-name').textContent = STATE.marathonInfo?.name || `${STATE.marathonId} / ${STATE.scheduleSlug}`;
  wsConnect();
  startTicker();
  renderAll();
}

async function loadFromInput(rawUrl) {
  const parsed = parseScheduleUrl(rawUrl);
  if (!parsed) throw new Error('Could not parse that URL. Paste an Oengus or Horaro schedule URL.');
  STATE.marathonId = parsed.marathonId;
  STATE.scheduleSlug = parsed.slug;
  STATE.scheduleSource = parsed.source;
  await resolveSlugIfNeeded();
  await showTracker();
}

// ============================================================ BOOT
document.addEventListener('DOMContentLoaded', async () => {
  // Landing wiring
  $('#loadBtn').addEventListener('click', async () => {
    const err = $('#landingError'); err.textContent = '';
    try { await loadFromInput($('#urlInput').value); }
    catch (e) { err.textContent = e.message; }
  });
  $('#urlInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#loadBtn').click(); });
  $('#clearBtn').addEventListener('click', () => { $('#urlInput').value = ''; $('#urlInput').focus(); });
  $$('.landing-card .examples a').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    $('#urlInput').value = a.dataset.eg;
    $('#urlInput').focus();
  }));

  // Tracker chrome
  $('#search-trigger').addEventListener('click', openPalette);
  $('#btn-change').addEventListener('click', showLanding);
  $('#btn-popout').addEventListener('click', () => {
    window.open(location.pathname + '?kiosk=1' + location.hash, '_blank', 'width=1280,height=800');
  });
  // Theme picker (persists per-browser)
  const themePicker = $('#theme-picker');
  if (themePicker) {
    const saved = (() => { try { return localStorage.getItem('sched-theme'); } catch { return null; } })();
    if (saved) { document.body.setAttribute('data-theme', saved); themePicker.value = saved; }
    themePicker.addEventListener('change', e => {
      const v = e.target.value;
      if (v === 'green') document.body.removeAttribute('data-theme');
      else document.body.setAttribute('data-theme', v);
      try { localStorage.setItem('sched-theme', v); } catch {}
    });
  }

  // Rail buttons
  $('#primaryBtn').addEventListener('click', toggleTimer);
  $('#nextBtn').addEventListener('click', advance);
  $('#resetBtn').addEventListener('click', reset);
  $('#skipBtn').addEventListener('click', skip);
  // Rail elapsed digits: click to manually set elapsed time
  const railElapsed = $('#elapsed-rail');
  if (railElapsed) {
    railElapsed.style.cursor = 'pointer';
    railElapsed.title = 'Click to set elapsed time';
    railElapsed.addEventListener('click', setElapsed);
  }
  // Detail panel Elapsed stat: click to manually set elapsed time (mobile-friendly access since rail is hidden)
  document.addEventListener('click', e => {
    const el = e.target.closest('#elapsed-det');
    if (el) setElapsed();
  });
  $('#btn-edit-timing').addEventListener('click', () => {
    const idx = STATE.selectedRunIndex >= 0 ? STATE.selectedRunIndex : STATE.actualRunIndex;
    if (idx >= 0 && window.RunEdit) window.RunEdit.open(idx);
  });

  // Quick action shortcuts
  $$('[data-go-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.goTab)));
  $('#log-open-full').addEventListener('click', e => { e.preventDefault(); setTab('log'); });

  // Tab bar
  $$('#tab-bar button[data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

  // Zoom
  $$('#zoom button').forEach(b => b.addEventListener('click', () => {
    $$('#zoom button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    STATE.zoom = parseInt(b.dataset.zoom, 10);
    renderTimeline();
  }));

  // Palette
  $('#palette').addEventListener('click', e => { if (e.target.id === 'palette') closePalette(); });
  $('#palette-input').addEventListener('input', e => renderPaletteList(e.target.value));
  $('#palette-input').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const it = (STATE._paletteItems || [])[0];
    if (it && it.act) { it.act(); closePalette(); }
  });

  // Keyboard
  // Secret huds easter egg: type "huds" anywhere outside an input
  let hudsBuf = '';
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    if (e.key === 'Escape') {
      closePalette();
      if (document.body.classList.contains('huds-mode')) hudsModeOff();
      return;
    }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') { e.preventDefault(); toggleTimer(); }
    if (e.key.toLowerCase() === 'n') advance();
    // huds key-sequence
    const c = e.key.length === 1 ? e.key.toLowerCase() : '';
    if (c) {
      hudsBuf = (hudsBuf + c).slice(-7);
      if (hudsBuf.endsWith('huds') || hudsBuf.endsWith('huds601')) {
        hudsModeOn();
        hudsBuf = '';
      }
    }
  });

  // Auto-restore from hash
  const hashed = readHash();
  if (hashed) {
    STATE.marathonId = hashed.marathonId;
    STATE.scheduleSlug = hashed.slug;
    STATE.scheduleSource = hashed.source;
    try { await showTracker(); }
    catch (e) { console.error(e); showLanding(); }
  }
});

// Expose functions on window for sibling modules (mobile.js). Done at script-end so
// the references are the function declarations themselves, not wrappers.
window.setTab = setTab;
window.openPalette = openPalette;
window.showLanding = showLanding;
window.toggleTimer = toggleTimer;
window.advance = advance;
window.reset = reset;
window.skip = skip;
