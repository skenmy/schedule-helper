// Alerts on this device (operators): the browser's push subscription, and
// which rooms the server sends this device alerts for. One subscription per
// browser serves every room; turning a room off just tells the server.

import { roomPath } from '../../shared/sources.ts';
import type { RoomRef } from '../../shared/types.ts';
import { isStandalone } from './device.ts';

export type PushSupport =
  /** Ready to ask. */
  | 'ok'
  /** iPhone/iPad Safari: only an app added to the Home Screen can get notifications. */
  | 'install'
  /** The person said no; only the browser's site settings can undo that. */
  | 'denied'
  | 'unsupported';

export function pushSupport(): PushSupport {
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
  if (
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) {
    return ios && !isStandalone() ? 'install' : 'unsupported';
  }
  if (ios && !isStandalone()) return 'install';
  return Notification.permission === 'denied' ? 'denied' : 'ok';
}

const api = (ref: RoomRef, route = '') => `/api/rooms${roomPath(ref)}/push${route}`;

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(json?.error ?? `Something went wrong (${res.status}).`);
  return json as T;
}

async function existing(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

const toKey = (base64url: string) => {
  const bin = atob(base64url.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/** Whether this device gets alerts for the room. */
export async function pushIsOn(ref: RoomRef): Promise<boolean> {
  const sub = await existing();
  if (!sub) return false;
  return (await post<{ on: boolean }>(api(ref, '/status'), { endpoint: sub.endpoint })).on;
}

/** Turns alerts on (asking for permission and subscribing if needed) or off. */
export async function setPush(ref: RoomRef, on: boolean): Promise<boolean> {
  let sub = await existing();
  if (!on) {
    if (sub) await post(api(ref), { subscription: sub.toJSON(), on: false });
    return false;
  }
  if ((await Notification.requestPermission()) !== 'granted') {
    throw new Error(
      'Notifications are blocked for this site. Allow them in the browser’s settings.',
    );
  }
  if (!sub) {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg)
      throw new Error('The app hasn’t finished installing in this browser. Reload and try again.');
    const { publicKey } = (await (await fetch('/api/push/key')).json()) as { publicKey: string };
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toKey(publicKey),
    });
  }
  return (await post<{ on: boolean }>(api(ref), { subscription: sub.toJSON(), on: true })).on;
}

export async function testPush(ref: RoomRef): Promise<void> {
  const sub = await existing();
  if (!sub) throw new Error('Turn alerts on first.');
  await post(api(ref, '/test'), { endpoint: sub.endpoint });
}
