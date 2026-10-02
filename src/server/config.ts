// Environment configuration, read once at startup.

import path from 'node:path';

const env = process.env;

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: int(env.PORT, 3000),
  dataDir: path.resolve(env.DATA_DIR || 'data'),
  /** Built client assets (vite build output). */
  clientDir: path.resolve(env.CLIENT_DIR || 'dist/client'),
  build: (env.BUILD_SHA || 'dev').slice(0, 12),
  isDev: env.NODE_ENV !== 'production',

  /** tools.skenmy.com forward-auth. Empty = everyone can write (local dev). */
  toolsAuthUrl: env.TOOLS_AUTH_URL || '',
  authAppId: env.AUTH_APP_ID || 'schedule',
  authLoginUrl: env.AUTH_LOGIN_URL || 'https://tools.skenmy.com/auth/twitch/login',
  authManageUrl: env.AUTH_MANAGE_URL || 'https://tools.skenmy.com/',
  /** Where tools.skenmy.com sends people back to after sign-in. */
  publicUrl: (env.PUBLIC_URL || 'https://schedule.skenmy.com').replace(/\/$/, ''),

  anthropicApiKey: env.ANTHROPIC_API_KEY || '',
  visionModel: env.VISION_MODEL || 'claude-sonnet-5',
  /** Dev/testing: serve this image instead of grabbing a live Twitch frame. */
  captureFrameFile: env.CAPTURE_FRAME_FILE || '',

  /** Twitch app credentials for auto-tracking (category and title). Empty: unavailable. */
  twitchClientId: env.TWITCH_CLIENT_ID || '',
  twitchClientSecret: env.TWITCH_CLIENT_SECRET || '',
  /** Dev/testing: read channel info from this JSON file instead of Twitch. */
  streamInfoFile: env.STREAM_INFO_FILE || '',
  /** Push notification keys. Empty: generated once and kept in DATA_DIR. */
  vapidPublicKey: env.VAPID_PUBLIC_KEY || '',
  vapidPrivateKey: env.VAPID_PRIVATE_KEY || '',
  /** Contact for push services (a mailto: or https URL). */
  vapidSubject: env.VAPID_SUBJECT || env.PUBLIC_URL || 'https://schedule.skenmy.com',
  /** Signs runner check-in links. Empty: generated once and kept in DATA_DIR. */
  checkinSecret: env.CHECKIN_SECRET || '',
  /** How often auto-tracking polls Twitch. */
  trackingTickMs: int(env.TRACKING_TICK_MS, 30_000),
} as const;

export type Config = typeof config;
