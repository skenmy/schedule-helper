// Schedule references: parsing operator input and URLs, room paths, branding.

import type { RoomRef, ScheduleSource } from './types.ts';

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const SOURCES = ['oengus', 'horaro', 'demo'] as const satisfies readonly ScheduleSource[];

export const DEMO_REF: RoomRef = { source: 'demo', event: 'demo', slug: 'main' };

/** A reference that may still be missing its schedule slug. */
export interface PartialRef {
  source: ScheduleSource;
  event: string;
  slug: string | null;
}

export function isValidRef(ref: Partial<RoomRef> | null | undefined): ref is RoomRef {
  return (
    !!ref &&
    SOURCES.includes(ref.source as ScheduleSource) &&
    ID_PATTERN.test(ref.event ?? '') &&
    ID_PATTERN.test(ref.slug ?? '')
  );
}

function valid(source: ScheduleSource, event: string, slug: string | null): PartialRef | null {
  if (!ID_PATTERN.test(event)) return null;
  if (slug !== null && !ID_PATTERN.test(slug)) return null;
  return { source, event, slug };
}

/**
 * Accepts Oengus and Horaro URLs (with or without scheme, locale prefix, query
 * or trailing slash), app room URLs, `event/slug` shorthand (Oengus) and `demo`.
 */
export function parseScheduleInput(raw: string): PartialRef | null {
  const input = raw.trim();
  if (!input) return null;
  if (/^demo$/i.test(input)) return { ...DEMO_REF };

  const horaro = /horaro\.(?:net|org)\/([^/\s?#]+)(?:\/([^/\s?#]+))?/i.exec(input);
  if (horaro) return valid('horaro', horaro[1]!, horaro[2] ?? null);

  const oengus =
    /oengus\.io\/(?:[a-z]{2}(?:-[a-z]+)?\/)?marathon\/([^/\s?#]+)(?:\/schedule\/([^/\s?#]+))?/i.exec(
      input,
    );
  if (oengus) return valid('oengus', oengus[1]!, oengus[2] ?? null);

  // A link to this app's own room page.
  try {
    const ref = parseRoomPath(new URL(input, 'http://x').pathname);
    if (ref && /^(https?:\/\/|\/)/i.test(input)) return ref;
  } catch {
    // not a URL
  }

  const short = /^([A-Za-z0-9_-]+)(?:\/([A-Za-z0-9_-]+))?\/?$/.exec(input);
  if (short) return valid('oengus', short[1]!, short[2] ?? null);
  return null;
}

export function roomKey(ref: RoomRef): string {
  return `${ref.source}/${ref.event}/${ref.slug}`;
}

export function roomPath(ref: RoomRef): string {
  return `/${ref.source}/${encodeURIComponent(ref.event)}/${encodeURIComponent(ref.slug)}`;
}

export function parseRoomPath(pathname: string): RoomRef | null {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length !== 3) return null;
  const [source, event, slug] = parts;
  const ref = { source: source as ScheduleSource, event: event!, slug: slug! };
  return isValidRef(ref) ? ref : null;
}

/** Old builds kept the room in the hash: `#event/slug` or `#horaro:event/slug`. */
export function parseLegacyHash(hash: string): RoomRef | null {
  const h = hash.replace(/^#/, '');
  const m = /^(horaro:)?([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/.exec(h);
  if (!m) return null;
  return { source: m[1] ? 'horaro' : 'oengus', event: m[2]!, slug: m[3]! };
}

export function upstreamUrl(ref: RoomRef): string | null {
  switch (ref.source) {
    case 'oengus':
      return `https://oengus.io/marathon/${ref.event}/schedule/${ref.slug}`;
    case 'horaro':
      return `https://horaro.net/${ref.event}/${ref.slug}`;
    default:
      return null;
  }
}

export type BrandVariant = 'red' | 'green' | 'blue' | 'standard';

/** UKSG marathons (Oengus ids `uksg…`, e.g. uksgred26 / uksggrn25) get the brand theme. */
export function detectBrand(ref: RoomRef | null): { brand: 'uksg'; variant: BrandVariant } | null {
  if (!ref || ref.source !== 'oengus') return null;
  const id = ref.event.toLowerCase();
  if (!id.startsWith('uksg')) return null;
  const suffix = id.slice(4);
  const variant: BrandVariant = suffix.startsWith('red')
    ? 'red'
    : suffix.startsWith('grn')
      ? 'green'
      : suffix.startsWith('blu')
        ? 'blue'
        : 'standard';
  return { brand: 'uksg', variant };
}

/** Reduces `https://twitch.tv/Foo?x=1`, `twitch.tv/foo/`, `@foo` to `foo`; '' if invalid. */
export function normalizeTwitchChannel(input: string): string {
  const slug = input
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.|m\.)?twitch\.tv\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0];
  return slug && /^[A-Za-z0-9_]{1,25}$/.test(slug) ? slug.toLowerCase() : '';
}
