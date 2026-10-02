// Runner self check-in: the per-run links operators hand out, and the calls the
// runner's page makes. Runners aren't operators, so these go over HTTP with the
// link's token rather than through the socket (server: http.ts, checkin.ts).

import type { SelfCheckIn } from '../../shared/protocol.ts';
import { roomPath } from '../../shared/sources.ts';
import type { RoomRef, RunKey, RunnerLate } from '../../shared/types.ts';
import { fmtClock } from './format.ts';

const api = (ref: RoomRef) => `/api/rooms${roomPath(ref)}`;

export function checkinUrl(ref: RoomRef, key: RunKey, token: string): string {
  const qs = new URLSearchParams({ checkin: key, t: token });
  return new URL(`${roomPath(ref)}?${qs}`, location.origin).toString();
}

async function errorOf(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error ?? `Something went wrong (${res.status}).`);
}

const cache = new Map<string, Promise<Record<RunKey, string>>>();

/** Every run's link token (operators only). Kept for the session; a failure isn't. */
export function checkinTokens(ref: RoomRef): Promise<Record<RunKey, string>> {
  const key = roomPath(ref);
  let hit = cache.get(key);
  if (!hit) {
    hit = fetch(`${api(ref)}/checkin-links`, { credentials: 'same-origin' }).then(async (res) => {
      if (!res.ok) throw await errorOf(res);
      return ((await res.json()) as { tokens: Record<RunKey, string> }).tokens;
    });
    hit.catch(() => cache.delete(key));
    cache.set(key, hit);
  }
  return hit;
}

/** Whether a runner's link is good: true / false, or null when the server couldn't be asked. */
export async function linkIsValid(
  ref: RoomRef,
  key: RunKey,
  token: string,
): Promise<boolean | null> {
  try {
    const qs = new URLSearchParams({ t: token });
    const res = await fetch(`${api(ref)}/checkin/${encodeURIComponent(key)}?${qs}`);
    if (res.ok) return true;
    return res.status === 403 ? false : null;
  } catch {
    return null;
  }
}

/** The runner's "I'm here" / "running late". Throws with the server's explanation. */
export async function selfCheckIn(ref: RoomRef, key: RunKey, body: SelfCheckIn): Promise<void> {
  const res = await fetch(`${api(ref)}/checkin/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await errorOf(res);
}

/** `ETA 18:20`, `ETA was 18:20` once it's passed, or `no ETA`. */
export function etaText(late: RunnerLate, now: number): string {
  if (late.etaAt == null) return 'no ETA';
  return `ETA ${late.etaAt < now ? 'was ' : ''}${fmtClock(late.etaAt)}`;
}
