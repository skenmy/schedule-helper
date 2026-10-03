// The NodeCG bridge (bridge.html): for when the nodecg-schedule-helper bundle
// can't be installed. A browser on the stream PC, or an OBS browser source,
// loads NodeCG's own socket.io client, reads speedcontrol's replicants and
// reports them to Schedule Helper as the bundle would.
//
//   /bridge.html?room=oengus/event/slug&nodecg=http://localhost:9090#t=TOKEN[&key=NODECG_KEY]
//
// The page is served sandboxed (http.ts): it runs a script from whatever NodeCG
// address it's given, so it gets no origin, no cookies and no storage here.
// Best effort: a browser may block an https page from reaching NodeCG over
// plain http on another machine; NodeCG on the same PC usually works; the
// bundle always does.

import {
  ackValue,
  buildReport,
  parseBridgeParams,
  type RunData,
  type Timer,
} from './lib/nodecg-report.ts';

interface Socket {
  connected: boolean;
  on(event: string, fn: (...args: unknown[]) => void): void;
  emit(event: string, payload: unknown, ack: (...args: unknown[]) => void): void;
}
type Io = (url: string, opts?: Record<string, unknown>) => Socket;

const POLL_MS = 1_000;
const HEARTBEAT_MS = 15_000;
/**
 * A report that hasn't been answered by then is given up on. Reports go one at
 * a time, so one stalled on venue Wi-Fi would otherwise hold up every report after it.
 */
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 30_000;
const NAMESPACE = 'nodecg-speedcontrol';

function show(id: string, text: string, tone: 'ok' | 'warn' | 'bad' | '' = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = tone;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`couldn’t load ${src}`));
    document.head.append(s);
  });
}

function read<T>(socket: Socket, name: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 3_000);
    socket.emit('replicant:declare', { name, namespace: NAMESPACE, opts: {} }, (...args) => {
      clearTimeout(timer);
      resolve(ackValue<T>(args));
    });
  });
}

async function main() {
  const params = parseBridgeParams(location.search, location.hash);
  if (typeof params === 'string') {
    show('room', params, 'bad');
    show('nodecg', '—');
    return;
  }
  const { room, nodecg, token, key } = params;
  const roomPath = `${room.source}/${room.event}/${room.slug}`;
  show('room', roomPath);

  try {
    await loadScript(`${nodecg}/socket.io/socket.io.js`);
  } catch {
    show(
      'nodecg',
      `Can’t reach NodeCG at ${nodecg}. Is it running, and is that its address as this PC sees it? ` +
        'A browser may also refuse to reach NodeCG on another machine over plain http: open this ' +
        'on the NodeCG PC with nodecg=http://localhost:9090, or use the NodeCG bundle instead.',
      'bad',
    );
    return;
  }
  const io = (window as unknown as { io?: Io }).io;
  if (!io) {
    show('nodecg', `${nodecg} didn’t provide a socket.io client.`, 'bad');
    return;
  }
  // NodeCG reads a login key from the `token` query, in NodeCG 1 and 2 alike.
  const socket = io(nodecg, {
    transports: ['websocket', 'polling'],
    ...(key ? { query: { token: key } } : {}),
  });
  socket.on('connect', () => show('nodecg', `Connected to ${nodecg}`, 'ok'));
  socket.on('disconnect', () => show('nodecg', `Disconnected from ${nodecg}, retrying…`, 'warn'));
  socket.on('connect_error', () =>
    show(
      'nodecg',
      `Can’t connect to ${nodecg}. If NodeCG has a login, add &key=YOUR_KEY to the end of this page’s address.`,
      'bad',
    ),
  );

  const endpoint = `/api/rooms/${roomPath}/nodecg`;
  let lastKey = '';
  let lastSent = 0;
  let busy = false;
  let retryAt = 0;
  let backoff = POLL_MS;

  async function tick() {
    // One at a time: a slow NodeCG or server mustn't pile requests up.
    if (busy || !socket.connected || Date.now() < retryAt) return;
    busy = true;
    try {
      const [run, timer] = await Promise.all([
        read<RunData>(socket, 'runDataActiveRun'),
        read<Timer>(socket, 'timer'),
      ]);
      const report = buildReport(run, timer);
      show(
        'speedcontrol',
        run
          ? `${run.game || 'Untitled run'}${run.category ? ` (${run.category})` : ''} · timer ${timer?.state ?? 'unknown'}`
          : 'No active run (is nodecg-speedcontrol installed?)',
        run ? '' : 'warn',
      );
      const changeKey = JSON.stringify([report.run, report.timer?.state]);
      if (changeKey === lastKey && Date.now() - lastSent < HEARTBEAT_MS) return;
      // AbortController rather than AbortSignal.timeout: older OBS browser sources lack it.
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
      let res: Response;
      let body: { error?: string; matched?: string | null; listening?: boolean } | null;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ t: token, ...report }),
          signal: abort.signal,
        });
        body = (await res.json().catch(() => null)) as typeof body;
      } finally {
        clearTimeout(timeout);
      }
      if (!res.ok) throw new Error(body?.error ?? `Refused (${res.status})`);
      lastKey = changeKey;
      lastSent = Date.now();
      backoff = POLL_MS;
      const time = new Date().toLocaleTimeString();
      if (body?.listening === false) {
        show(
          'report',
          `Reported at ${time}, but NodeCG is switched off in Schedule Helper`,
          'warn',
        );
      } else if (report.run && !body?.matched) {
        show('report', `Reported at ${time}; that run isn’t the live one or the next few`, 'warn');
      } else {
        show('report', `Reported at ${time}`, 'ok');
      }
    } catch (err) {
      // Back off on failures (a wrong token, the server away) instead of hammering.
      backoff = Math.min(MAX_BACKOFF_MS, backoff * 2);
      retryAt = Date.now() + backoff;
      const reason =
        (err as Error).name === 'AbortError'
          ? 'Schedule Helper didn’t answer in time'
          : err instanceof TypeError
            ? 'Can’t reach Schedule Helper'
            : (err as Error).message;
      show('report', `${reason}. Retrying in ${Math.round(backoff / 1000)} s…`, 'bad');
    } finally {
      busy = false;
    }
  }

  setInterval(() => void tick(), POLL_MS);
}

void main();
