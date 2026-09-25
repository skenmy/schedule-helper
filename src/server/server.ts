// Composes the HTTP app, WebSocket layer and background jobs.

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { runCapture, startDriftScheduler } from './capture/service.ts';
import { createApp } from './http.ts';
import { RoomRegistry } from './rooms/registry.ts';
import type { RoomServices } from './rooms/room.ts';
import { RoomStore } from './rooms/store.ts';
import { fetchSchedule } from './sources/index.ts';
import { attachWebSocket } from './ws.ts';

export interface RunningServer {
  port: number;
  registry: RoomRegistry;
  /** Flushes every room to disk and closes all connections. */
  close(): Promise<number>;
}

export async function startServer(opts: {
  port: number;
  dataDir: string;
  services?: Partial<RoomServices>;
}): Promise<RunningServer> {
  const registry = new RoomRegistry({
    store: new RoomStore(opts.dataDir),
    services: { fetchSchedule, capture: runCapture, ...opts.services },
  });
  const server = http.createServer(createApp(registry));
  const wss = attachWebSocket(server, registry);
  const stopDrift = startDriftScheduler(registry);
  const sweeper = setInterval(() => registry.sweep(), 60_000);
  sweeper.unref();

  await new Promise<void>((resolve) => server.listen(opts.port, resolve));

  return {
    port: (server.address() as AddressInfo).port,
    registry,
    async close() {
      stopDrift();
      clearInterval(sweeper);
      const flushed = registry.flushAll();
      for (const client of wss.clients) client.close(1012, 'Server restarting');
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      return flushed;
    },
  };
}
