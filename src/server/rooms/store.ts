// Room persistence: one JSON file per room, written atomically (tmp + rename).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { RoomRef, RoomState, Schedule } from '../../shared/types.ts';
import { logger } from '../logger.ts';
import type { UndoEntry } from './state.ts';

const log = logger('store');
const FORMAT = 2;

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

  private tmpFor(file: string): string {
    return `${file}.${process.pid}.${++this.writes}.tmp`;
  }
}

export { FORMAT as ROOM_FILE_FORMAT };
