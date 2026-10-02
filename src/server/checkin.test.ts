import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RoomRef } from '../shared/types.ts';
import { CheckInTokens } from './checkin.ts';

const REF: RoomRef = { source: 'oengus', event: 'uksg', slug: 'main' };
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
    const t = new CheckInTokens('secret');
    const token = t.token(REF, 'o1');
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(t.token(REF, 'o1')).toBe(token);
    expect(t.token(REF, 'o2')).not.toBe(token);
    expect(t.token({ ...REF, slug: 'side' }, 'o1')).not.toBe(token);
    expect(new CheckInTokens('other').token(REF, 'o1')).not.toBe(token);

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

  it('uses CHECKIN_SECRET when set, and still starts when the directory is unwritable', () => {
    const dir = tmp();
    expect(CheckInTokens.load(dir, 'pinned').token(REF, 'o1')).toBe(
      new CheckInTokens('pinned').token(REF, 'o1'),
    );
    expect(fs.existsSync(path.join(dir, 'checkin-secret'))).toBe(false);

    const blocked = path.join(dir, 'not-a-dir');
    fs.writeFileSync(blocked, '');
    expect(CheckInTokens.load(blocked).token(REF, 'o1')).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});
