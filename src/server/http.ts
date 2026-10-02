// HTTP surface: schedule discovery, the overlay feed (JSON + SSE), the event
// report, runner self check-in, capture frames, health, and the built client
// with SPA fallback.

import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { SelfCheckInSchema, type MutatingAction } from '../shared/protocol.ts';
import { buildReport, reportCsv } from '../shared/report.ts';
import { ID_PATTERN, SOURCES, isValidRef } from '../shared/sources.ts';
import type { RoomRef, RunKey, ScheduleSource } from '../shared/types.ts';
import { resolveIdentity } from './auth.ts';
import type { CheckInTokens } from './checkin.ts';
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

export function createApp(
  registry: RoomRegistry,
  { checkins }: { checkins: CheckInTokens },
): express.Express {
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

  // Event report: planned against actual. Read-only, like the feed.
  app.get('/api/rooms/:source/:event/:slug/report.:format', cors, async (req, res) => {
    const ref = refFrom(req);
    const format = String(req.params.format);
    if (!ref || (format !== 'json' && format !== 'csv')) {
      res.status(400).json({ error: 'Invalid report' });
      return;
    }
    try {
      const room = await registry.open(ref);
      const report = buildReport(room.schedule, room.state, Date.now());
      res.setHeader('cache-control', 'no-store');
      if (format === 'json') {
        res.json(report);
        return;
      }
      res.type('text/csv; charset=utf-8');
      res.setHeader(
        'content-disposition',
        `attachment; filename="${ref.event}-${ref.slug}-report.csv"`,
      );
      // A byte-order mark so spreadsheets read runner names as UTF-8.
      res.send(`\uFEFF${reportCsv(report)}`);
    } catch (err) {
      sendError(res, err);
    }
  });

  // ── Runner self check-in ────────────────────────────────────────────────────
  // Operators get every run's link; a runner's link can only check in that run.

  app.get('/api/rooms/:source/:event/:slug/checkin-links', async (req, res) => {
    const ref = refFrom(req);
    res.setHeader('cache-control', 'no-store');
    if (!ref) {
      res.status(400).json({ error: 'Invalid room' });
      return;
    }
    const auth = await resolveIdentity(req.headers.cookie);
    if (!auth) {
      res.status(503).json({ error: 'Can’t check your sign-in right now. Try again shortly.' });
      return;
    }
    if (!auth.canWrite) {
      res.status(auth.authenticated ? 403 : 401).json({
        error: auth.authenticated
          ? 'You’re signed in, but don’t have operator access to this app.'
          : 'Sign in to get runner check-in links.',
      });
      return;
    }
    try {
      const room = await registry.open(ref);
      const tokens: Record<RunKey, string> = {};
      for (const line of room.schedule.lines) {
        if (!line.setupBlock) tokens[line.key] = checkins.token(ref, line.key);
      }
      res.json({ tokens });
    } catch (err) {
      sendError(res, err);
    }
  });

  const BAD_LINK = 'This check-in link isn’t valid. Ask an organiser for a new one.';

  // Lets the runner's page say up front that the link is wrong, before they tap.
  app.get('/api/rooms/:source/:event/:slug/checkin/:key', (req, res) => {
    const ref = refFrom(req);
    res.setHeader('cache-control', 'no-store');
    if (!ref || !checkins.verify(ref, String(req.params.key), req.query.t)) {
      res.status(403).json({ error: BAD_LINK });
      return;
    }
    res.json({ ok: true });
  });

  app.post(
    '/api/rooms/:source/:event/:slug/checkin/:key',
    express.json({ limit: '4kb' }),
    async (req, res) => {
      const ref = refFrom(req);
      const key = String(req.params.key);
      res.setHeader('cache-control', 'no-store');
      const body = SelfCheckInSchema.safeParse(req.body);
      if (!ref || !body.success) {
        res.status(400).json({ error: 'That request wasn’t valid.' });
        return;
      }
      if (!checkins.verify(ref, key, body.data.t)) {
        res.status(403).json({ error: BAD_LINK });
        return;
      }
      try {
        const room = await registry.open(ref);
        const line = room.schedule.lines.find((l) => l.key === key);
        const rec = room.state.runs[key];
        const refusal =
          !line || line.setupBlock
            ? 'That run is no longer on the schedule. Talk to an organiser.'
            : rec?.skipped
              ? 'That run was taken off the schedule. Talk to an organiser.'
              : rec?.startedAt != null || room.state.finishedAt != null
                ? 'That run has already started.'
                : null;
        if (refusal) {
          res.status(409).json({ error: refusal });
          return;
        }
        const action: MutatingAction =
          body.data.status === 'ready'
            ? { action: 'runner:checkin', key, status: 'ready' }
            : { action: 'runner:late', key, minutes: body.data.minutes, note: body.data.note };
        const actor = `${line!.runners.join(', ') || 'Runner'} (check-in link)`;
        const result = room.dispatch(action, actor, undefined, { runner: true });
        if (!result.ok) {
          res.status(result.code === 'invalid' ? 400 : 409).json({ error: result.message });
          return;
        }
        res.json({ ok: true });
      } catch (err) {
        sendError(res, err);
      }
    },
  );

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
  // Bodies that aren't JSON, or are too big, get a JSON error like everything else in /api.
  app.use('/api', (err: { status?: number }, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent || !err.status || err.status >= 500) {
      next(err);
      return;
    }
    res.status(err.status).json({ error: 'That request wasn’t valid.' });
  });

  // Built client. Hashed assets are immutable; everything else revalidates —
  // above all the service worker and manifest, so a deploy reaches installed apps.
  const index = path.join(config.clientDir, 'index.html');
  app.use(
    express.static(config.clientDir, {
      index: false,
      setHeaders(res, file) {
        if (file.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('cache-control', 'no-cache');
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
