// Grabs a single frame from a live Twitch channel: streamlink → ffmpeg → JPEG
// in memory. Nothing touches disk, so concurrent captures can't collide.

import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import { config } from '../config.ts';
import type { CaptureFrame } from '../rooms/room.ts';

const TIMEOUT_MS = 25_000;

export class CaptureError extends Error {}

export async function grabFrame(channel: string): Promise<CaptureFrame & { at: number }> {
  if (config.captureFrameFile) {
    const data = await fsp.readFile(config.captureFrameFile);
    const mediaType = /\.png$/i.test(config.captureFrameFile) ? 'image/png' : 'image/jpeg';
    return { data, mediaType, at: Date.now() };
  }

  return new Promise((resolve, reject) => {
    const sl = spawn(
      'streamlink',
      ['--stdout', `https://twitch.tv/${channel}`, '720p,720p60,best'],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const ff = spawn(
      'ffmpeg',
      [
        '-loglevel',
        'error',
        '-i',
        'pipe:0',
        '-frames:v',
        '1',
        '-f',
        'image2pipe',
        '-c:v',
        'mjpeg',
        '-q:v',
        '3',
        'pipe:1',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );

    let settled = false;
    const chunks: Buffer[] = [];
    let slErr = '';
    const finish = (err: Error | null, frame?: CaptureFrame & { at: number }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sl.kill('SIGKILL');
      ff.kill('SIGKILL');
      if (err) reject(err);
      else resolve(frame!);
    };

    const timer = setTimeout(
      () => finish(new CaptureError('Timed out waiting for a frame. Is the channel live?')),
      TIMEOUT_MS,
    );

    sl.stdout.pipe(ff.stdin);
    // ffmpeg exits after one frame while streamlink is still writing.
    ff.stdin.on('error', () => {});
    sl.stderr.on('data', (d: Buffer) => (slErr = (slErr + d.toString()).slice(-2_000)));
    ff.stdout.on('data', (d: Buffer) => chunks.push(d));

    sl.on('error', (err: NodeJS.ErrnoException) =>
      finish(
        new CaptureError(
          err.code === 'ENOENT' ? 'streamlink is not installed on the server.' : err.message,
        ),
      ),
    );
    ff.on('error', (err: NodeJS.ErrnoException) =>
      finish(
        new CaptureError(
          err.code === 'ENOENT' ? 'ffmpeg is not installed on the server.' : err.message,
        ),
      ),
    );
    sl.on('close', (code) => {
      if (code && !chunks.length) {
        const offline = /no playable streams|offline|404/i.test(slErr);
        finish(
          new CaptureError(
            offline
              ? `twitch.tv/${channel} is offline.`
              : `streamlink failed: ${slErr.trim().split('\n').at(-1) ?? code}`,
          ),
        );
      }
    });
    ff.on('close', (code) => {
      const data = Buffer.concat(chunks);
      if (code === 0 && data.length > 0)
        finish(null, { data, mediaType: 'image/jpeg', at: Date.now() });
      else finish(new CaptureError(`Couldn’t decode a frame from twitch.tv/${channel}.`));
    });
  });
}
