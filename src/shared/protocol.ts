// WebSocket protocol. The zod schemas validate every inbound client message on
// the server; the client only imports the inferred types (type-only imports
// keep zod out of the browser bundle).

import { z } from 'zod';
import { ID_PATTERN, SOURCES } from './sources.ts';
import type { AuthInfo, RoomRef, RoomState, Schedule, UndoInfo } from './types.ts';

export const RoomRefSchema = z.object({
  source: z.enum(SOURCES),
  event: z.string().regex(ID_PATTERN),
  slug: z.string().regex(ID_PATTERN),
});

const runKey = z.string().min(1).max(80);
const color = z.string().regex(/^#[0-9a-fA-F]{3,8}$/);
const epochMs = z.number().int().min(0).max(8.64e15);
const text = (max: number) => z.string().trim().min(1).max(max);

export const ClientActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('join'), ref: RoomRefSchema }),
  z.object({ action: z.literal('ping'), t: z.number() }),

  z.object({ action: z.literal('timer:start') }),
  z.object({ action: z.literal('timer:stop') }),
  z.object({ action: z.literal('timer:reset') }),
  z.object({
    action: z.literal('timer:set'),
    seconds: z
      .number()
      .int()
      .min(0)
      .max(7 * 86_400),
  }),

  z.object({ action: z.literal('run:select'), key: runKey }),
  z.object({ action: z.literal('run:advance') }),
  z.object({ action: z.literal('run:back') }),
  z.object({ action: z.literal('run:skip'), key: runKey.optional() }),
  z.object({ action: z.literal('run:unskip'), key: runKey }),
  z.object({
    action: z.literal('run:edit'),
    key: runKey,
    startedAt: epochMs.nullable(),
    endedAt: epochMs.nullable(),
  }),
  z.object({
    action: z.literal('runner:checkin'),
    key: runKey,
    status: z.enum(['ready', 'missing']).nullable(),
  }),

  z.object({
    action: z.literal('log:add'),
    text: text(500),
    kind: z.enum(['note', 'tech', 'runner']),
  }),
  z.object({ action: z.literal('log:remove'), id: z.number().int() }),
  z.object({ action: z.literal('log:clear') }),

  z.object({ action: z.literal('twitch:set'), channel: z.string().trim().max(200) }),
  z.object({ action: z.literal('message:set'), text: text(280), color }),
  z.object({ action: z.literal('message:clear') }),
  z.object({ action: z.literal('announcement:set'), text: text(500), color }),
  z.object({ action: z.literal('announcement:clear') }),

  z.object({
    action: z.literal('drift:configure'),
    enabled: z.boolean(),
    intervalMin: z.number().int().min(1).max(60),
    thresholdSec: z.number().int().min(2).max(600),
  }),
  z.object({ action: z.literal('capture:run') }),
  z.object({ action: z.literal('capture:apply') }),

  z.object({ action: z.literal('schedule:refresh') }),
  /** Back to a fresh start: clears progress, log, broadcasts and undo; keeps settings. */
  z.object({ action: z.literal('room:reset') }),
  /** `id` names the change the operator saw; a different latest change is left alone. */
  z.object({ action: z.literal('undo'), id: z.number().int().optional() }),
]);

export type ClientAction = z.infer<typeof ClientActionSchema>;
export type ActionName = ClientAction['action'];
/** Actions that change room state (everything except the session plumbing). */
export type MutatingAction = Exclude<ClientAction, { action: 'join' | 'ping' }>;

export function isMutating(action: ClientAction): action is MutatingAction {
  return action.action !== 'join' && action.action !== 'ping';
}

export type ErrorCode =
  | 'signin_required'
  | 'forbidden'
  | 'invalid'
  | 'not_found'
  | 'upstream'
  | 'conflict'
  | 'not_joined';

export type ServerMessage =
  | { type: 'hello'; build: string; serverTime: number }
  | { type: 'auth'; auth: AuthInfo }
  | { type: 'joined'; ref: RoomRef }
  | { type: 'schedule'; schedule: Schedule; by: string | null }
  | { type: 'state'; state: RoomState }
  | { type: 'presence'; count: number }
  | { type: 'pong'; t: number; serverTime: number }
  /** Reply to a mutating action sent with a request id (`rid`). */
  | { type: 'applied'; rid: string; undo: UndoInfo | null }
  | { type: 'error'; code: ErrorCode; message: string; action?: string; rid?: string };
