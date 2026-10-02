// VAPID keys identify this server to the browsers' push services. Generated on
// first start and kept in DATA_DIR, so subscriptions survive restarts and
// deploys (new keys would orphan every one). VAPID_PUBLIC_KEY and
// VAPID_PRIVATE_KEY pin them instead.

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
  if (pinned.publicKey && pinned.privateKey) {
    return { publicKey: pinned.publicKey, privateKey: pinned.privateKey };
  }
  const file = path.join(dataDir, FILE);
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    try {
      fs.writeFileSync(file, JSON.stringify(webpush.generateVAPIDKeys()), {
        flag: 'wx',
        mode: 0o600,
      });
      log.info(`created push keys at ${file}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const keys = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<VapidKeys>;
    if (keys.publicKey && keys.privateKey) {
      return { publicKey: keys.publicKey, privateKey: keys.privateKey };
    }
    throw new Error(`${file} is missing a key`);
  } catch (err) {
    log.warn(
      `can't keep push keys in ${dataDir} (${(err as Error).message}); notifications stop on restart`,
    );
    return webpush.generateVAPIDKeys();
  }
}
