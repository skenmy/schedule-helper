<script lang="ts">
  import { Search } from '@lucide/svelte';
  import { lineTitle, upcomingIndexes } from '../../../shared/derive.ts';
  import { roomPath } from '../../../shared/sources.ts';
  import { checkinTokens, checkinUrl } from '../../lib/checkin.ts';
  import { fmtClock, fmtWhen } from '../../lib/format.ts';
  import { kioskUrl } from '../../lib/kiosk.ts';
  import { LAYOUT_PREFS } from '../../lib/layout.ts';
  import { layout } from '../../lib/layout.svelte.ts';
  import { getLive, getOps } from '../../lib/live.svelte.ts';
  import { prefs, THEMES } from '../../lib/prefs.svelte.ts';
  import { reportPath } from '../../lib/report.ts';
  import { getRoom } from '../../lib/room.svelte.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { toasts } from '../../lib/toasts.svelte.ts';
  import { ui, type TabId } from '../../lib/ui.svelte.ts';

  const room = getRoom();
  const live = getLive();
  const ops = getOps();

  interface Item {
    id: string;
    group: 'Actions' | 'Go to' | 'Runs';
    label: string;
    hint?: string;
    kbd?: string;
    write?: boolean;
    run: () => void;
  }

  let el: HTMLDialogElement;
  let query = $state('');
  let active = $state(0);
  let list = $state<HTMLElement>();

  $effect(() => {
    if (ui.palette && !el.open) {
      query = '';
      active = 0;
      el.showModal();
    } else if (!ui.palette && el.open) el.close();
  });

  /** Every upcoming run's check-in link, one block per run, ready to paste into a chat. */
  async function copyCheckinLinks() {
    try {
      const tokens = await checkinTokens(room.ref);
      const blocks = upcomingIndexes(live.lines, live.state, live.lines.length)
        .filter((i) => tokens[live.lines[i]!.key] && live.lines[i]!.runners.length)
        .map((i) => {
          const line = live.lines[i]!;
          const at = fmtWhen(live.projection[i]?.start, live.now);
          const who = line.runners.join(', ');
          return `${lineTitle(line)} (${who}) · ${at}\n${checkinUrl(room.ref, line.key, tokens[line.key]!)}`;
        });
      if (!blocks.length) {
        toasts.push({ kind: 'info', title: 'No upcoming runs to send links for' });
        return;
      }
      await navigator.clipboard.writeText(blocks.join('\n\n'));
      toasts.push({
        kind: 'success',
        title: `Copied ${blocks.length} check-in link${blocks.length === 1 ? '' : 's'}`,
        body: 'One per upcoming run. Each only works for its own run.',
      });
    } catch (err) {
      toasts.push({
        kind: 'error',
        title: 'Couldn’t copy the links',
        body: (err as Error).message,
      });
    }
  }

  const tab = (id: TabId, label: string): Item => ({
    id: `tab-${id}`,
    group: 'Go to',
    label,
    run: () => ui.openTab(id),
  });

  const commands = $derived.by((): Item[] => {
    const running = live.timing?.phase === 'running';
    const items: Item[] = [
      {
        id: 'toggle',
        group: 'Actions',
        label: running ? 'Stop the timer' : 'Start the timer',
        kbd: 'Space',
        write: true,
        run: () => ops.toggleTimer(),
      },
      {
        id: 'next',
        group: 'Actions',
        label: live.next ? `Advance to ${lineTitle(live.next)}` : 'Finish the marathon',
        hint: 'Next run',
        kbd: 'N',
        write: true,
        run: () => ops.advance(),
      },
      {
        id: 'back',
        group: 'Actions',
        label: 'Back to the previous run',
        kbd: 'B',
        write: true,
        run: () => ops.back(),
      },
      {
        id: 'set',
        group: 'Actions',
        label: 'Set the timer…',
        hint: 'Fix a late start',
        kbd: 'T',
        write: true,
        run: () => (ui.setElapsed = true),
      },
      {
        id: 'skip',
        group: 'Actions',
        label: 'Skip the current run',
        write: true,
        run: () => ops.skip(),
      },
      {
        id: 'reset',
        group: 'Actions',
        label: 'Reset the timer',
        write: true,
        run: () => ops.reset(),
      },
      {
        id: 'capture',
        group: 'Actions',
        label: 'Capture the stream now',
        hint: 'Compare the stream timer with ours',
        write: true,
        run: () => ops.capture(),
      },
      {
        id: 'refresh',
        group: 'Actions',
        label: 'Re-import the schedule',
        write: true,
        run: () => ops.refreshSchedule(),
      },
      {
        id: 'reset-marathon',
        group: 'Actions',
        label: 'Reset the whole marathon…',
        hint: 'Clear all times, check-ins and the log',
        write: true,
        run: () => void ops.resetMarathon(),
      },
      tab('schedule', 'Schedule'),
      tab('log', 'Event log'),
      tab('capture', 'Stream capture'),
      tab('broadcast', 'Broadcast: announcement & message board'),
      tab('kiosk', 'Kiosk setup & overlay feed'),
      tab('progress', 'Progress'),
      {
        id: 'report',
        group: 'Go to',
        label: 'Event report',
        hint: 'Planned against actual, with CSV export',
        run: () => router.navigate(reportPath(room.ref)),
      },
      {
        id: 'kiosk-open',
        group: 'Go to',
        label: 'Open a kiosk window',
        run: () =>
          window.open(kioskUrl(roomPath(room.ref), prefs.kiosk), '_blank', 'width=1280,height=800'),
      },
      {
        id: 'help',
        group: 'Go to',
        label: 'Keyboard shortcuts & help',
        kbd: '?',
        run: () => (ui.help = true),
      },
      { id: 'home', group: 'Go to', label: 'Change schedule', run: () => router.navigate('/') },
      ...THEMES.map((t) => ({
        id: `theme-${t.id}`,
        group: 'Go to' as const,
        label: `Theme: ${t.name}`,
        run: () => (prefs.theme = t.id),
      })),
      ...LAYOUT_PREFS.map((l) => ({
        id: `layout-${l.id}`,
        group: 'Go to' as const,
        label: `Layout: ${l.name}`,
        hint: l.id === 'auto' ? 'Pick from the screen' : 'On this device',
        run: () => (prefs.layout = l.id),
      })),
    ];
    if (layout.kind !== 'desktop') items.push(tab('timeline', 'Timeline'));
    if (layout.kind === 'tablet') {
      const floor = prefs.tabletMode === 'floor';
      items.push({
        id: 'mode',
        group: 'Go to',
        label: floor ? 'Switch to the console' : 'Switch to the floor view',
        hint: floor ? 'Every tool and tab' : 'Big timer and one-tap check-ins',
        run: () => (prefs.tabletMode = floor ? 'console' : 'floor'),
      });
    }
    if (room.isOperator) {
      items.push({
        id: 'alerts',
        group: 'Go to',
        label: 'Alerts on this device…',
        hint: 'Push notifications, even with the app closed',
        run: () => (ui.alerts = true),
      });
      items.push({
        id: 'checkin-links',
        group: 'Actions',
        label: 'Copy runner check-in links',
        hint: 'A link per upcoming run: “I’m here” or “running late”',
        run: () => void copyCheckinLinks(),
      });
    }
    if (live.catchUp) {
      items.push({
        id: 'catch-up',
        group: 'Go to',
        label: 'How to catch up',
        hint: 'Setup buffers and interludes that would give time back',
        run: () => ui.openTab('progress'),
      });
    }
    const detection = live.state.detection;
    if (detection) {
      items.unshift({
        id: 'detection',
        group: 'Actions',
        label:
          detection.kind === 'finish'
            ? `Stop ${live.titleOf(detection.runKey)}: it finished on stream`
            : `Follow the stream to ${live.titleOf(detection.runKey)}`,
        hint:
          detection.kind === 'start'
            ? 'Start it from the stream timer'
            : detection.kind === 'finish'
              ? 'Stop the timer when the stream’s did'
              : 'Detected run change',
        write: true,
        run: () => ops.acceptDetection(detection.id),
      });
    }
    if (live.state.undo) {
      items.unshift({
        id: 'undo',
        group: 'Actions',
        label: `Undo: ${live.state.undo.summary}`,
        kbd: 'Z',
        write: true,
        run: () => ops.undo(),
      });
    }
    if (live.current) {
      const key = live.current.key;
      items.push({
        id: 'edit',
        group: 'Actions',
        label: 'Edit times of the current run',
        kbd: 'E',
        write: true,
        run: () => (ui.editTimes = key),
      });
    }
    return items.filter((i) => !i.write || room.canWrite);
  });

  const runs = $derived(
    live.lines
      .filter((l) => !l.setupBlock)
      .map((l): Item => ({
        id: `run-${l.key}`,
        group: 'Runs',
        label: lineTitle(l),
        hint: [l.runners.join(', '), l.category, fmtClock(l.scheduledStart)]
          .filter(Boolean)
          .join(' · '),
        run: () => (ui.runSheet = l.key),
      })),
  );

  const results = $derived.by(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const match = (i: Item) => {
      const hay = `${i.label} ${i.hint ?? ''}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    };
    const cmds = commands.filter(match);
    if (!tokens.length) return cmds;
    // Runs first: searching "mario" must open the run, not advance to it on Enter.
    return [...runs.filter(match), ...cmds].slice(0, 60);
  });

  $effect(() => {
    void query;
    active = 0;
  });

  function choose(item: Item | undefined) {
    if (!item) return;
    ui.palette = false;
    item.run();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = results.length;
      if (!n) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      list?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    }
  }
</script>

<dialog
  bind:this={el}
  class="palette"
  aria-label="Command palette"
  onclose={() => (ui.palette = false)}
  onclick={(e) => {
    if (e.target === el) ui.palette = false;
  }}
>
  <div class="box">
    <label class="search">
      <Search size={18} />
      <!-- svelte-ignore a11y_autofocus -->
      <input
        autofocus
        placeholder="Type a command or search runs, runners, platforms…"
        bind:value={query}
        {onkeydown}
        role="combobox"
        aria-label="Search commands and runs"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-activedescendant="palette-{active}"
      />
    </label>
    <ul id="palette-list" role="listbox" bind:this={list}>
      {#each results as item, i (item.id)}
        {#if i === 0 || results[i - 1]!.group !== item.group}
          <li class="group" role="presentation">{item.group}</li>
        {/if}
        <li
          id="palette-{i}"
          data-i={i}
          role="option"
          aria-selected={i === active}
          class:active={i === active}
          onclick={() => choose(item)}
          onmousemove={() => (active = i)}
          onkeydown={() => {}}
        >
          <span class="text">
            <span class="truncate">{item.label}</span>
            {#if item.hint}<small class="truncate">{item.hint}</small>{/if}
          </span>
          {#if item.kbd}<span class="kbd">{item.kbd}</span>{/if}
        </li>
      {:else}
        <li class="empty">No matches.</li>
      {/each}
    </ul>
    <footer>
      <span><span class="kbd">↑</span><span class="kbd">↓</span> move</span>
      <span><span class="kbd">↵</span> run</span>
      <span><span class="kbd">Esc</span> close</span>
    </footer>
  </div>
</dialog>

<style>
  .palette {
    margin: 12vh auto auto;
    padding: 0;
    width: min(640px, calc(100vw - 24px));
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }
  .palette::backdrop {
    background: rgb(3 4 6 / 0.6);
    backdrop-filter: blur(3px);
  }
  .search {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 18px;
    border-bottom: 1px solid var(--border);
    color: var(--muted);
  }
  input {
    flex: 1;
    box-shadow: none;
    height: 56px;
    border: 0;
    background: none;
    font-size: 16px;
    outline: none;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 6px;
    max-height: min(56vh, 480px);
    overflow: auto;
  }
  li[role='option'] {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 12px;
    border-radius: 8px;
    cursor: pointer;
  }
  li.active {
    background: var(--accent-soft);
  }
  .group {
    padding: 10px 12px 4px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .text {
    flex: 1;
    display: grid;
    min-width: 0;
  }
  small {
    color: var(--muted);
    font-size: 12.5px;
  }
  .empty {
    padding: 20px;
    color: var(--muted);
    text-align: center;
  }
  footer {
    display: flex;
    gap: 16px;
    padding: 10px 18px;
    border-top: 1px solid var(--border);
    background: var(--bg-2);
    color: var(--muted);
    font-size: 12px;
  }
  footer span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
</style>
