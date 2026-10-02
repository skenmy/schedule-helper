// What each tracked Twitch channel is streaming: its category and title.
// Helix with an app access token (client credentials), cached until it
// expires; every channel in one request. No user sign-in or webhook needed.

import fsp from 'node:fs/promises';
import { z } from 'zod';
import { logger } from '../logger.ts';

const log = logger('twitch');
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const STREAMS_URL = 'https://api.twitch.tv/helix/streams';
const TIMEOUT_MS = 10_000;
/** Helix takes up to 100 logins per request. */
const BATCH = 100;

export interface ChannelInfo {
  live: boolean;
  game: string | null;
  title: string | null;
}

/** Looks up channels by login (lowercase); every login asked for gets an answer. */
export interface StreamLookup {
  lookup(logins: string[]): Promise<Map<string, ChannelInfo>>;
}

export class StreamLookupError extends Error {}

const OFFLINE: ChannelInfo = { live: false, game: null, title: null };

const TokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number() });
const StreamsSchema = z.object({
  data: z.array(
    z.object({
      user_login: z.string(),
      game_name: z.string().nullish(),
      title: z.string().nullish(),
      type: z.string().nullish(),
    }),
  ),
});

type Fetch = typeof fetch;

export function twitchLookup(opts: {
  clientId: string;
  clientSecret: string;
  fetch?: Fetch;
}): StreamLookup {
  const doFetch = opts.fetch ?? fetch;
  let token: { value: string; expires: number } | null = null;

  async function request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await doFetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
      throw new StreamLookupError(timedOut ? 'Twitch timed out' : 'Twitch is unreachable');
    }
  }

  async function appToken(): Promise<string> {
    if (token && Date.now() < token.expires) return token.value;
    const body = new URLSearchParams({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      grant_type: 'client_credentials',
    });
    const res = await request(TOKEN_URL, { method: 'POST', body });
    if (!res.ok)
      throw new StreamLookupError(`Twitch refused the app credentials (HTTP ${res.status})`);
    const parsed = TokenSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new StreamLookupError('Twitch sent an unexpected token response');
    // Renew a minute early rather than race the expiry.
    token = {
      value: parsed.data.access_token,
      expires: Date.now() + Math.max(0, parsed.data.expires_in - 60) * 1000,
    };
    return token.value;
  }

  async function streams(logins: string[], retry = true): Promise<z.infer<typeof StreamsSchema>> {
    const url = `${STREAMS_URL}?${logins.map((l) => `user_login=${encodeURIComponent(l)}`).join('&')}&first=${BATCH}`;
    const res = await request(url, {
      headers: { 'client-id': opts.clientId, authorization: `Bearer ${await appToken()}` },
    });
    if (res.status === 401 && retry) {
      // Revoked or expired early: fetch a new token once.
      token = null;
      return streams(logins, false);
    }
    if (!res.ok) throw new StreamLookupError(`Twitch returned HTTP ${res.status}`);
    const parsed = StreamsSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new StreamLookupError('Twitch sent an unexpected streams response');
    return parsed.data;
  }

  return {
    async lookup(logins) {
      const out = new Map<string, ChannelInfo>();
      const unique = [...new Set(logins.map((l) => l.toLowerCase()))];
      for (let i = 0; i < unique.length; i += BATCH) {
        const batch = unique.slice(i, i + BATCH);
        for (const login of batch) out.set(login, OFFLINE);
        const { data } = await streams(batch);
        for (const s of data) {
          out.set(s.user_login.toLowerCase(), {
            live: s.type == null || s.type === 'live',
            game: s.game_name || null,
            title: s.title || null,
          });
        }
      }
      return out;
    },
  };
}

/**
 * Development and tests: channel info from a JSON file, re-read on every poll
 * — `{ "channel": { "game": "…", "title": "…" } }`. A channel missing from the
 * file is offline. Mirrors CAPTURE_FRAME_FILE for stream capture.
 */
export function fileLookup(file: string): StreamLookup {
  return {
    async lookup(logins) {
      let data: Record<string, { game?: string; title?: string; live?: boolean }> = {};
      try {
        data = JSON.parse(await fsp.readFile(file, 'utf8')) as typeof data;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`${file}: ${String(err)}`);
      }
      const out = new Map<string, ChannelInfo>();
      for (const login of logins) {
        const entry = data[login.toLowerCase()];
        out.set(
          login.toLowerCase(),
          entry
            ? { live: entry.live ?? true, game: entry.game ?? null, title: entry.title ?? null }
            : OFFLINE,
        );
      }
      return out;
    },
  };
}
