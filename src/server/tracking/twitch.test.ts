import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileLookup, twitchLookup } from './twitch.ts';

type Call = { url: string; init: RequestInit | undefined };

/** A fetch that answers the token and streams endpoints from the given handlers. */
function fakeFetch(handlers: {
  token?: () => Response;
  streams: (url: URL, auth: string) => Response;
}) {
  const calls: Call[] = [];
  let tokens = 0;
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith('https://id.twitch.tv/oauth2/token')) {
      tokens++;
      return (
        handlers.token?.() ??
        Response.json({ access_token: `tok${tokens}`, expires_in: 3600, token_type: 'bearer' })
      );
    }
    const headers = new Headers(init?.headers);
    return handlers.streams(new URL(url), headers.get('authorization') ?? '');
  }) as typeof fetch;
  return { fn, calls, tokens: () => tokens };
}

const opts = { clientId: 'cid', clientSecret: 'secret' };

describe('twitchLookup', () => {
  it('reads category and title for live channels and marks the rest offline', async () => {
    const f = fakeFetch({
      streams: (url) => {
        expect(url.searchParams.getAll('user_login')).toEqual(['uksg', 'quiet']);
        return Response.json({
          data: [
            { user_login: 'UKSG', game_name: 'Spyro the Dragon', title: 'Spyro!', type: 'live' },
          ],
        });
      },
    });
    const info = await twitchLookup({ ...opts, fetch: f.fn }).lookup(['UKSG', 'quiet', 'uksg']);
    expect(info.get('uksg')).toEqual({ live: true, game: 'Spyro the Dragon', title: 'Spyro!' });
    expect(info.get('quiet')).toEqual({ live: false, game: null, title: null });
  });

  it('reuses the app token, and renews it once when Twitch rejects it', async () => {
    let reject = false;
    const f = fakeFetch({
      streams: (_url, auth) =>
        reject && auth === 'Bearer tok1'
          ? new Response('', { status: 401 })
          : Response.json({ data: [] }),
    });
    const lookup = twitchLookup({ ...opts, fetch: f.fn });
    await lookup.lookup(['a']);
    await lookup.lookup(['a']);
    expect(f.tokens()).toBe(1);
    reject = true;
    await lookup.lookup(['a']);
    expect(f.tokens()).toBe(2);
  });

  it('says plainly what went wrong', async () => {
    const badCreds = fakeFetch({
      token: () => new Response('', { status: 403 }),
      streams: () => Response.json({ data: [] }),
    });
    await expect(twitchLookup({ ...opts, fetch: badCreds.fn }).lookup(['a'])).rejects.toThrow(
      'Twitch refused the app credentials (HTTP 403)',
    );
    const down = fakeFetch({ streams: () => new Response('', { status: 503 }) });
    await expect(twitchLookup({ ...opts, fetch: down.fn }).lookup(['a'])).rejects.toThrow(
      'Twitch returned HTTP 503',
    );
    const odd = fakeFetch({ streams: () => Response.json({ nope: true }) });
    await expect(twitchLookup({ ...opts, fetch: odd.fn }).lookup(['a'])).rejects.toThrow(
      'unexpected streams response',
    );
  });
});

describe('fileLookup', () => {
  it('reads channel info from a JSON file on every lookup', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sh-stream-')), 'streams.json');
    const lookup = fileLookup(file);
    expect((await lookup.lookup(['uksg'])).get('uksg')?.live).toBe(false);
    fs.writeFileSync(file, JSON.stringify({ uksg: { game: 'Hades', title: 'Hades by zagreus' } }));
    expect((await lookup.lookup(['UKSG'])).get('uksg')).toEqual({
      live: true,
      game: 'Hades',
      title: 'Hades by zagreus',
    });
  });
});
