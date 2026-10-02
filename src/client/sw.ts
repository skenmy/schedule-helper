// Service worker: lets the installed app open with no signal. It caches the
// app shell (HTML, hashed JS/CSS/fonts, icons) and nothing else: live data
// comes over the WebSocket, and the last known room state lives in
// localStorage (lib/offline.ts). Built by the plugin in vite.config.ts, which
// defines __PRECACHE__ (this build's files) and __VERSION__ (a hash of them).

declare const self: ServiceWorkerGlobalScope;
declare const __PRECACHE__: string[];
declare const __VERSION__: string;

const SHELL_CACHE = `shell-${__VERSION__}`;
/** Same-origin static files that aren't part of the build (brand logos). */
const RUNTIME_CACHE = 'runtime-v1';
const SHELL = '/index.html';
/** On a slow network, open the cached app rather than leave the screen blank. */
const NAVIGATION_TIMEOUT_MS = 4_000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(__PRECACHE__.map((file) => `/${file}`));
      // Assets are content-hashed and navigations go to the network first,
      // so a new worker can take over at once without breaking open pages.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== SHELL_CACHE && key !== RUNTIME_CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Live data and the overlay feed always go to the server.
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws') return;

  if (request.mode === 'navigate') event.respondWith(navigate(request));
  else if (url.pathname.startsWith('/brand/')) event.respondWith(runtime(event, request));
  else event.respondWith(precached(request));
});

/** Network first, so a deploy shows up on the next load; the cached shell when offline. */
async function navigate(request: Request): Promise<Response> {
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), NAVIGATION_TIMEOUT_MS),
      ),
    ]);
    // A server error (mid-deploy) is no better than being offline.
    if (response.status < 500) return response;
  } catch {
    // offline, or too slow
  }
  const shell = await caches.match(SHELL, { cacheName: SHELL_CACHE });
  return shell ?? Response.error();
}

async function precached(request: Request): Promise<Response> {
  const hit = await caches.match(request, { cacheName: SHELL_CACHE });
  return hit ?? fetch(request);
}

/** Stale-while-revalidate: the cached copy now, a fresh one for next time. */
async function runtime(event: FetchEvent, request: Request): Promise<Response> {
  const cache = await caches.open(RUNTIME_CACHE);
  const hit = await cache.match(request);
  const update = fetch(request).then(async (response) => {
    if (response.ok) await cache.put(request, response.clone());
    return response;
  });
  if (hit) {
    event.waitUntil(update.catch(() => {}));
    return hit;
  }
  return update;
}

// ── Push notifications (operators' alerts; server: src/server/push/) ──────────

interface PushPayload {
  title: string;
  body: string;
  tag: string;
  /** A path in this app to open when tapped. */
  url: string;
}

self.addEventListener('push', (event) => {
  let data: PushPayload | null = null;
  try {
    data = (event.data?.json() as PushPayload | undefined) ?? null;
  } catch {
    // Not ours.
  }
  if (!data?.title) return;
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      data: { url: data.url },
      icon: '/icons/icon-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = (event.notification.data as { url?: unknown } | null)?.url;
  const target = new URL(typeof raw === 'string' ? raw : '/', self.location.origin);
  // Only ever open this app.
  const url = target.origin === self.location.origin ? target.href : self.location.origin;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).pathname === new URL(url).pathname);
      if (open) return void (await open.focus());
      if (windows[0]) {
        await windows[0].focus();
        return void (await windows[0].navigate(url));
      }
      await self.clients.openWindow(url);
    })(),
  );
});
