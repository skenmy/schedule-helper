// Operator identity via tools.skenmy.com forward-auth. The shared .skenmy.com
// session cookie is bounced off /auth/me; results are cached briefly so
// reconnect storms don't hammer tools-skenmy.

import { createHash } from 'node:crypto';
import type { AuthInfo, AuthUser } from '../shared/types.ts';
import { config } from './config.ts';
import { logger } from './logger.ts';

const log = logger('auth');
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: AuthInfo }>();

function loginUrl(): string {
  const u = new URL(config.authLoginUrl);
  u.searchParams.set('redirect', `${config.publicUrl}/`);
  return u.toString();
}

function identity(partial: Partial<AuthInfo>): AuthInfo {
  return {
    authenticated: false,
    canWrite: false,
    root: false,
    user: null,
    loginUrl: loginUrl(),
    manageUrl: config.authManageUrl,
    ...partial,
  };
}

function toUser(raw: unknown): AuthUser | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Record<string, unknown>;
  const login = typeof u.login === 'string' ? u.login : '';
  if (!login) return null;
  return {
    login,
    display: typeof u.display === 'string' && u.display ? u.display : login,
    avatar: typeof u.avatar === 'string' && u.avatar ? u.avatar : null,
  };
}

export function actorName(auth: AuthInfo): string | null {
  return auth.user ? auth.user.display || auth.user.login : null;
}

export function anonymousIdentity(): AuthInfo {
  return identity({});
}

/**
 * Who is behind this cookie. Returns null when tools-skenmy can't be reached
 * (network error or 5xx) so callers keep what they knew instead of demoting
 * every operator to read-only during an auth-service restart.
 */
export async function resolveIdentity(cookieHeader: string | undefined): Promise<AuthInfo | null> {
  if (!config.toolsAuthUrl) {
    return {
      authenticated: false,
      canWrite: true,
      root: false,
      user: null,
      loginUrl: null,
      manageUrl: null,
    };
  }
  const cookie = cookieHeader ?? '';
  if (!cookie) return identity({});

  const key = createHash('sha256').update(cookie).digest('base64url');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let value: AuthInfo;
  try {
    const u = new URL('/auth/me', config.toolsAuthUrl);
    u.searchParams.set('app', config.authAppId);
    u.searchParams.set('role', 'admin');
    const res = await fetch(u, { headers: { cookie }, signal: AbortSignal.timeout(5_000) });
    if (res.status >= 500) {
      log.warn(`/auth/me returned ${res.status}`);
      return null;
    }
    if (res.ok) {
      const body = (await res.json()) as Record<string, unknown>;
      value = identity({
        authenticated: !!body.authenticated,
        canWrite: !!body.canWrite,
        root: !!body.root,
        user: toUser(body.user),
      });
    } else {
      value = identity({});
    }
  } catch (err) {
    log.warn(`/auth/me failed: ${(err as Error).message}`);
    return null;
  }
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 5_000) cache.delete(cache.keys().next().value!);
  return value;
}
