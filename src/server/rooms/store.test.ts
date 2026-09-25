import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomStore } from './store.ts';

const REF = { source: 'oengus', event: 'e', slug: 's' } as const;
let dir: string;

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

function store() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-store-'));
  return new RoomStore(dir);
}

describe('RoomStore', () => {
  it('drops an async save that a newer write has superseded', async () => {
    const s = store();
    s.saveSync(REF, '"new"');
    expect(await s.save(REF, '"old"', () => false)).toBe(false);
    expect(fs.readFileSync(s.file(REF), 'utf8')).toBe('"new"');
    expect(fs.readdirSync(s.dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('moves a corrupt file aside instead of overwriting it later', async () => {
    const s = store();
    fs.writeFileSync(s.file(REF), '{ not json');
    expect(await s.load(REF)).toBeNull();
    const files = fs.readdirSync(s.dir);
    expect(files.some((f) => f.includes('.corrupt-'))).toBe(true);
    expect(fs.existsSync(s.file(REF))).toBe(false);
  });

  it('backs up before a reset and keeps only the newest five', () => {
    const s = store();
    // A frozen clock: names must still be unique and the newest backup never pruned.
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const written = Array.from({ length: 7 }, (_, i) => s.backup(REF, JSON.stringify(i)));
    expect(new Set(written).size).toBe(7);
    const backups = fs.readdirSync(s.dir).filter((f) => f.includes('.reset-'));
    expect(backups).toHaveLength(5);
    const kept = backups.map((f) => fs.readFileSync(path.join(s.dir, f), 'utf8')).sort();
    expect(kept).toEqual(['2', '3', '4', '5', '6']);
    expect(fs.readdirSync(s.dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('never prunes the newest backup when the clock steps backwards', () => {
    const s = store();
    const now = vi.spyOn(Date, 'now');
    for (let i = 0; i < 5; i++) {
      now.mockReturnValue(10_000 + i);
      s.backup(REF, JSON.stringify(`old ${i}`));
    }
    now.mockReturnValue(5_000);
    const latest = s.backup(REF, '"latest"');
    expect(fs.readFileSync(latest, 'utf8')).toBe('"latest"');
    expect(fs.readdirSync(s.dir).filter((f) => f.includes('.reset-'))).toHaveLength(5);
  });
});
