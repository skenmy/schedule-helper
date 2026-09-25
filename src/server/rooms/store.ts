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
      log.error(`Corrupt room file ${this.file(ref)}; starting fresh`, err);
      return null;
    }
  }

  async save(data: RoomFile): Promise<void> {
    const file = this.file(data.ref);
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(data));
    await fsp.rename(tmp, file);
  }

  saveSync(data: RoomFile): void {
    const file = this.file(data.ref);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  }
}

export { FORMAT as ROOM_FILE_FORMAT };
