<script lang="ts">
  import AnnouncementBanner from '../components/conductor/AnnouncementBanner.svelte';
  import MiniLog from '../components/conductor/MiniLog.svelte';
  import NowCard from '../components/conductor/NowCard.svelte';
  import StatusStrip from '../components/conductor/StatusStrip.svelte';
  import TimerPanel from '../components/conductor/TimerPanel.svelte';
  import Timeline from '../components/conductor/Timeline.svelte';
  import TopBar from '../components/conductor/TopBar.svelte';
  import UpNext from '../components/conductor/UpNext.svelte';
  import Workspace from '../components/conductor/Workspace.svelte';
  import RoomDialogs from '../components/RoomDialogs.svelte';
  import Shortcuts from '../components/Shortcuts.svelte';
</script>

<TopBar />
<AnnouncementBanner />
<main>
  <StatusStrip />
  <Timeline />
  <section class="live">
    <div class="primary">
      <NowCard />
      <MiniLog />
    </div>
    <aside class="side">
      <TimerPanel />
      <UpNext />
    </aside>
  </section>
  <Workspace />
</main>
<RoomDialogs />
<Shortcuts />

<style>
  .live {
    display: grid;
    grid-template-columns: minmax(0, 1.55fr) minmax(360px, 1fr);
    gap: 16px;
    padding: 16px var(--gutter) 24px;
    align-items: start;
  }
  .primary,
  .side {
    display: grid;
    gap: 16px;
    min-width: 0;
  }
  @media (max-width: 1100px) {
    .live {
      grid-template-columns: minmax(0, 1fr) minmax(320px, 0.9fr);
    }
  }
</style>
