// Reads the run timer, estimate and game from a stream frame with Claude,
// using structured outputs so the reply is schema-valid JSON.

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { Confidence } from '../../shared/types.ts';
import { config } from '../config.ts';
import type { CaptureFrame } from '../rooms/room.ts';

// Kept deliberately plain: the SDK's schema transform turns enums into
// description hints, so confidence is normalised below instead.
const Reading = z.object({
  elapsed: z.string().nullable(),
  estimate: z.string().nullable(),
  game: z.string().nullable(),
  confidence: z.string(),
});

function toConfidence(value: string): Confidence {
  const v = value.trim().toLowerCase();
  return v === 'high' || v === 'medium' || v === 'low' ? v : 'low';
}

export interface VisionReading {
  elapsedSec: number | null;
  estimateSec: number | null;
  game: string | null;
  confidence: Confidence;
}

let client: Anthropic | null = null;

function prompt(gameNames: string[]): string {
  const list = gameNames.length
    ? gameNames.map((g) => `- ${g}`).join('\n')
    : '(no schedule loaded)';
  return `This is one frame from the Twitch broadcast of a speedrunning marathon.

Read these from the stream overlay:
1. elapsed: the run timer counting up in real time. It is usually the largest timer on screen, sometimes labelled TIMER or ELAPSED. Ignore the wall clock, game-internal timers and splits. Report H:MM:SS, dropping fractions of a second.
2. estimate: the run's estimate, usually labelled EST, ESTIMATE or GOAL. Same format. Null if you can't see one.
3. game: the game being played, matched to the schedule below. Overlays usually show the full title. Return the name exactly as written in the list, or null if nothing on screen plausibly matches.
4. confidence: "high", "medium" or "low" — how sure you are of the elapsed reading and the game.

Schedule:
${list}`;
}

/** `1:02:03`, `41:05.3` or `00:41:05` → seconds. */
export function parseTimer(value: string | null): number | null {
  if (!value) return null;
  const m = /(?:(\d{1,3}):)?(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return null;
  const [, h = '0', mm = '0', ss = '0'] = m;
  if (Number(mm) >= 60 || Number(ss) >= 60) return null;
  return Number(h) * 3600 + Number(mm) * 60 + Number(ss);
}

export async function readFrame(frame: CaptureFrame, gameNames: string[]): Promise<VisionReading> {
  if (!config.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is not set on the server.');
  client ??= new Anthropic({ apiKey: config.anthropicApiKey, timeout: 30_000, maxRetries: 1 });

  let response;
  try {
    response = await client.messages.parse({
      model: config.visionModel,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: frame.mediaType,
                data: frame.data.toString('base64'),
              },
            },
            { type: 'text', text: prompt(gameNames) },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(Reading) },
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      throw new Error(`Claude API error ${err.status ?? ''}: ${err.message}`.trim(), {
        cause: err,
      });
    }
    throw err;
  }

  const reading = response.parsed_output;
  if (!reading) throw new Error(`Couldn’t read the frame (stop reason: ${response.stop_reason}).`);
  return {
    elapsedSec: parseTimer(reading.elapsed),
    estimateSec: parseTimer(reading.estimate),
    game: reading.game?.trim() || null,
    confidence: toConfidence(reading.confidence),
  };
}
