<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity';
  import AnnouncementBanner from '../components/conductor/AnnouncementBanner.svelte';
  import MiniLog from '../components/conductor/MiniLog.svelte';
  import NowCard from '../components/conductor/NowCard.svelte';
  import StatusStrip from '../components/conductor/StatusStrip.svelte';
  import TopBar from '../components/conductor/TopBar.svelte';
  import UpNext from '../components/conductor/UpNext.svelte';
  import Workspace from '../components/conductor/Workspace.svelte';
  import RoomDialogs from '../components/RoomDialogs.svelte';
  import Shortcuts from '../components/Shortcuts.svelte';
  import MoreSheet from '../components/touch/MoreSheet.svelte';
  import OnDeck from '../components/touch/OnDeck.svelte';
  import Transport from '../components/touch/Transport.svelte';
  import { keepAwake } from '../lib/device.ts';
  import { getLive } from '../lib/live.svelte.ts';
  import { prefs } from '../lib/prefs.svelte.ts';

  /**
   * iPad (and other tablets). Two modes, remembered per device:
   * - console: everything the desktop can do, rearranged for touch;
   * - floor: the live run, a big timer and one-tap runner check-ins.
   *
   * Wide screens (landscape, or a 13" in portrait) are an app shell: fixed
   * chrome and two panes that scroll on their own, with the run controls
   * pinned to the bottom of the live pane. Narrower ones scroll as a page
   * with the controls docked along the bottom.
   */
  const live = getLive();
  const wide = new MediaQuery('min-width: 1000px');
  const floor = $derived(prefs.tabletMode === 'floor');

  $effect(() => keepAwake(() => live.timing?.phase === 'running'));

  $effect(() => {
    const html = document.documentElement;
    if (wide.current) {
      html.classList.add('app-shell');
      return () => html.classList.remove('app-shell');
    }
    document.body.classList.add('has-dock');
    return () => document.body.classList.remove('has-dock');
  });
</script>

{#if wide.current}
  <div class="shell">
    <TopBar variant="tablet" />
    <AnnouncementBanner />
    <StatusStrip />
    <div class="panes" class:floor>
      <section class="pane live" aria-label="Live">
        <div class="scroll">
          <NowCard stage={floor} />
          {#if !floor}
            <UpNext />
            <MiniLog />
          {/if}
        </div>
        <Transport variant={floor ? 'floor' : 'pane'} />
      </section>
      <section class="pane side" aria-label={floor ? 'On deck' : 'Workspace'}>
        {#if floor}
          <div class="scroll">
            <OnDeck />
            <MiniLog />
          </div>
        {:else}
          <Workspace pane />
        {/if}
      </section>
    </div>
  </div>
{:else}
  <TopBar variant="tablet" />
  <AnnouncementBanner />
  <StatusStrip />
  <main class="stack" class:floor>
    {#if floor}
      <NowCard stage timer />
      <OnDeck />
      <MiniLog />
    {:else}
      <div class="pair">
        <NowCard />
        <UpNext />
      </div>
    {/if}
  </main>
  {#if !floor}<Workspace />{/if}
  <Transport variant="dock" readout={!floor} />
{/if}

<MoreSheet />
<RoomDialogs />
<Shortcuts />

<style>
  /* ── Wide: an app shell with two independently scrolling panes ─────── */
  .shell {
    display: flex;
    flex-direction: column;
    height: 100dvh;
  }
  .panes {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(360px, 0.62fr) minmax(0, 1fr);
  }
  .panes.floor {
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  }
  .pane {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .live {
    border-right: 1px solid var(--border);
  }
  .scroll {
    flex: 1;
    min-height: 0;
    display: grid;
    align-content: start;
    gap: 14px;
    padding: 14px var(--gutter) 20px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .side .scroll {
    padding-bottom: calc(20px + env(safe-area-inset-bottom));
  }

  /* ── Narrow: a scrolling page with the controls docked ──────────────── */
  .stack {
    display: grid;
    gap: 14px;
    padding: 14px var(--gutter);
  }
  .pair {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    gap: 14px;
    align-items: start;
  }
</style>
