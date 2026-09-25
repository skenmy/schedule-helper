// Duration parsing and time formatting.

const ISO_DURATION =
  /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/** Parses an ISO 8601 duration (`PT1H30M`, `P1DT2H`, `PT0.5S`) into whole seconds. */
export function parseIsoDuration(iso: string | null | undefined): number {
  if (!iso) return 0;
  const m = ISO_DURATION.exec(iso.trim());
  if (!m) return 0;
  const [, d = '0', h = '0', min = '0', s = '0'] = m;
  return Math.round(Number(d) * 86_400 + Number(h) * 3_600 + Number(min) * 60 + Number(s));
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `01:02:03` — timers and elapsed displays. Negative input clamps to zero. */
export function fmtHMS(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** `1:30` — estimates and other hour:minute durations. */
export function fmtHM(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec / 60) * 60);
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}`;
}

/** `+12:40`, `−1:02:03` — signed offsets. Uses a true minus sign. */
export function fmtDelta(totalSec: number): string {
  const sign = totalSec < 0 ? '−' : '+';
  const s = Math.abs(Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${sign}${h}:${pad(m)}:${pad(s % 60)}` : `${sign}${pad(m)}:${pad(s % 60)}`;
}

/** Short human offset: `+13m`, `−2h 05m`, `on time`. */
export function fmtOffsetShort(totalSec: number): string {
  const s = Math.abs(Math.round(totalSec / 60));
  if (s === 0) return 'on time';
  const sign = totalSec < 0 ? '−' : '+';
  return s >= 60 ? `${sign}${Math.floor(s / 60)}h ${pad(s % 60)}m` : `${sign}${s}m`;
}

const clockFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const clockSecFmt = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric' });

/** `14:02` in the viewer's local time zone. */
export function fmtClock(ms: number | null | undefined, withSeconds = false): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  return (withSeconds ? clockSecFmt : clockFmt).format(ms);
}

/** `Sat 24` — used to disambiguate times on multi-day marathons. */
export function fmtDay(ms: number): string {
  return dayFmt.format(ms);
}

/** Whether two epoch-ms instants fall on the same local calendar day. */
export function sameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/**
 * Parses operator-typed durations: `1:02:03`, `62:03` (m:ss), `45` (seconds).
 * Returns null for anything malformed.
 */
export function parseDurationInput(input: string): number | null {
  const parts = input.trim().split(':');
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  if (nums.length === 3) {
    const [h = 0, m = 0, s = 0] = nums;
    if (m >= 60 || s >= 60) return null;
    return h * 3600 + m * 60 + s;
  }
  if (nums.length === 2) {
    const [m = 0, s = 0] = nums;
    if (s >= 60) return null;
    return m * 60 + s;
  }
  return nums[0] ?? null;
}

/** `28h 08m`, `45m` — long durations where `28:08` would read like a clock time. */
export function fmtDuration(totalSec: number): string {
  const m = Math.max(0, Math.round(totalSec / 60));
  return m >= 60 ? `${Math.floor(m / 60)}h ${pad(m % 60)}m` : `${m}m`;
}
