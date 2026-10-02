// The NodeCG bridge (bridge.html): for when the nodecg-schedule-helper bundle
// can't be installed. A browser on the stream PC, or an OBS browser source,
// loads NodeCG's own socket.io client, reads speedcontrol's replicants and
// reports them to Schedule Helper exactly as the bundle would.
//
//   /bridge.html?room=oengus/event/slug&nodecg=http://localhost:9090[&key=…]#t=TOKEN
//
// Best effort: browsers can refuse a page on https from talking to NodeCG over
// plain http on another machine. NodeCG on the same PC (localhost) usually
// works; the bundle always does.

import type { NodecgReport } from '../shared/protocol.ts';

interface Socket {
  connected: boolean;
  on(event: string, fn: (...args: unknown[]) => void): void;
  emit(event: string, payload: unknown, ack: (...args: unknown[]) => void): void;
}
type Io = (url: string, opts?: Record<string, unknown>) => Socket;

interface RunData {
  externalID?: string | number;
  game?: string;
  category?: string;
  teams?: { players?: { name?: string }[] }[];
}
interface Timer {
  state?: 'stopped' | 'running' | 'paused' | 'finished';
  milliseconds?: number;
  timestamp?: number;
}

const POLL_MS = 1_000;
const HEARTBEAT_MS = 15_000;
const NAMESPACE = 'nodecg-speedcontrol';

const params = new URLSearchParams(location.search);
const room = (params.get('room') ?? '').replace(/^\/+|\/+$/g, '');
const nodecgUrl = (params.get('nodecg') || 'http://localhost:9090').replace(/\/+$/, '');
const key = params.get('key');
const token = new URLSearchParams(location.hash.slice(1)).get('t') ?? '';

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

/** Reads a replicant's current value; NodeCG 1 acks `(data)`, NodeCG 2 `(error, data)`. */
function read<T>(socket: Socket, name: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 3_000);
    socket.emit('replicant:declare', { name, namespace: NAMESPACE, opts: {} }, (...args) => {
      clearTimeout(timer);
      const [error, data] = args.length > 1 ? args : [null, args[0]];
      resolve(error ? undefined : (data as { value?: T } | undefined)?.value);
    });
  });
}

export function buildReport(
  run: RunData | undefined,
  timer: Timer | undefined,
  now = Date.now(),
): Omit<NodecgReport, 't'> {
  const elapsedMs = timer
    ? Math.max(
        0,
        (timer.milliseconds ?? 0) +
          (timer.state === 'running' && timer.timestamp ? now - timer.timestamp : 0),
      )
    : 0;
  return {
    via: 'bridge',
    run: run
      ? {
          externalID: run.externalID != null ? String(run.externalID) : null,
          game: run.game ?? null,
          category: run.category ?? null,
          players: (run.teams ?? [])
            .flatMap((t) => (t.players ?? []).map((p) => p.name ?? ''))
            .filter(Boolean)
            .slice(0, 32),
        }
      : null,
    timer: timer?.state ? { state: timer.state, elapsedMs: Math.round(elapsedMs) } : null,
  };
}

async function main() {
  if (!room || !token) {
    show(
      'room',
      'Missing: open the address Schedule Helper gave you (it has ?room= and #t=).',
      'bad',
    );
    show('nodecg', '—');
    return;
  }
  show('room', room);
  try {
    await loadScript(`${nodecgUrl}/socket.io/socket.io.js`);
  } catch {
    show(
      'nodecg',
      `Can’t reach NodeCG at ${nodecgUrl}. Is it running, and is that its address? (Set ?nodecg=…)`,
      'bad',
    );
    return;
  }
  const io = (window as unknown as { io?: Io }).io;
  if (!io) {
    show('nodecg', `${nodecgUrl} didn’t provide a socket.io client.`, 'bad');
    return;
  }
  const socket = io(nodecgUrl, {
    transports: ['websocket', 'polling'],
    ...(key ? { query: { key } } : {}),
  });
  socket.on('connect', () => show('nodecg', `Connected to ${nodecgUrl}`, 'ok'));
  socket.on('disconnect', () =>
    show('nodecg', `Disconnected from ${nodecgUrl}, retrying…`, 'warn'),
  );
  socket.on('connect_error', () =>
    show('nodecg', `Can’t connect to ${nodecgUrl}. If NodeCG needs a login, add &key=…`, 'bad'),
  );

  let lastKey = '';
  let lastSent = 0;
  const endpoint = `/api/rooms/${room}/nodecg`;

  async function tick() {
    if (!socket.connected) return;
    const [run, timer] = await Promise.all([
      read<RunData>(socket, 'runDataActiveRun'),
      read<Timer>(socket, 'timer'),
    ]);
    const report = buildReport(run, timer);
    show(
      'speedcontrol',
      run
        ? `${run.game ?? 'Untitled run'}${run.category ? ` (${run.category})` : ''} · timer ${timer?.state ?? 'unknown'}`
        : 'No active run (is nodecg-speedcontrol installed?)',
      run ? '' : 'warn',
    );
    const changeKey = JSON.stringify([report.run, report.timer?.state]);
    if (changeKey === lastKey && Date.now() - lastSent < HEARTBEAT_MS) return;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ t: token, ...report }),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        matched?: string | null;
        listening?: boolean;
      } | null;
      if (!res.ok) {
        show('report', body?.error ?? `Refused (${res.status})`, 'bad');
        return;
      }
      lastKey = changeKey;
      lastSent = Date.now();
      const time = new Date().toLocaleTimeString();
      if (body?.listening === false) {
        show(
          'report',
          `Reported at ${time}, but NodeCG is switched off in Schedule Helper`,
          'warn',
        );
      } else if (report.run && !body?.matched) {
        show('report', `Reported at ${time}; that run isn’t the live one or next few`, 'warn');
      } else {
        show('report', `Reported at ${time}`, 'ok');
      }
    } catch {
      show('report', 'Can’t reach Schedule Helper, retrying…', 'bad');
    }
  }

  setInterval(() => void tick(), POLL_MS);
}

void main();
