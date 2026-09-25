<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { detectBrand } from '../../shared/sources.ts';
  import type { RoomRef } from '../../shared/types.ts';
  import { loadBrandFont } from '../lib/device.ts';
  import { provideLive } from '../lib/live.svelte.ts';
  import { prefs } from '../lib/prefs.svelte.ts';
  import { RoomConnection, setRoom } from '../lib/room.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import Conductor from './Conductor.svelte';
  import Kiosk from './Kiosk.svelte';
  import MobileConductor from './MobileConductor.svelte';

  let { ref, kiosk }: { ref: RoomRef; kiosk: boolean } = $props();

  const room = new RoomConnection(untrack(() => ref));
  setRoom(room);
  provideLive(room);
  const mobile = new MediaQuery('max-width: 820px');

  onMount(() => {
    room.connect();
    return () => {
      room.close();
      ui.reset();
    };
  });

  $effect(() => {
    const brand = detectBrand(ref);
    const html = document.documentElement;
    if (!brand) return;
    html.dataset.brand = brand.brand;
    html.dataset.brandVariant = brand.variant;
    loadBrandFont();
    return () => {
      delete html.dataset.brand;
      delete html.dataset.brandVariant;
    };
  });

  const title = $derived(
    room.schedule ? `${room.schedule.eventName} · ${room.schedule.scheduleName}` : null,
  );
  $effect(() => {
    document.title = title ? `${kiosk ? 'Kiosk · ' : ''}${title}` : 'Schedule Helper';
  });

  let remembered = false;
  $effect(() => {
    if (!title || remembered || kiosk) return;
    remembered = true;
    untrack(() => prefs.remember(ref, title));
  });
</script>

{#if room.fatal && !room.schedule}
  <main class="center">
    <div class="card message">
      <h1>
        {room.fatal.code === 'not_found' ? 'Schedule not found' : 'Couldn’t load the schedule'}
      </h1>
      <p>{room.fatal.message}</p>
      <p class="muted num">{ref.source}/{ref.event}/{ref.slug}</p>
      <div class="row">
        <button class="btn primary" onclick={() => router.navigate('/')}
          >Choose another schedule</button
        >
        <button class="btn" onclick={() => location.reload()}>Try again</button>
      </div>
    </div>
  </main>
{:else if !room.schedule || !room.state}
  <main class="center" aria-busy="true">
    <div class="loading">
      <span class="spinner"></span>
      <p>{room.status === 'reconnecting' ? 'Reconnecting…' : 'Loading schedule…'}</p>
    </div>
  </main>
{:else if kiosk}
  <Kiosk />
{:else if mobile.current}
  <MobileConductor />
{:else}
  <Conductor />
{/if}

<style>
  .center {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: var(--gutter);
  }
  .message {
    max-width: 480px;
    padding: 28px;
    display: grid;
    gap: 12px;
  }
  h1 {
    font-size: 22px;
  }
  .row {
    display: flex;
    gap: 8px;
    margin-top: 8px;
    flex-wrap: wrap;
  }
  .loading {
    display: grid;
    justify-items: center;
    gap: 14px;
    color: var(--muted);
  }
  .spinner {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 3px solid var(--surface-3);
    border-top-color: var(--accent);
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
