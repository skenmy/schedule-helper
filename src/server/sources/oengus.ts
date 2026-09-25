// Oengus (oengus.io): v1 for marathon metadata, v2 for schedules.

import { z } from 'zod';
import { parseIsoDuration } from '../../shared/time.ts';
import type { Schedule, ScheduleLine, ScheduleSummary } from '../../shared/types.ts';
import { fetchJson, toEpoch } from './http.ts';

const API = 'https://oengus.io/api';
const enc = encodeURIComponent;

const Marathon = z.object({
  name: z.string().catch(''),
  twitch: z.string().nullish(),
});

const ScheduleList = z.object({
  data: z
    .array(
      z.object({
        name: z.string().catch(''),
        slug: z.string(),
        published: z.boolean().catch(true),
      }),
    )
    .catch([]),
});

const Runner = z.object({
  runnerName: z.string().nullish(),
  displayName: z.string().nullish(),
  username: z.string().nullish(),
  profile: z
    .object({ displayName: z.string().nullish(), username: z.string().nullish() })
    .nullish(),
});

const Line = z.object({
  id: z.union([z.number(), z.string()]),
  position: z.number().catch(0),
  game: z.string().nullish(),
  category: z.string().nullish(),
  console: z.string().nullish(),
  type: z.string().nullish(),
  runners: z.array(Runner).catch([]),
  estimate: z.string().nullish(),
  setupTime: z.string().nullish(),
  date: z.string().nullish(),
  setupBlock: z.boolean().nullish(),
  setupBlockText: z.string().nullish(),
});

const ScheduleBody = z.object({
  name: z.string().catch(''),
  lines: z.array(Line).catch([]),
});

function runnerName(r: z.infer<typeof Runner>): string | null {
  return (
    r.profile?.displayName ||
    r.profile?.username ||
    r.displayName ||
    r.runnerName ||
    r.username ||
    null
  );
}

export function mapOengusLines(lines: z.infer<typeof Line>[]): ScheduleLine[] {
  return [...lines]
    .sort((a, b) => a.position - b.position)
    .map((l) => ({
      key: `o${l.id}`,
      game: l.game?.trim() || '',
      category: l.category?.trim() || '',
      console: l.console?.trim() || '',
      type: (l.type || 'SINGLE').toUpperCase(),
      runners: l.runners.map(runnerName).filter((n): n is string => !!n),
      estimateSec: parseIsoDuration(l.estimate),
      setupSec: parseIsoDuration(l.setupTime),
      scheduledStart: toEpoch(l.date),
      setupBlock: !!l.setupBlock,
      setupBlockText: l.setupBlockText?.trim() || '',
    }));
}

export async function oengusEvent(event: string): Promise<{ name: string; twitch: string }> {
  const m = Marathon.parse(await fetchJson(`${API}/v1/marathons/${enc(event)}`));
  return { name: m.name, twitch: m.twitch ?? '' };
}

export async function oengusSchedules(event: string): Promise<ScheduleSummary[]> {
  const list = ScheduleList.parse(await fetchJson(`${API}/v2/marathons/${enc(event)}/schedules`));
  return list.data
    .filter((s) => s.published)
    .map((s) => ({ slug: s.slug, name: s.name || s.slug }));
}

export async function oengusSchedule(event: string, slug: string): Promise<Schedule> {
  const [info, body] = await Promise.all([
    oengusEvent(event).catch(() => ({ name: event, twitch: '' })),
    fetchJson(`${API}/v2/marathons/${enc(event)}/schedules/for-slug/${enc(slug)}`),
  ]);
  const parsed = ScheduleBody.parse(body);
  return {
    ref: { source: 'oengus', event, slug },
    eventName: info.name || event,
    scheduleName: parsed.name || slug,
    twitch: info.twitch,
    lines: mapOengusLines(parsed.lines),
    fetchedAt: Date.now(),
  };
}
