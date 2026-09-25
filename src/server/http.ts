// HTTP surface: schedule discovery, the overlay feed (JSON + SSE), capture
// frames, health, and the built client with SPA fallback.

import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { ID_PATTERN, SOURCES, isValidRef } from '../shared/sources.ts';
import type { RoomRef, ScheduleSource } from '../shared/types.ts';
import { config } from './config.ts';
import { buildFeed } from './feed.ts';
import { logger } from './logger.ts';
import type { RoomRegistry } from './rooms/registry.ts';
import { UpstreamError, fetchEventListing } from './sources/index.ts';

const log = logger('http');

function refFrom(req: Request): RoomRef | null {
  const ref = {
    source: req.params.source as ScheduleSource,
    event: String(req.params.event),
    slug: String(req.params.slug),
  };
  return isValidRef(ref) ? ref : null;
}

function sendError(res: Response, err: unknown): void {
  if (err instanceof UpstreamError) {
    res.status(err.notFound ? 404 : 502).json({ error: err.message });
    return;
  }
  log.error(err);
  res.status(500).json({ error: 'Internal error' });
}

const cors = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('access-control-allow-origin', '*');
  next();
};

export function createApp(registry: RoomRegistry): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, build: config.build });
  });

  // Landing page: resolve an event to its published schedules.
  app.get('/api/events/:source/:event', async (req, res) => {
    const source = req.params.source as ScheduleSource;
    const event = String(req.params.event);
    if (!SOURCES.includes(source) || !ID_PATTERN.test(event)) {
      res.status(400).json({ error: 'Invalid event' });
      return;
    }
    try {
      res.json(await fetchEventListing(source, event));
    } catch (err) {
      sendError(res, err);
    }
  });

  // Overlay feed — read-only, CORS-open, same data every viewer can already see.
  app.get('/api/rooms/:source/:event/:slug/feed', cors, async (req, res) => {
    const ref = refFrom(req);
    if (!ref) {
      res.status(400).json({ error: 'Invalid schedule' });
      return;
    }
    try {
      const room = await registry.open(ref);
      res.setHeader('cache-control', 'no-store');
      res.json(buildFeed(room));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/rooms/:source/:event/:slug/feed/stream', cors, async (req, res) => {
    const ref = refFrom(req);
    if (!ref) {
      res.status(400).json({ error: 'Invalid schedule' });
      return;
    }
    let room;
    try {
      room = await registry.open(ref);
    } catch (err) {
      sendError(res, err);
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const push = () => res.write(`event: feed\ndata: ${JSON.stringify(buildFeed(room))}\n\n`);
    push();
    const unsubscribe = room.subscribe(push);
    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  app.get('/api/rooms/:source/:event/:slug/frames/:id', (req, res) => {
    const ref = refFrom(req);
    const frame = ref ? registry.get(ref)?.frames.get(String(req.params.id)) : undefined;
    if (!frame) {
      res.status(404).end();
      return;
    }
    res.setHeader('content-type', frame.mediaType);
    res.setHeader('cache-control', 'private, max-age=3600, immutable');
    res.end(frame.data);
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Built client. Hashed assets are immutable; everything else revalidates.
  const index = path.join(config.clientDir, 'index.html');
  app.use(
    express.static(config.clientDir, {
      index: false,
      setHeaders(res, file) {
        if (file.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );
  app.get('/{*path}', (_req, res) => {
    if (!fs.existsSync(index)) {
      res
        .status(503)
        .type('text')
        .send(
          'Client not built. Run `npm run build`, or `npm run dev` and open http://localhost:5173.',
        );
      return;
    }
    res.setHeader('cache-control', 'no-cache');
    res.sendFile(index);
  });

  return app;
}
