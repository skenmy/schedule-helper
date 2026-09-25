// Upstream HTTP with a hard timeout and typed failures.

export class UpstreamError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
  }
  get notFound(): boolean {
    return this.status === 404;
  }
}

const USER_AGENT = 'ScheduleHelper/2.0 (+https://schedule.skenmy.com)';

export async function fetchJson(url: string, timeoutMs = 10_000): Promise<unknown> {
  const host = new URL(url).host;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
    throw new UpstreamError(timedOut ? `${host} timed out` : `${host} is unreachable`);
  }
  if (!res.ok) {
    throw new UpstreamError(
      res.status === 404 ? `Not found on ${host}` : `${host} returned HTTP ${res.status}`,
      res.status,
    );
  }
  try {
    return await res.json();
  } catch {
    throw new UpstreamError(`${host} returned invalid JSON`, res.status);
  }
}

/** Short stable hash (FNV-1a, base36) for content-derived run keys. */
export function hashKey(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Content-derived keys, disambiguating repeats of the same run. */
export function keyer(prefix: string): (parts: string[]) => string {
  const seen = new Map<string, number>();
  return (parts) => {
    const base = `${prefix}${hashKey(parts.join('\u0000').toLowerCase())}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}

export function toEpoch(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
