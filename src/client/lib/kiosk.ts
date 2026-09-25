// Kiosk layouts, panels and presets. A kiosk's configuration lives in its URL
// (?kiosk=1&layout=…&panels=…) so a venue TV can be set up once and bookmarked.

export interface KioskLayout {
  id: string;
  name: string;
  cols: string;
  rows: string;
  /** CSS grid-template-areas, one letter per cell in panel order. */
  areas: string;
}

export const LAYOUTS: KioskLayout[] = [
  { id: '1x1', name: 'Single', cols: '1fr', rows: '1fr', areas: '"a"' },
  { id: '1x2', name: 'Side by side', cols: '1fr 1fr', rows: '1fr', areas: '"a b"' },
  { id: '2x1', name: 'Stacked', cols: '1fr', rows: '1fr 1fr', areas: '"a" "b"' },
  { id: 'side', name: 'Sidebar + main', cols: '1fr 2fr', rows: '1fr 1fr', areas: '"a b" "a c"' },
  { id: '1+2', name: 'One over two', cols: '1fr 1fr', rows: '1fr 1fr', areas: '"a a" "b c"' },
  { id: '2+1', name: 'Two over one', cols: '1fr 1fr', rows: '1fr 1fr', areas: '"a b" "c c"' },
  { id: '2x2', name: 'Quad', cols: '1fr 1fr', rows: '1fr 1fr', areas: '"a b" "c d"' },
  {
    id: '1+3',
    name: 'One over three',
    cols: '1fr 1fr 1fr',
    rows: '1fr 1fr',
    areas: '"a a a" "b c d"',
  },
  {
    id: '2+3',
    name: 'Two over three',
    cols: 'repeat(6, 1fr)',
    rows: '1fr 1fr',
    areas: '"a a a b b b" "c c d d e e"',
  },
  {
    id: '3x3',
    name: 'Nine',
    cols: 'repeat(3, 1fr)',
    rows: 'repeat(3, 1fr)',
    areas: '"a b c" "d e f" "g h i"',
  },
];

export function cellCount(layout: KioskLayout): number {
  return new Set(layout.areas.replace(/"/g, '').split(/\s+/).filter(Boolean)).size;
}

export function areaNames(layout: KioskLayout): string[] {
  return [...new Set(layout.areas.replace(/"/g, '').split(/\s+/).filter(Boolean))];
}

export const PANELS = {
  delta: { name: 'Delta', description: 'Ahead / behind schedule' },
  running: { name: 'Now running', description: 'Current run, runners and timer' },
  timing: { name: 'Timing', description: 'Elapsed, estimate, remaining' },
  ondeck: { name: 'Up next', description: 'The next few runs with projected times' },
  checkins: { name: 'Check-ins', description: 'Runner readiness for upcoming runs' },
  schedule: { name: 'Schedule', description: 'Scrolling list of runs' },
  progress: { name: 'Progress', description: 'Marathon completion and projected end' },
  clock: { name: 'Clock', description: 'Wall clock and date' },
  message: { name: 'Message board', description: 'Big text from the Broadcast tab' },
  controls: { name: 'Controls', description: 'Start / stop / next (operators only)' },
  log: { name: 'Event log', description: 'Latest log entries' },
  twitch: { name: 'Stream', description: 'Muted Twitch player' },
} as const;

export type PanelId = keyof typeof PANELS;

const ALIASES: Record<string, PanelId> = {
  current: 'running',
  nextup: 'ondeck',
  marathon: 'progress',
};

export function toPanelId(raw: string): PanelId | null {
  const id = ALIASES[raw] ?? raw;
  return id in PANELS ? (id as PanelId) : null;
}

export interface KioskConfig {
  layout: string;
  panels: (PanelId | null)[];
}

export const PRESETS: { id: string; name: string; description: string; config: KioskConfig }[] = [
  {
    id: 'host',
    name: 'Host',
    description: 'Delta, now running, up next',
    config: { layout: '1+2', panels: ['delta', 'running', 'ondeck'] },
  },
  {
    id: 'tech',
    name: 'Tech desk',
    description: 'Controls, now running, log, up next',
    config: { layout: '2x2', panels: ['controls', 'running', 'log', 'ondeck'] },
  },
  {
    id: 'green',
    name: 'Green room',
    description: 'Check-ins, now running, up next',
    config: { layout: 'side', panels: ['checkins', 'running', 'ondeck'] },
  },
  {
    id: 'schedule',
    name: 'Schedule wall',
    description: 'Full-screen schedule',
    config: { layout: '1x1', panels: ['schedule'] },
  },
  {
    id: 'message',
    name: 'Message board',
    description: 'Big text on a plain background',
    config: { layout: '1x1', panels: ['message'] },
  },
];

export const DEFAULT_KIOSK: KioskConfig = PRESETS[0]!.config;

export function layoutById(id: string): KioskLayout {
  // A literal "+" in a query string arrives as a space.
  const norm = id.replace(/ /g, '+');
  return LAYOUTS.find((l) => l.id === norm) ?? LAYOUTS.find((l) => l.id === DEFAULT_KIOSK.layout)!;
}

export function readKioskParams(params: URLSearchParams): KioskConfig | null {
  const layout = params.get('layout');
  const panels = params.get('panels');
  if (!layout && !panels) return null;
  return {
    layout: layoutById(layout ?? DEFAULT_KIOSK.layout).id,
    panels: (panels ?? '').split(',').map((p) => (p ? toPanelId(p.trim()) : null)),
  };
}

export function kioskUrl(roomPath: string, config: KioskConfig): string {
  const params = new URLSearchParams({
    kiosk: '1',
    layout: config.layout,
    panels: config.panels.map((p) => p ?? '').join(','),
  });
  return `${roomPath}?${params.toString()}`;
}
