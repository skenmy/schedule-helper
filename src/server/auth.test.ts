import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// tools-skenmy stand-in: the status it answers with is set per test.
let status = 200;
const server = http.createServer((_req, res) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({ authenticated: true, canWrite: true, user: { login: 'op', display: 'Op' } }),
  );
});

let resolveIdentity: typeof import('./auth.ts').resolveIdentity;

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, r));
  vi.stubEnv('TOOLS_AUTH_URL', `http://localhost:${(server.address() as AddressInfo).port}`);
  vi.resetModules();
  ({ resolveIdentity } = await import('./auth.ts'));
});

afterAll(() => {
  vi.unstubAllEnvs();
  server.close();
});

describe('resolveIdentity', () => {
  it('reports an auth-service outage as unknown rather than read-only', async () => {
    status = 503;
    expect(await resolveIdentity('session=a')).toBeNull();
  });

  it('resolves operators when the service answers', async () => {
    status = 200;
    expect(await resolveIdentity('session=b')).toMatchObject({
      canWrite: true,
      user: { login: 'op' },
    });
  });

  it('treats a missing cookie as an anonymous viewer without calling out', async () => {
    status = 503;
    expect(await resolveIdentity(undefined)).toMatchObject({
      authenticated: false,
      canWrite: false,
    });
  });
});
