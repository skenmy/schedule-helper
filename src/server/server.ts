// Composes the HTTP app, WebSocket layer and background jobs.

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { runCapture, startDriftScheduler } from './capture/service.ts';
import { CheckInTokens } from './checkin.ts';
import { loadVapidKeys } from './push/keys.ts';
import { PushService, webPushSender, type PushSender } from './push/service.ts';
import { PushStore } from './push/store.ts';
import { config } from './config.ts';
import { createApp } from './http.ts';
import { RoomRegistry } from './rooms/registry.ts';
import type { RoomServices } from './rooms/room.ts';
import { RoomStore } from './rooms/store.ts';
import { fetchSchedule } from './sources/index.ts';
import { startTracking } from './tracking/service.ts';
import { fileLookup, twitchLookup, type StreamLookup } from './tracking/twitch.ts';
import { attachWebSocket } from './ws.ts';

export interface RunningServer {
  port: number;
  registry: RoomRegistry;
  push: PushService;
  /** Flushes every room to disk and closes all connections. */
  close(): Promise<number>;
}

export async function startServer(opts: {
  port: number;
  dataDir: string;
  services?: Partial<RoomServices>;
  /** Where auto-tracking reads Twitch channel info (null: unavailable). Defaults from config. */
  streams?: StreamLookup | null;
  trackingTickMs?: number;
  /** Delivers push notifications. Defaults to the real push services. */
  pushSender?: PushSender;
}): Promise<RunningServer> {
  const registry = new RoomRegistry({
    store: new RoomStore(opts.dataDir),
    services: { fetchSchedule, capture: runCapture, ...opts.services },
  });
  const checkins = CheckInTokens.load(opts.dataDir, config.checkinSecret);
  const keys = loadVapidKeys(opts.dataDir, {
    publicKey: config.vapidPublicKey,
    privateKey: config.vapidPrivateKey,
  });
  const push = new PushService({
    registry,
    store: new PushStore(opts.dataDir),
    publicKey: keys.publicKey,
    send: opts.pushSender ?? webPushSender(keys, config.vapidSubject),
  });
  push.start();
  const server = http.createServer(createApp(registry, { checkins, push }));
  const wss = attachWebSocket(server, registry);
  const stopDrift = startDriftScheduler(registry);
  const stopTracking = startTracking(registry, {
    lookup: opts.streams === undefined ? defaultLookup() : opts.streams,
    tickMs: opts.trackingTickMs ?? config.trackingTickMs,
  });
  const sweeper = setInterval(() => registry.sweep(), 60_000);
  sweeper.unref();

  await new Promise<void>((resolve) => server.listen(opts.port, resolve));

  return {
    port: (server.address() as AddressInfo).port,
    registry,
    push,
    async close() {
      push.stop();
      stopDrift();
      stopTracking();
      clearInterval(sweeper);
      const flushed = registry.flushAll();
      for (const client of wss.clients) client.close(1012, 'Server restarting');
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      return flushed;
    },
  };
}

function defaultLookup(): StreamLookup | null {
  if (config.streamInfoFile) return fileLookup(config.streamInfoFile);
  if (config.twitchClientId && config.twitchClientSecret) {
    return twitchLookup({
      clientId: config.twitchClientId,
      clientSecret: config.twitchClientSecret,
    });
  }
  return null;
}
