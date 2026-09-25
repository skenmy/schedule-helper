<script lang="ts">
  import { lineTitle } from '../../../shared/derive.ts';
  import { fmtClock, fmtDay, fmtHM, runStatus, type RunStatus } from '../../lib/format.ts';
  import { getLive } from '../../lib/live.svelte.ts';
  import { prefs } from '../../lib/prefs.svelte.ts';
  import { ui } from '../../lib/ui.svelte.ts';
  import Segmented from '../ui/Segmented.svelte';

  const live = getLive();
  const HOUR = 3_600_000;
  const SNAP = 5 * 60_000;
  const ZOOMS = [
    { value: '3', label: '3h' },
    { value: '6', label: '6h' },
    { value: '12', label: '12h' },
    { value: '0', label: 'All' },
  ] as const;
  let zoom = $state(String(prefs.zoomHours) as (typeof ZOOMS)[number]['value']);
  $effect(() => {
    prefs.zoomHours = Number(zoom);
  });

  // Snap the window so blocks don't shimmer every tick; only the now line moves.
  const win = $derived.by(() => {
    const now = Math.floor(live.now / SNAP) * SNAP;
    const s = live.stats;
    if (prefs.zoomHours === 0 || s.scheduledStart == null) {
      const start = Math.min(s.scheduledStart ?? now, now);
      const end = Math.max(s.scheduledEnd ?? now + HOUR, live.projectedEnd ?? 0, now);
      const pad = Math.max((end - start) * 0.015, SNAP);
      return { start: start - pad, end: end + pad };
    }
    const span = prefs.zoomHours * HOUR;
    const start = now - span * 0.25;
    return { start, end: start + span };
  });
  const span = $derived(win.end - win.start);
  const pct = (t: number) => ((t - win.start) / span) * 100;

  interface Block {
    id: string;
    key: string;
    left: number;
    width: number;
    kind: 'run' | 'setup' | 'interlude';
    status: RunStatus;
    label: string;
    meta: string;
    title: string;
    missing: boolean;
    progress: number | null;
  }

  function place(start: number, end: number): { left: number; width: number } | null {
    if (end <= win.start || start >= win.end || end <= start) return null;
    const left = pct(Math.max(start, win.start));
    return { left, width: pct(Math.min(end, win.end)) - left };
  }

  const plan = $derived.by(() => {
    const out: Block[] = [];
    live.lines.forEach((line, i) => {
      if (line.scheduledStart == null) return;
      const status = runStatus(live, i);
      const end = line.scheduledStart + line.estimateSec * 1000;
      const pos = place(line.scheduledStart, end);
      if (pos) {
        out.push({
          id: `p${line.key}`,
          key: line.key,
          ...pos,
          kind: line.setupBlock ? 'interlude' : 'run',
          status,
          label: lineTitle(line),
          meta: fmtHM(line.estimateSec),
          title: `${lineTitle(line)} · scheduled ${fmtClock(line.scheduledStart)}–${fmtClock(end)}`,
          missing: live.state.runs[line.key]?.checkIn === 'missing',
          progress: null,
        });
      }
      const setup = line.setupBlock ? null : place(end, end + line.setupSec * 1000);
      if (setup) {
        out.push({
          id: `ps${line.key}`,
          key: line.key,
          ...setup,
          kind: 'setup',
          status,
          label: '',
          meta: '',
          title: `Setup after ${lineTitle(line)} · ${fmtHM(line.setupSec)}`,
          missing: false,
          progress: null,
        });
      }
    });
    return out;
  });

  const actual = $derived.by(() => {
    const out: Block[] = [];
    live.lines.forEach((line, i) => {
      const status = runStatus(live, i);
      let start: number | undefined;
      let end: number | undefined;
      const rec = live.state.runs[line.key];
      if (status === 'done' && rec?.startedAt != null && rec.endedAt != null) {
        start = rec.startedAt;
        end = rec.endedAt;
      } else if (live.projection[i]) {
        start = live.projection[i]!.start;
        end = live.projection[i]!.end;
      }
      if (start == null || end == null) return;
      const pos = place(start, end);
      if (!pos) return;
      const est = line.estimateSec * 1000;
      out.push({
        id: `l${line.key}`,
        key: line.key,
        ...pos,
        kind: line.setupBlock ? 'interlude' : 'run',
        status,
        label: lineTitle(line),
        meta: status === 'current' ? '' : fmtClock(start),
        title: `${lineTitle(line)} · ${status === 'done' ? 'ran' : 'projected'} ${fmtClock(start)}–${fmtClock(end)}`,
        missing: rec?.checkIn === 'missing',
        progress:
          status === 'current' && live.timing?.phase !== 'setup' && est > 0
            ? Math.min(1, live.timing!.elapsedMs / est)
            : null,
      });
    });
    return out;
  });

  const ticks = $derived.by(() => {
    const hours = span / HOUR;
    const step = hours <= 7 ? 1 : hours <= 14 ? 2 : hours <= 36 ? 4 : hours <= 72 ? 8 : 12;
    const out: { t: number; label: string; day: boolean }[] = [];
    const s = new Date(win.start);
    // Build each local hour from its components so DST changes land correctly.
    for (let k = 0; ; k++) {
      const d = new Date(s.getFullYear(), s.getMonth(), s.getDate(), s.getHours() + k);
      const t = d.getTime();
      if (t > win.end) break;
      if (t >= win.start && d.getHours() % step === 0) {
        const day = d.getHours() === 0;
        out.push({ t, label: day ? fmtDay(t) : fmtClock(t), day });
      }
    }
    return out;
  });

  const nowPct = $derived(pct(live.now));
</script>

<section class="timeline" aria-label="Timeline">
  <header>
    <span class="label">Timeline</span>
    <div class="legend">
      <span><i class="sw done"></i>Done</span>
      <span><i class="sw current"></i>Live</span>
      <span><i class="sw upcoming"></i>Upcoming</span>
      <span><i class="sw setup"></i>Setup</span>
      <span><i class="sw missing"></i>Runner missing</span>
    </div>
    <Segmented label="Zoom" size="sm" options={ZOOMS} bind:value={zoom} />
  </header>

  <div class="grid">
    <div class="gutter">
      <span></span>
      <span class="label">Plan</span>
      <span class="label">Live</span>
    </div>
    <div class="track">
      <div class="ticks">
        {#each ticks as tick (tick.t)}
          <span class="tick" class:day={tick.day} style:left="{pct(tick.t)}%"
            ><em>{tick.label}</em></span
          >
        {/each}
      </div>
      <div class="lane">
        {#each plan as b (b.id)}
          <button
            class="blk {b.kind} {b.status}"
            class:missing={b.missing}
            style:left="{b.left}%"
            style:width="{b.width}%"
            title={b.title}
            aria-label={b.title}
            onclick={() => (ui.runSheet = b.key)}
          >
            {#if b.width > 4 && b.label}<span class="name">{b.label}</span><span class="meta num"
                >{b.meta}</span
              >{/if}
          </button>
        {/each}
      </div>
      <div class="lane">
        {#each actual as b (b.id)}
          <button
            class="blk {b.kind} {b.status}"
            class:missing={b.missing}
            style:left="{b.left}%"
            style:width="{b.width}%"
            title={b.title}
            aria-label={b.title}
            onclick={() => (ui.runSheet = b.key)}
          >
            {#if b.progress != null}<span class="fill" style:width="{b.progress * 100}%"
              ></span>{/if}
            {#if b.width > 4}<span class="name">{b.label}</span><span class="meta num"
                >{b.meta}</span
              >{/if}
          </button>
        {/each}
      </div>
      {#if nowPct >= 0 && nowPct <= 100}
        <div class="now" style:left="{nowPct}%"><span class="num">{fmtClock(live.now)}</span></div>
      {/if}
    </div>
  </div>
</section>

<style>
  .timeline {
    padding: 14px var(--gutter) 16px;
    border-bottom: 1px solid var(--border);
  }
  header {
    display: flex;
    align-items: center;
    gap: 18px;
    margin-bottom: 10px;
  }
  .legend {
    flex: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    font-size: 12px;
    color: var(--muted);
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .sw {
    width: 12px;
    height: 10px;
    border-radius: 3px;
    display: inline-block;
  }
  .sw.done {
    background: var(--surface-3);
  }
  .sw.current {
    background: var(--accent);
  }
  .sw.upcoming {
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
  }
  .sw.setup {
    background: repeating-linear-gradient(135deg, var(--border-strong) 0 2px, transparent 2px 5px);
  }
  .sw.missing {
    background: var(--bad);
  }
  .grid {
    display: grid;
    grid-template-columns: 44px 1fr;
    gap: 8px;
  }
  .gutter {
    display: grid;
    grid-template-rows: 20px 44px 44px;
    gap: 6px;
    align-items: center;
  }
  .gutter .label {
    font-size: 9.5px;
  }
  .track {
    position: relative;
    display: grid;
    grid-template-rows: 20px 44px 44px;
    gap: 6px;
    overflow: hidden;
  }
  .ticks {
    position: relative;
  }
  .tick {
    position: absolute;
    top: 0;
    bottom: -110px;
    border-left: 1px dashed color-mix(in oklab, var(--border-strong) 70%, transparent);
    pointer-events: none;
  }
  .tick.day {
    border-left: 1px solid var(--border-strong);
  }
  .tick em {
    position: absolute;
    top: 2px;
    left: 5px;
    font-style: normal;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--muted);
    white-space: nowrap;
  }
  .tick.day em {
    color: var(--text-2);
    font-weight: 600;
  }
  .lane {
    position: relative;
    border-radius: 8px;
    background: var(--bg-2);
  }
  .blk {
    position: absolute;
    top: 3px;
    bottom: 3px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 1px;
    min-width: 2px;
    padding: 0 7px;
    overflow: hidden;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--surface-2);
    color: var(--text-2);
    text-align: left;
    cursor: pointer;
    transition: filter 0.15s;
  }
  .blk:hover {
    filter: brightness(1.25);
    z-index: 2;
  }
  .name {
    position: relative;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .meta {
    position: relative;
    font-size: 10px;
    color: var(--muted);
    white-space: nowrap;
  }
  .blk.done {
    background: var(--surface);
    border-color: var(--border);
    color: var(--muted);
  }
  .blk.current {
    background: color-mix(in oklab, var(--accent) 22%, var(--surface));
    border-color: var(--accent);
    color: var(--text);
    box-shadow: 0 0 18px -6px var(--accent);
  }
  .blk.current .fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: color-mix(in oklab, var(--accent) 35%, transparent);
  }
  .blk.skipped {
    opacity: 0.45;
    text-decoration: line-through;
    border-style: dashed;
  }
  .blk.setup {
    background: repeating-linear-gradient(135deg, var(--border) 0 2px, transparent 2px 6px);
    border-color: transparent;
    top: 12px;
    bottom: 12px;
  }
  .blk.interlude {
    background: repeating-linear-gradient(135deg, var(--warn-soft) 0 4px, transparent 4px 9px);
    border-color: color-mix(in oklab, var(--warn) 30%, transparent);
    color: var(--warn);
  }
  .blk.missing {
    box-shadow: inset 3px 0 0 var(--bad);
  }
  .now {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--text);
    pointer-events: none;
    z-index: 3;
  }
  .now span {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--text);
    color: var(--bg);
    font-size: 10.5px;
    font-weight: 700;
    white-space: nowrap;
  }
  @media (max-width: 820px) {
    .legend {
      display: none;
    }
    header {
      justify-content: space-between;
    }
  }
</style>
