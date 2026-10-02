// Axis helpers for the report chart (components/report/DeltaChart.svelte).

const MIN = 60_000;
/** Steps in minutes under a day; whole days above. */
const STEPS_MIN = [15, 30, 60, 120, 180, 360, 720];
const STEPS_DAY = [1, 2, 7, 14];

/**
 * Time-axis ticks between `a` and `b`, at most about `most` of them, on local
 * wall-clock boundaries: 18:00, 21:00, Sat 00:00… Built from calendar fields,
 * not fixed milliseconds, so ticks stay on the hour across a clock change.
 */
export function timeTicks(a: number, b: number, most: number): number[] {
  if (!(b > a)) return [];
  const span = b - a;
  const limit = Math.max(2, most);
  const start = new Date(a);
  const [y, m, d] = [start.getFullYear(), start.getMonth(), start.getDate()];
  const at = (k: number, step: { min?: number; days?: number }) =>
    step.days
      ? new Date(y, m, d + k * step.days).getTime()
      : new Date(y, m, d, 0, k * step.min!).getTime();

  const minutes = STEPS_MIN.find((s) => span / (s * MIN) <= limit);
  const step = minutes
    ? { min: minutes }
    : {
        days:
          STEPS_DAY.find((s) => span / (s * 1440 * MIN) <= limit) ??
          Math.ceil(span / (1440 * MIN) / limit),
      };
  const out: number[] = [];
  for (let k = 0; out.length <= limit + 2; k++) {
    const t = at(k, step);
    if (t > b) break;
    if (t >= a) out.push(t);
  }
  return out;
}
