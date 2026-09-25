// Horaro (horaro.net) public API v1.

import { z } from 'zod';
import { parseIsoDuration } from '../../shared/time.ts';
import type { Schedule, ScheduleLine, ScheduleSummary } from '../../shared/types.ts';
import { fetchJson, keyer, toEpoch } from './http.ts';

const API = 'https://horaro.net/-/api/v1';
const enc = encodeURIComponent;

const Event = z.object({
  data: z.object({ name: z.string().catch(''), twitch: z.string().nullish() }),
});

const ScheduleList = z.object({
  data: z.array(z.object({ name: z.string().catch(''), slug: z.string() })).catch([]),
});

const Item = z.object({
  length: z.string().nullish(),
  scheduled: z.string().nullish(),
  scheduled_t: z.number().nullish(),
  data: z.array(z.string().nullable()).catch([]),
  options: z.object({ setup: z.string().nullish() }).nullish().catch(null),
});

const ScheduleBody = z.object({
  data: z.object({
    name: z.string().catch(''),
    twitch: z.string().nullish(),
    setup: z.string().nullish(),
    columns: z.array(z.string()).catch([]),
    items: z.array(Item).catch([]),
  }),
});

const COLUMN_PATTERNS = {
  game: [/^game$/i, /^title$/i, /^game\b/i],
  category: [/^category$/i, /^run$/i, /categor/i],
  console: [/^console$/i, /^platform$/i, /^system$/i],
  runners: [/^runners?\b/i, /^players?\b/i],
} as const;

/** Horaro cells are Markdown; keep the link text, drop the URL. */
export function stripMarkdown(cell: string | null | undefined): string {
  return (cell ?? '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .trim();
}

export function mapHoraroItems(
  columns: string[],
  items: z.infer<typeof Item>[],
  defaultSetup: string | null | undefined,
): ScheduleLine[] {
  const col = (field: keyof typeof COLUMN_PATTERNS): number => {
    for (const p of COLUMN_PATTERNS[field]) {
      const i = columns.findIndex((c) => p.test(c.trim()));
      if (i >= 0) return i;
    }
    return -1;
  };
  const gameCol = Math.max(0, col('game'));
  const catCol = col('category');
  const conCol = col('console');
  const runCol = col('runners');
  const key = keyer('h');
  const setupSec = parseIsoDuration(defaultSetup);

  return items.map((item) => {
    const cell = (i: number) => (i >= 0 ? stripMarkdown(item.data[i]) : '');
    const game = cell(gameCol);
    const category = cell(catCol);
    const runners = cell(runCol)
      .split(/\s*(?:,|&|\bvs\.?\b|\/)\s*/i)
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      key: key([game, category, runners.join(',')]),
      game,
      category,
      console: cell(conCol),
      type: 'SINGLE',
      runners,
      estimateSec: parseIsoDuration(item.length),
      setupSec: item.options?.setup ? parseIsoDuration(item.options.setup) : setupSec,
      scheduledStart: item.scheduled_t != null ? item.scheduled_t * 1000 : toEpoch(item.scheduled),
      setupBlock: false,
      setupBlockText: '',
    };
  });
}

export async function horaroEvent(event: string): Promise<{ name: string; twitch: string }> {
  const e = Event.parse(await fetchJson(`${API}/events/${enc(event)}`));
  return { name: e.data.name, twitch: e.data.twitch ?? '' };
}

export async function horaroSchedules(event: string): Promise<ScheduleSummary[]> {
  const list = ScheduleList.parse(await fetchJson(`${API}/events/${enc(event)}/schedules`));
  return list.data.map((s) => ({ slug: s.slug, name: s.name || s.slug }));
}

export async function horaroSchedule(event: string, slug: string): Promise<Schedule> {
  const [info, body] = await Promise.all([
    horaroEvent(event).catch(() => ({ name: event, twitch: '' })),
    fetchJson(`${API}/events/${enc(event)}/schedules/${enc(slug)}`),
  ]);
  const s = ScheduleBody.parse(body).data;
  return {
    ref: { source: 'horaro', event, slug },
    eventName: info.name || event,
    scheduleName: s.name || slug,
    twitch: s.twitch || info.twitch,
    lines: mapHoraroItems(s.columns, s.items, s.setup),
    fetchedAt: Date.now(),
  };
}
