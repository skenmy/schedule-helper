// Runner self check-in links. Each run gets its own unguessable link — an HMAC
// of the room and the run key — so a runner can say "I'm here" or "running
// late" for their run without operator access, and for nothing else. Operators
// fetch the links (auth-gated); the secret never leaves the server.
//
// The secret lives in DATA_DIR so links survive restarts and deploys. Set
// CHECKIN_SECRET to pin it, or delete the file to invalidate every link.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { roomKey } from '../shared/sources.ts';
import type { RoomRef, RunKey } from '../shared/types.ts';
import { logger } from './logger.ts';

const log = logger('checkin');
const FILE = 'checkin-secret';
/** 22 base64url characters: 132 bits, plenty for a link that can only touch one run. */
const TOKEN_LENGTH = 22;
const TOKEN_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${TOKEN_LENGTH}}$`);

export class CheckInTokens {
  readonly #secret: string;

  constructor(secret: string) {
    if (!secret) throw new Error('A check-in secret is required.');
    this.#secret = secret;
  }

  /**
   * Reads the secret from `dataDir`, creating it on first use. If the data
   * directory can't be written, falls back to one for this process only (links
   * stop working after a restart) rather than refusing to start.
   */
  static load(dataDir: string, override = ''): CheckInTokens {
    if (override) return new CheckInTokens(override);
    const file = path.join(dataDir, FILE);
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      try {
        fs.writeFileSync(file, randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 });
        log.info(`created a check-in secret at ${file}`);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      }
      const secret = fs.readFileSync(file, 'utf8').trim();
      if (secret) return new CheckInTokens(secret);
      throw new Error(`${file} is empty`);
    } catch (err) {
      log.warn(
        `can't keep a check-in secret in ${dataDir} (${(err as Error).message}); links will stop working on restart`,
      );
      return new CheckInTokens(randomBytes(32).toString('base64url'));
    }
  }

  token(ref: RoomRef, key: RunKey): string {
    return createHmac('sha256', this.#secret)
      .update(`checkin:v1\n${roomKey(ref)}\n${key}`)
      .digest('base64url')
      .slice(0, TOKEN_LENGTH);
  }

  verify(ref: RoomRef, key: RunKey, token: unknown): boolean {
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return false;
    return timingSafeEqual(Buffer.from(this.token(ref, key)), Buffer.from(token));
  }
}
