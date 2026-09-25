// Minimal history-API router: the room lives in the path (/oengus/event/slug).

import { parseLegacyHash, roomPath } from '../../shared/sources.ts';

const RETURN_KEY = 'sh.returnTo';

class Router {
  path = $state(location.pathname);
  search = $state(location.search);
  params = $derived(new URLSearchParams(this.search));

  constructor() {
    window.addEventListener('popstate', () => this.sync());

    // Old builds kept the room in the hash (#event/slug, #horaro:event/slug).
    const legacy = parseLegacyHash(location.hash);
    if (legacy && location.pathname === '/') {
      this.navigate(roomPath(legacy) + location.search, { replace: true });
      return;
    }
    // Back from tools.skenmy.com sign-in, which always returns to "/".
    const back = sessionStorage.getItem(RETURN_KEY);
    if (back) {
      sessionStorage.removeItem(RETURN_KEY);
      if (location.pathname === '/' && back.startsWith('/')) this.navigate(back, { replace: true });
    }
  }

  private sync(): void {
    this.path = location.pathname;
    this.search = location.search;
  }

  navigate(url: string, { replace = false } = {}): void {
    history[replace ? 'replaceState' : 'pushState'](null, '', url);
    this.sync();
    window.scrollTo(0, 0);
  }

  /** Updates query parameters in place without adding history entries. */
  setParams(update: Record<string, string | null>): void {
    const merged: Record<string, string> = {
      ...Object.fromEntries(this.params),
      ...update,
    } as Record<string, string>;
    for (const [k, v] of Object.entries(update)) if (v == null) delete merged[k];
    const qs = new URLSearchParams(merged).toString();
    history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
    this.sync();
  }

  rememberReturn(): void {
    sessionStorage.setItem(RETURN_KEY, location.pathname + location.search);
  }
}

export const router = new Router();
