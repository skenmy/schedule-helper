import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RoomStore } from './store.ts';

const REF = { source: 'oengus', event: 'e', slug: 's' } as const;
let dir: string;

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

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
    const written = Array.from({ length: 7 }, (_, i) => s.backup(REF, JSON.stringify(i)));
    expect(new Set(written).size).toBe(7);
    const backups = fs.readdirSync(s.dir).filter((f) => f.includes('.reset-'));
    expect(backups).toHaveLength(5);
    const kept = backups.map((f) => fs.readFileSync(path.join(s.dir, f), 'utf8')).sort();
    expect(kept).toEqual(['2', '3', '4', '5', '6']);
    expect(fs.readdirSync(s.dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
