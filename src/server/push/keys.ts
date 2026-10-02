// VAPID keys identify this server to the browsers' push services. Generated on
// first start and kept in DATA_DIR, so subscriptions survive restarts and
// deploys: new keys would orphan every device's subscription, so anything
// wrong with the file stops the server starting instead of quietly making new
// ones. VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY pin them.

import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { logger } from '../logger.ts';

const log = logger('push');
const FILE = 'vapid.json';

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export function loadVapidKeys(dataDir: string, pinned: Partial<VapidKeys> = {}): VapidKeys {
  if (pinned.publicKey || pinned.privateKey) {
    if (!pinned.publicKey || !pinned.privateKey) {
      throw new Error('Set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, or neither.');
    }
    return { publicKey: pinned.publicKey, privateKey: pinned.privateKey };
  }
  const file = path.join(dataDir, FILE);
  fs.mkdirSync(dataDir, { recursive: true });
  // Written whole under a temporary name, then linked into place: never half a file.
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(webpush.generateVAPIDKeys()), { mode: 0o600 });
  try {
    fs.linkSync(tmp, file);
    log.info(`created push keys at ${file}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  const keys = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<VapidKeys>;
  if (!keys.publicKey || !keys.privateKey) {
    throw new Error(
      `${file} is missing a key. Delete it to make new ones (devices must re-enable alerts).`,
    );
  }
  return { publicKey: keys.publicKey, privateKey: keys.privateKey };
}
