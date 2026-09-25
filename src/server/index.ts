// Entry point: start the server and flush state on shutdown.

import { config } from './config.ts';
import { logger } from './logger.ts';
import { startServer } from './server.ts';

const log = logger('server');

const server = await startServer({ port: config.port, dataDir: config.dataDir });
log.info(`listening on http://localhost:${server.port} (build ${config.build})`);
if (!config.toolsAuthUrl) log.warn('TOOLS_AUTH_URL is not set: everyone can control every room.');
if (!config.anthropicApiKey) log.warn('ANTHROPIC_API_KEY is not set: stream capture will fail.');

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info(`${signal}: flushing rooms`);
  const flushed = await server.close();
  log.info(`flushed ${flushed} room(s)`);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
