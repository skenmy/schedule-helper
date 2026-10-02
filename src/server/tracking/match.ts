// Which run a stream's Twitch category and title point at. Only the live run
// and the next few are candidates: a marathon moves forwards one run at a time,
// so anything else is far more likely a misread than a run change.

import { currentIndex, upcomingIndexes } from '../../shared/derive.ts';
import type { RoomState, RunKey, ScheduleLine } from '../../shared/types.ts';

/** How many runs past the live one a detection may point at. */
export const LOOKAHEAD = 3;

const squash = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '');
const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** The live run (if any) followed by the next LOOKAHEAD playable runs. */
export function candidateIndexes(
  lines: readonly ScheduleLine[],
  state: Pick<RoomState, 'currentKey' | 'runs' | 'finishedAt'>,
): number[] {
  if (state.finishedAt != null) return [];
  const cur = currentIndex(lines, state);
  // Never guess the live run: a current run that's gone from the schedule stops detection.
  if (state.currentKey && cur < 0) return [];
  const upcoming = upcomingIndexes(lines, state as RoomState, LOOKAHEAD);
  return cur >= 0 ? [cur, ...upcoming] : upcoming;
}

/** True when `words` contains `seq` as a run of consecutive whole words. */
function hasSequence(haystack: string[], seq: string[]): boolean {
  if (!seq.length) return false;
  outer: for (let i = 0; i + seq.length <= haystack.length; i++) {
    for (let j = 0; j < seq.length; j++) if (haystack[i + j] !== seq[j]) continue outer;
    return true;
  }
  return false;
}

export interface StreamMatch {
  key: RunKey;
  /** What matched, for the operator: `category “Spyro the Dragon”, runner gnasty in the title`. */
  detail: string;
}

/**
 * Scores each candidate run against the category and title. The category
 * naming the game is the strongest hint; the title naming the game or a
 * runner (as whole words) also counts, and separates back-to-back runs of
 * the same game. Ties go to the earliest candidate, so the live run wins over
 * a later run of the same game.
 */
export function matchStream(
  lines: readonly ScheduleLine[],
  state: Pick<RoomState, 'currentKey' | 'runs' | 'finishedAt'>,
  info: { game: string | null; title: string | null },
): StreamMatch | null {
  const category = squash(info.game ?? '');
  const titleSquashed = squash(info.title ?? '');
  const titleWords = words(info.title ?? '');
  const scored: { score: number; exact: boolean; key: RunKey; why: string[] }[] = [];

  for (const i of candidateIndexes(lines, state)) {
    const line = lines[i]!;
    const game = squash(line.game);
    if (!game) continue;
    let score = 0;
    let exact = false;
    const why: string[] = [];
    if (category && category === game) {
      score += 4;
      exact = true;
      why.push(`category “${info.game}”`);
    } else if (
      category.length >= 4 &&
      game.length >= 4 &&
      (category.includes(game) || game.includes(category))
    ) {
      score += 2;
      why.push(`category “${info.game}”`);
    }
    if (game.length >= 4 && titleSquashed.includes(game)) {
      score += 2;
      if (!why.length) why.push(`title names ${line.game}`);
    }
    const runner = line.runners.find((r) => {
      const seq = words(r);
      return seq.join('').length >= 3 && hasSequence(titleWords, seq);
    });
    if (runner) {
      score += 3;
      why.push(`runner ${runner} in the title`);
    }
    if (score >= 2) scored.push({ score, exact, key: line.key, why });
  }
  // A category naming a run's game exactly outranks any title: "Up next: SM64 with
  // ptkay" in the title of a stream still categorised as Celeste is still Celeste.
  const pool = scored.some((x) => x.exact) ? scored.filter((x) => x.exact) : scored;
  let best: (typeof scored)[number] | null = null;
  for (const x of pool) if (!best || x.score > best.score) best = x;
  if (!best) return null;
  const { key, why } = best;
  return { key, detail: why.join(', ') };
}
