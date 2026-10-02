<script lang="ts">
  import { ON_SCHEDULE_WINDOW_SEC as W, scheduleStatus } from '../../../shared/derive.ts';
  import type { ReportRow } from '../../../shared/report.ts';
  import { timeTicks } from '../../lib/chart.ts';
  import { fmtAhead, fmtClock, fmtDay, fmtWhen } from '../../lib/format.ts';

  /**
   * How far ahead (up) or behind (down) of schedule each run started, through
   * the event. One series against a zero baseline, in the console's three
   * states: within ±15 minutes is on schedule (neutral), beyond it ahead (blue)
   * or behind (red), over washes labelled "Ahead" and "Behind" so colour is
   * never the only cue. Hover, drag or arrow keys step through the runs; the
   * table under it has every number.
   */
  let { rows, now }: { rows: readonly ReportRow[]; now: number } = $props();

  type Point = ReportRow & { startedAt: number; startDeltaSec: number };
  const id = $props.id();

  const pts = $derived(
    rows
      .filter((r): r is Point => r.startedAt != null && r.startDeltaSec != null)
      .sort((a, b) => a.startedAt - b.startedAt),
  );

  let width = $state(0);
  const height = $derived(width < 520 ? 200 : 260);
  const M = { top: 14, right: 16, bottom: 26, left: 48 };
  const iw = $derived(Math.max(0, width - M.left - M.right));
  const ih = $derived(height - M.top - M.bottom);

  const xDomain = $derived.by((): [number, number] => {
    if (!pts.length) return [0, 1];
    let a = pts[0]!.startedAt;
    let b = pts.at(-1)!.startedAt;
    const minSpan = 30 * 60_000;
    if (b - a < minSpan) {
      const mid = (a + b) / 2;
      a = mid - minSpan / 2;
      b = mid + minSpan / 2;
    }
    const pad = (b - a) * 0.03;
    return [a - pad, b + pad];
  });

  /**
   * Always shows at least twice the on-schedule window, so the ahead and behind
   * zones are visible and an on-time event reads as flat, not as noise.
   */
  const yAxis = $derived.by(() => {
    const values = pts.map((p) => p.startDeltaSec);
    const lo = Math.min(-2 * W, ...values);
    const hi = Math.max(2 * W, ...values);
    const most = height < 230 ? 4 : 6;
    const step =
      [5, 15, 30, 60, 120, 240, 480]
        .map((m) => m * 60)
        .find((s) => Math.ceil(hi / s) - Math.floor(lo / s) <= most) ??
      Math.ceil((hi - lo) / most / 3600) * 3600;
    const top = Math.ceil(hi / step) * step;
    const bottom = Math.floor(lo / step) * step;
    const ticks: number[] = [];
    for (let v = bottom; v <= top; v += step) ticks.push(v);
    return { top, bottom, ticks };
  });

  const x = (t: number) => M.left + ((t - xDomain[0]) / (xDomain[1] - xDomain[0])) * iw;
  const y = (v: number) => M.top + ((yAxis.top - v) / (yAxis.top - yAxis.bottom)) * ih;

  /** Time ticks on local clock boundaries, about one per 84px; midnight shows the day. */
  const xTicks = $derived(timeTicks(xDomain[0], xDomain[1], Math.floor(iw / 84)));
  const xLabel = (t: number) => {
    const d = new Date(t);
    return d.getHours() === 0 && d.getMinutes() === 0 ? fmtDay(t) : fmtClock(t);
  };
  function yLabel(v: number): string {
    if (v === 0) return '0';
    const m = Math.abs(v) / 60;
    const sign = v > 0 ? '+' : '−';
    if (m < 60) return `${sign}${m}m`;
    const rest = m % 60;
    return `${sign}${Math.floor(m / 60)}h${rest ? String(rest).padStart(2, '0') : ''}`;
  }

  const path = $derived(
    pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.startedAt)},${y(p.startDeltaSec)}`).join(''),
  );
  /** Markers on every run only while they have room; the hovered one always shows. */
  const dots = $derived(pts.length > 0 && iw / pts.length >= 14);
  const tone = (p: Point) => `tone-${scheduleStatus(p.startDeltaSec)}`;
  const STATUS = { on: 'on schedule', ahead: 'ahead', behind: 'behind' } as const;

  /** Direct labels for the two numbers people ask for: where it ended up, and the worst it got. */
  const labels = $derived.by(() => {
    const last = pts.at(-1);
    if (!last) return [];
    const out: { p: Point; above: boolean }[] = [{ p: last, above: true }];
    const worst = pts.reduce((w, p) => (p.startDeltaSec < w.startDeltaSec ? p : w), last);
    if (
      worst !== last &&
      worst.startDeltaSec < -60 &&
      Math.abs(x(worst.startedAt) - x(last.startedAt)) > 110
    ) {
      out.push({ p: worst, above: false });
    }
    return out.map(({ p, above }) => {
      const px = x(p.startedAt);
      const py = y(p.startDeltaSec);
      // Keep labels inside the plot: flip when there's no room on the preferred side.
      const up = above ? py - 12 > M.top + 8 : py + 20 > M.top + ih;
      return {
        p,
        x: px,
        y: up ? py - 12 : py + 20,
        anchor: px > M.left + iw * 0.8 ? 'end' : px < M.left + iw * 0.2 ? 'start' : 'middle',
      };
    });
  });

  // ── Hover, touch and keyboard ───────────────────────────────────────────────
  let active = $state<number | null>(null);
  let el = $state<HTMLDivElement>();
  let tipWidth = $state(0);
  const shown = $derived(active != null ? pts[active] : undefined);

  function pick(e: PointerEvent) {
    if (!el || !pts.length) return;
    const px = e.clientX - el.getBoundingClientRect().left;
    let best = 0;
    for (let i = 1; i < pts.length; i++) {
      if (Math.abs(x(pts[i]!.startedAt) - px) < Math.abs(x(pts[best]!.startedAt) - px)) best = i;
    }
    active = best;
  }

  function onkeydown(e: KeyboardEvent) {
    if (!pts.length) return;
    const last = pts.length - 1;
    const cur = active ?? last;
    const next =
      e.key === 'ArrowLeft' || e.key === 'ArrowDown'
        ? Math.max(0, cur - 1)
        : e.key === 'ArrowRight' || e.key === 'ArrowUp'
          ? Math.min(last, cur + 1)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (e.key === 'Escape') active = null;
    if (next == null) return;
    e.preventDefault();
    active = next;
  }

  const describe = (p: Point | undefined) =>
    p
      ? `${p.number != null ? `Run ${p.number}, ` : ''}${p.title}: started ${fmtWhen(p.startedAt, now)}, ${fmtAhead(p.startDeltaSec)}`
      : 'No runs have started';
  const tipLeft = $derived.by(() => {
    if (!shown) return 0;
    const px = x(shown.startedAt);
    return px + 14 + tipWidth <= width ? px + 14 : Math.max(0, px - 14 - tipWidth);
  });
</script>

{#if pts.length}
  <div
    class="chart"
    bind:this={el}
    bind:clientWidth={width}
    role="slider"
    tabindex="0"
    aria-label="Start against schedule, by run"
    aria-valuemin={1}
    aria-valuemax={pts.length}
    aria-valuenow={(active ?? pts.length - 1) + 1}
    aria-valuetext={describe(shown ?? pts.at(-1))}
    style:min-height={width ? null : `${height}px`}
    onpointermove={pick}
    onpointerdown={pick}
    onpointerleave={(e) => {
      if (e.pointerType !== 'touch') active = null;
    }}
    onpointercancel={() => (active = null)}
    onfocus={() => (active ??= pts.length - 1)}
    onblur={() => (active = null)}
    {onkeydown}
  >
    {#if width > 0}
      <!-- Drawn in on-screen pixels, but scales to whatever width it's given (print). -->
      <svg viewBox="0 0 {width} {height}" aria-hidden="true">
        <defs>
          <clipPath id="{id}-ahead">
            <rect x="0" y="0" {width} height={Math.max(0, y(W))} />
          </clipPath>
          <clipPath id="{id}-on">
            <rect x="0" y={y(W)} {width} height={Math.max(0, y(-W) - y(W))} />
          </clipPath>
          <clipPath id="{id}-behind">
            <rect x="0" y={y(-W)} {width} height={Math.max(0, height - y(-W))} />
          </clipPath>
        </defs>

        <rect
          class="wash ahead"
          x={M.left}
          y={M.top}
          width={iw}
          height={Math.max(0, y(W) - M.top)}
        />
        <rect
          class="wash behind"
          x={M.left}
          y={y(-W)}
          width={iw}
          height={Math.max(0, M.top + ih - y(-W))}
        />

        {#each yAxis.ticks as v (v)}
          <line
            class={v === 0 ? 'zero' : 'grid'}
            x1={M.left}
            x2={M.left + iw}
            y1={y(v)}
            y2={y(v)}
          />
          <text class="tick" x={M.left - 8} y={y(v)} dy="0.32em" text-anchor="end">{yLabel(v)}</text
          >
        {/each}
        {#each xTicks as t (t)}
          <text class="tick" x={x(t)} y={height - 6} text-anchor="middle">{xLabel(t)}</text>
        {/each}
        <text class="caption" x={M.left + 8} y={M.top + 14}>Ahead</text>
        <text class="caption" x={M.left + 8} y={M.top + ih - 8}>Behind</text>

        {#if shown}
          <line
            class="crosshair"
            x1={x(shown.startedAt)}
            x2={x(shown.startedAt)}
            y1={M.top}
            y2={M.top + ih}
          />
        {/if}

        <path class="line ahead" d={path} clip-path="url(#{id}-ahead)" />
        <path class="line on" d={path} clip-path="url(#{id}-on)" />
        <path class="line behind" d={path} clip-path="url(#{id}-behind)" />

        {#if dots}
          {#each pts as p (p.key)}
            <circle class="mark {tone(p)}" cx={x(p.startedAt)} cy={y(p.startDeltaSec)} r="4.5" />
          {/each}
        {/if}
        {#if shown}
          <circle
            class="mark active {tone(shown)}"
            cx={x(shown.startedAt)}
            cy={y(shown.startDeltaSec)}
            r="6"
          />
        {/if}

        {#each labels as l (l.p.key)}
          <text class="direct" x={l.x} y={l.y} text-anchor={l.anchor}
            >{fmtAhead(l.p.startDeltaSec)}</text
          >
        {/each}
      </svg>
    {/if}

    {#if shown}
      <div
        class="tip"
        bind:clientWidth={tipWidth}
        style:left="{tipLeft}px"
        style:top="{M.top}px"
        aria-hidden="true"
      >
        <b>{shown.number != null ? `#${shown.number} ` : ''}{shown.title}</b>
        {#if shown.runners.length}<span class="muted">{shown.runners.join(', ')}</span>{/if}
        <span
          >Started {fmtWhen(shown.startedAt, now)}{shown.scheduledStart != null
            ? ` · scheduled ${fmtWhen(shown.scheduledStart, now)}`
            : ''}</span
        >
        <span class="v {tone(shown)}"
          ><i class="swatch"></i>{fmtAhead(shown.startDeltaSec)}
          <small>· {STATUS[scheduleStatus(shown.startDeltaSec)]}</small></span
        >
      </div>
    {/if}
  </div>
{:else}
  <p class="empty muted">The chart fills in as runs start.</p>
{/if}

<style>
  .chart {
    position: relative;
    touch-action: pan-y;
    border-radius: var(--radius);
    outline: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .chart:focus-visible {
    box-shadow: var(--ring);
  }
  svg {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
  }
  .wash {
    opacity: 0.07;
  }
  .wash.ahead {
    fill: var(--info);
  }
  .wash.behind {
    fill: var(--bad);
  }
  .grid {
    stroke: var(--border);
    stroke-width: 1;
  }
  .zero {
    stroke: var(--muted);
    stroke-width: 1;
  }
  .tick {
    fill: var(--muted);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .caption {
    fill: var(--muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .line {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .line.ahead {
    stroke: var(--info);
  }
  .line.behind {
    stroke: var(--bad);
  }
  /* On schedule is neutral here, not the console's green: green beside red is
     the pair colour-blind readers can't separate. */
  .line.on {
    stroke: var(--text-2);
  }
  .tone-on {
    --tone: var(--text-2);
  }
  .crosshair {
    stroke: var(--muted);
    stroke-width: 1;
    stroke-dasharray: 3 3;
  }
  .mark {
    fill: var(--tone);
    stroke: var(--surface);
    stroke-width: 2;
  }
  .direct {
    fill: var(--text-2);
    font-size: 11.5px;
    font-weight: 600;
    paint-order: stroke;
    stroke: var(--surface);
    stroke-width: 4px;
    stroke-linejoin: round;
  }
  .tip {
    position: absolute;
    z-index: 2;
    display: grid;
    gap: 2px;
    width: max-content;
    max-width: min(280px, 80%);
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-lg);
    font-size: 12.5px;
    color: var(--text-2);
    pointer-events: none;
  }
  .tip b {
    color: var(--text);
    font-weight: 600;
  }
  .tip .v {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text);
    font-weight: 600;
  }
  .tip .v small {
    color: var(--muted);
    font-weight: 500;
    font-size: 12px;
  }
  .swatch {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--tone);
  }
  .empty {
    padding: 32px 0;
    text-align: center;
  }
  @media print {
    .tip,
    .crosshair,
    .mark.active {
      display: none;
    }
  }
</style>
