// Runner self check-in links. Each run gets its own unguessable link — an HMAC
// of the room and the run key — so a runner can say "I'm here" or "running
// late" for their run without operator access, and for nothing else. Operators
// fetch the links (auth-gated); the secret never leaves the server.
//
// The secret lives in DATA_DIR so links survive restarts and deploys (printed
// QR codes stay good). Set CHECKIN_SECRET to pin it, or delete the file to
// invalidate every link. Anything wrong with it stops the server starting:
// quietly making a new one would break every link handed out so far.

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
/** A pinned secret shorter than this could be brute-forced from one leaked link. */
const MIN_SECRET_LENGTH = 32;

/** Creates `file` with `content` all at once, or not at all; false if it already exists. */
function createAtomically(file: string, content: string): boolean {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  try {
    fs.linkSync(tmp, file);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function same(expected: string, token: unknown): boolean {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

export class CheckInTokens {
  readonly #secret: string;

  constructor(secret: string) {
    if (secret.length < MIN_SECRET_LENGTH) {
      throw new Error(`The check-in secret must be at least ${MIN_SECRET_LENGTH} characters.`);
    }
    this.#secret = secret;
  }

  /** Reads the secret from `dataDir`, creating it on first use. Throws rather than guess. */
  static load(dataDir: string, pinned = ''): CheckInTokens {
    if (pinned) return new CheckInTokens(pinned);
    const file = path.join(dataDir, FILE);
    fs.mkdirSync(dataDir, { recursive: true });
    if (createAtomically(file, randomBytes(32).toString('base64url'))) {
      log.info(`created a check-in secret at ${file}`);
    }
    const secret = fs.readFileSync(file, 'utf8').trim();
    if (!secret) {
      throw new Error(`${file} is empty. Delete it to make a new one (old links stop working).`);
    }
    return new CheckInTokens(secret);
  }

  token(ref: RoomRef, key: RunKey): string {
    return createHmac('sha256', this.#secret)
      .update(`checkin:v1\n${roomKey(ref)}\n${key}`)
      .digest('base64url')
      .slice(0, TOKEN_LENGTH);
  }

  verify(ref: RoomRef, key: RunKey, token: unknown): boolean {
    return same(this.token(ref, key), token);
  }

  /**
   * The stream PC's token for a room: lets NodeCG speedcontrol report what's on
   * stream (tracking/nodecg.ts), and nothing else. Same secret, its own purpose.
   */
  sourceToken(ref: RoomRef): string {
    return createHmac('sha256', this.#secret)
      .update(`source:v1\n${roomKey(ref)}`)
      .digest('base64url')
      .slice(0, TOKEN_LENGTH);
  }

  verifySource(ref: RoomRef, token: unknown): boolean {
    return same(this.sourceToken(ref), token);
  }
}

/**
 * How often one link may be used: a link gets forwarded and shown as a QR code,
 * so it mustn't be able to flood the log, the screens or the undo history.
 */
export class LinkThrottle {
  readonly #gapMs: number;
  readonly #perHour: number;
  readonly #uses = new Map<string, number[]>();

  /** A second apart (a runner correcting a mis-tap is fine), twenty an hour at most. */
  constructor({ gapMs = 1_000, perHour = 20 }: { gapMs?: number; perHour?: number } = {}) {
    this.#gapMs = gapMs;
    this.#perHour = perHour;
  }

  /** Records a use if it's allowed now; false if it's too soon or too often. */
  allow(key: string, now = Date.now()): boolean {
    const recent = (this.#uses.get(key) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= this.#perHour || (recent.length && now - recent.at(-1)! < this.#gapMs)) {
      this.#uses.set(key, recent);
      return false;
    }
    recent.push(now);
    this.#uses.set(key, recent);
    if (this.#uses.size > 10_000) this.#prune(now);
    return true;
  }

  #prune(now: number): void {
    for (const [k, uses] of this.#uses) {
      if (!uses.some((t) => now - t < 3_600_000)) this.#uses.delete(k);
    }
  }
}
