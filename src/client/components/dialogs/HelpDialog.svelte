<script lang="ts">
  import { ui } from '../../lib/ui.svelte.ts';
  import Dialog from '../ui/Dialog.svelte';

  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

  const SHORTCUTS: [string[], string][] = [
    [['Space'], 'Start / stop the timer'],
    [['N'], 'Advance to the next run'],
    [['B'], 'Back to the previous run'],
    [['Z'], 'Undo the last action'],
    [['T'], 'Set the timer'],
    [['E'], 'Edit times of the current run'],
    [[mod, 'K'], 'Command palette: jump to any run or action'],
    [['?'], 'This help'],
    [['Esc'], 'Close dialogs'],
  ];
</script>

<Dialog bind:open={ui.help} title="Help & shortcuts" size="md">
  <h3 class="label">Keyboard</h3>
  <dl class="keys">
    {#each SHORTCUTS as [keys, what] (what)}
      <dt>
        {#each keys as k (k)}<span class="kbd">{k}</span>{/each}
      </dt>
      <dd>{what}</dd>
    {/each}
  </dl>

  <h3 class="label">How it works</h3>
  <ul class="notes">
    <li>
      <b>Everyone sees the same thing.</b> The server holds the state; every action is broadcast to all
      operators instantly.
    </li>
    <li>
      <b>Delta</b> compares when the live run started with its slot. Once a run eats into the next slot,
      the overrun counts too. Within ±15 minutes counts as on schedule.
    </li>
    <li>
      <b>Projected times</b> chain every remaining estimate and setup from where the live run will realistically
      finish.
    </li>
    <li>
      <b>Undo</b> reverts the most recent change to runs, timers, check-ins or broadcasts, whoever made
      it. The event log records who did what.
    </li>
    <li>
      <b>Stream capture</b> reads the timer off the Twitch stream with Claude and compares it with ours.
      Turn on the auto drift check to do it every few minutes.
    </li>
    <li>
      <b>Kiosks</b> are read-only displays configured by URL. Set one up in the Kiosk tab, then bookmark
      it on the venue TV.
    </li>
  </ul>
</Dialog>

<style>
  h3 {
    margin: 4px 0 10px;
  }
  .keys {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px 16px;
    margin: 0 0 22px;
  }
  dt {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
  }
  dd {
    margin: 0;
    color: var(--text-2);
  }
  .notes {
    margin: 0;
    padding-left: 18px;
    display: grid;
    gap: 8px;
    color: var(--text-2);
    font-size: 14px;
  }
  .notes b {
    color: var(--text);
  }
</style>
