// Room persistence: one JSON file per room, written atomically (tmp + rename).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { RoomRef, RoomState, Schedule } from '../../shared/types.ts';
import { logger } from '../logger.ts';
import type { UndoEntry } from './state.ts';

const log = logger('store');
const FORMAT = 2;
/** Reset backups kept per room; older ones are pruned. */
const BACKUP_LIMIT = 5;

export interface RoomFile {
  format: typeof FORMAT;
  ref: RoomRef;
  schedule: Schedule;
  state: RoomState;
  undo: UndoEntry[];
}

export class RoomStore {
  readonly dir: string;
  private writes = 0;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'rooms');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  /** Refs are validated against ID_PATTERN before they get here, so names are safe. */
  file(ref: RoomRef): string {
    return path.join(this.dir, `${ref.source}--${ref.event}--${ref.slug}.json`);
  }

  async load(ref: RoomRef): Promise<RoomFile | null> {
    let raw: string;
    try {
      raw = await fsp.readFile(this.file(ref), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    try {
      const data = JSON.parse(raw) as RoomFile;
      if (data.format !== FORMAT) return null;
      return data;
    } catch (err) {
      // Keep the evidence: the next save would otherwise overwrite it.
      const aside = `${this.file(ref)}.corrupt-${Date.now()}`;
      log.error(`Corrupt room file ${this.file(ref)}; moved to ${aside} and starting fresh`, err);
      try {
        fs.renameSync(this.file(ref), aside);
      } catch (moveErr) {
        log.error(`Couldn't move the corrupt file aside`, moveErr);
      }
      return null;
    }
  }

  /**
   * Writes `json` to a unique temp file, then renames it into place — unless
   * `isCurrent()` says a newer write has landed meanwhile. The check and the
   * rename happen synchronously together, so a shutdown flush can't interleave.
   */
  async save(ref: RoomRef, json: string, isCurrent: () => boolean = () => true): Promise<boolean> {
    const file = this.file(ref);
    const tmp = this.tmpFor(file);
    await fsp.writeFile(tmp, json);
    if (!isCurrent()) {
      await fsp.rm(tmp, { force: true });
      return false;
    }
    fs.renameSync(tmp, file);
    return true;
  }

  saveSync(ref: RoomRef, json: string): void {
    const file = this.file(ref);
    const tmp = this.tmpFor(file);
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, file);
  }

  /**
   * Writes a copy of a room aside before a reset (`{file}.reset-{epoch ms}`),
   * keeping the newest few. To restore one, stop the server and copy it over
   * the room file.
   */
  backup(ref: RoomRef, json: string, label = 'reset'): string {
    const file = this.file(ref);
    const prefix = `${path.basename(file)}.${label}-`;
    let stamp = Date.now();
    while (fs.existsSync(`${file}.${label}-${stamp}`)) stamp++;
    const target = `${file}.${label}-${stamp}`;
    const tmp = this.tmpFor(file);
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, target);
    const old = fs
      .readdirSync(this.dir)
      .filter((f) => f.startsWith(prefix) && /^\d+$/.test(f.slice(prefix.length)))
      .sort((a, b) => Number(b.slice(prefix.length)) - Number(a.slice(prefix.length)))
      .slice(BACKUP_LIMIT);
    for (const f of old) fs.rmSync(path.join(this.dir, f), { force: true });
    return target;
  }

  private tmpFor(file: string): string {
    return `${file}.${process.pid}.${++this.writes}.tmp`;
  }
}

export { FORMAT as ROOM_FILE_FORMAT };
