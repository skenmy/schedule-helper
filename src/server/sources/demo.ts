// A synthetic, always-live marathon for local development, tests and demos.
// Anchored to process start so "now" is a few hours into the event.

import type { RoomState, Schedule, ScheduleLine, ScheduleSummary } from '../../shared/types.ts';

const RUNS: [
  game: string,
  category: string,
  console: string,
  runners: string[],
  estMin: number,
  type?: string,
][] = [
  ['Celeste', 'Any%', 'PC', ['cerulean'], 32],
  ['Super Mario 64', '16 Star', 'N64', ['ptkay'], 18],
  ['Hollow Knight', 'All Skills', 'PC', ['mothwing'], 55],
  ['Portal', 'Inbounds', 'PC', ['orangebox'], 25],
  ['The Legend of Zelda: Ocarina of Time', 'Glitchless', 'N64', ['epona', 'navi'], 170, 'RACE'],
  ['Spyro the Dragon', '120%', 'PS1', ['gnasty'], 95],
  ['Hades', 'Fresh File', 'PC', ['zagreus'], 40],
  ['Sonic Adventure 2: Battle', 'Hero Story', 'GC', ['chao'], 50],
  ['ULTRAKILL', 'Early Access Inbounds', 'PC', ['herreteman'], 45],
  ['Crash Bandicoot', 'Any%', 'PS1', ['wumpa'], 42],
  ['Pikmin 2', 'Any%', 'GC', ['olimar', 'louie'], 120, 'COOP'],
  ['Tetris Effect', 'Journey Mode', 'PC', ['zone'], 38],
  ['Katamari Damacy', 'All Stars', 'PS2', ['prince'], 44],
  ['Metroid Dread', 'Any%', 'Switch', ['emmi'], 85],
  ['Cuphead', 'Any% Legacy', 'PC', ['mugman'], 28],
  ['Super Mario Odyssey', 'Any%', 'Switch', ['cappy', 'tiara', 'bowser'], 70, 'RACE'],
  ['Kirby Super Star', 'Milky Way Wishes', 'SNES', ['waddle'], 36],
  ['Outer Wilds', 'Any%', 'PC', ['hearthian'], 20],
  ['Banjo-Kazooie', '100%', 'N64', ['jiggy'], 150],
  ['Minecraft: Java Edition', 'Any% Random Seed', 'PC', ['enderman'], 30],
  ['Donkey Kong Country 2', '102%', 'SNES', ['dixie'], 80],
  ['Final Fantasy X', 'Any% No Sphere Grid', 'PS2', ['blitzball'], 300],
  ['Portal 2', 'Co-op Any%', 'PC', ['atlas', 'pbody'], 60, 'COOP'],
  ['Super Metroid', 'Any% (Relay)', 'SNES', ['samus', 'ridley', 'kraid'], 55, 'RELAY'],
];

const SETUP_MIN = 10;
const anchor = (() => {
  const halfHour = 30 * 60_000;
  return Math.floor(Date.now() / halfHour) * halfHour - 3 * 60 * 60_000;
})();

export const demoSchedules: ScheduleSummary[] = [{ slug: 'main', name: 'Main stream' }];

export function demoSchedule(): Schedule {
  const lines: ScheduleLine[] = [];
  let t = anchor;
  RUNS.forEach(([game, category, console, runners, estMin, type = 'SINGLE'], i) => {
    lines.push({
      key: `d${i}`,
      game,
      category,
      console,
      type,
      runners,
      estimateSec: estMin * 60,
      setupSec: SETUP_MIN * 60,
      scheduledStart: t,
      setupBlock: false,
      setupBlockText: '',
    });
    t += (estMin + SETUP_MIN) * 60_000;
    if (i === 7 || i === 17) {
      lines.push({
        key: `d${i}s`,
        game: '',
        category: '',
        console: '',
        type: 'SINGLE',
        runners: [],
        estimateSec: 20 * 60,
        setupSec: 0,
        scheduledStart: t,
        setupBlock: true,
        setupBlockText: i === 7 ? 'Charity interview' : 'Prize draw',
      });
      t += 20 * 60_000;
    }
  });
  return {
    ref: { source: 'demo', event: 'demo', slug: 'main' },
    eventName: 'Demo Marathon',
    scheduleName: 'Main stream',
    twitch: '',
    lines,
    fetchedAt: Date.now(),
  };
}

// Minutes each finished demo run went over (+) or under (−) its estimate.
const OVERRUNS = [3, -2, 4, 1, 6, -3, 2, 5, -1, 2];

/**
 * Gives a fresh demo room a believable history — finished runs, a run in
 * progress a few minutes behind, some check-ins — so it looks live on arrival.
 */
export function seedDemoState(
  state: RoomState,
  lines: readonly ScheduleLine[],
  now: number,
): RoomState {
  const s = structuredClone(state);
  let cursor = lines[0]?.scheduledStart ?? now;
  let n = 0;
  let current = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const start = Math.max(cursor, line.scheduledStart ?? cursor);
    if (line.setupBlock) {
      cursor = start + (line.estimateSec + line.setupSec) * 1000;
      continue;
    }
    if (start > now) {
      current = i;
      break;
    }
    const end = start + (line.estimateSec + (OVERRUNS[n++ % OVERRUNS.length] ?? 0) * 60) * 1000;
    if (end > now) {
      s.runs[line.key] = { startedAt: start, checkIn: 'ready' };
      current = i;
      break;
    }
    s.runs[line.key] = { startedAt: start, endedAt: end, checkIn: 'ready' };
    s.log.unshift({
      id: s.log.length + 1,
      at: end,
      kind: 'system',
      text: `■ Finished ${line.game}`,
      runKey: line.key,
      actor: null,
    });
    cursor = end + line.setupSec * 1000;
  }
  const cur = lines[current];
  if (!cur) return s;
  s.currentKey = cur.key;
  const upcoming = lines.slice(current + 1).filter((l) => !l.setupBlock);
  const statuses = ['ready', 'ready', 'missing'] as const;
  upcoming.slice(0, statuses.length).forEach((l, i) => {
    s.runs[l.key] = { ...s.runs[l.key], checkIn: statuses[i] };
  });
  s.log.unshift({
    id: s.log.length + 1,
    at: now - 5 * 60_000,
    kind: 'tech',
    text: 'Stream mic levels fixed on the runner feed',
    runKey: cur.key,
    actor: 'demo-tech',
  });
  return s;
}
