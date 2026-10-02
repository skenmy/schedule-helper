import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RoomRef } from '../shared/types.ts';
import { CheckInTokens, LinkThrottle } from './checkin.ts';

const REF: RoomRef = { source: 'oengus', event: 'uksg', slug: 'main' };
const SECRET = 'a-secret-that-is-long-enough-to-use-1234';
const dirs: string[] = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-checkin-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('CheckInTokens', () => {
  it('gives each run in each room its own token, and checks them', () => {
    const t = new CheckInTokens(SECRET);
    const token = t.token(REF, 'o1');
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(t.token(REF, 'o1')).toBe(token);
    expect(t.token(REF, 'o2')).not.toBe(token);
    expect(t.token({ ...REF, slug: 'side' }, 'o1')).not.toBe(token);
    expect(new CheckInTokens(`${SECRET}!`).token(REF, 'o1')).not.toBe(token);

    expect(t.verify(REF, 'o1', token)).toBe(true);
    expect(t.verify(REF, 'o2', token)).toBe(false);
    expect(t.verify(REF, 'o1', token.slice(1))).toBe(false);
    expect(t.verify(REF, 'o1', `${token.slice(0, 21)}é`)).toBe(false);
    expect(t.verify(REF, 'o1', undefined)).toBe(false);
    expect(t.verify(REF, 'o1', [token])).toBe(false);
  });

  it('keeps its secret in the data directory, so links survive a restart', () => {
    const dir = tmp();
    const first = CheckInTokens.load(dir).token(REF, 'o1');
    const file = path.join(dir, 'checkin-secret');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(CheckInTokens.load(dir).token(REF, 'o1')).toBe(first);
    // Deleting the file invalidates every link.
    fs.rmSync(file);
    expect(CheckInTokens.load(dir).token(REF, 'o1')).not.toBe(first);
  });

  it('uses CHECKIN_SECRET when set, and refuses a short one', () => {
    const dir = tmp();
    expect(CheckInTokens.load(dir, SECRET).token(REF, 'o1')).toBe(
      new CheckInTokens(SECRET).token(REF, 'o1'),
    );
    expect(fs.existsSync(path.join(dir, 'checkin-secret'))).toBe(false);
    expect(() => CheckInTokens.load(dir, 'hunter2')).toThrow(/at least 32/);
  });

  it('won’t start on a secret it can’t trust, rather than quietly break every link', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'checkin-secret'), '\n');
    expect(() => CheckInTokens.load(dir)).toThrow(/is empty/);

    const blocked = path.join(dir, 'not-a-dir');
    fs.writeFileSync(blocked, '');
    expect(() => CheckInTokens.load(blocked)).toThrow();
    // No temporary files left behind by the atomic create.
    const fresh = tmp();
    CheckInTokens.load(fresh);
    expect(fs.readdirSync(fresh)).toEqual(['checkin-secret']);
  });
});

describe('stream PC tokens', () => {
  it('are their own thing, one per room, and can be replaced one room at a time', () => {
    const dir = tmp();
    const t = CheckInTokens.load(dir, SECRET);
    const old = t.sourceToken(REF);
    const other = t.sourceToken({ ...REF, slug: 'side' });
    expect(old).not.toBe(t.token(REF, 'o1'));
    expect(t.verify(REF, 'o1', old)).toBe(false);

    const fresh = t.rotateSource(REF);
    expect(fresh).not.toBe(old);
    expect(t.verifySource(REF, old)).toBe(false);
    expect(t.verifySource(REF, fresh)).toBe(true);
    expect(t.sourceToken({ ...REF, slug: 'side' })).toBe(other);
    // Survives a restart.
    expect(CheckInTokens.load(dir, SECRET).sourceToken(REF)).toBe(fresh);
  });
});

describe('LinkThrottle', () => {
  it('spaces uses out and caps them per hour', () => {
    const t = new LinkThrottle({ gapMs: 5_000, perHour: 3 });
    expect(t.allow('a', 0)).toBe(true);
    expect(t.allow('a', 1_000)).toBe(false);
    expect(t.allow('b', 1_000)).toBe(true);
    expect(t.allow('a', 6_000)).toBe(true);
    expect(t.allow('a', 12_000)).toBe(true);
    expect(t.allow('a', 20_000)).toBe(false); // three this hour
    expect(t.allow('a', 3_600_001)).toBe(true);
  });
});
