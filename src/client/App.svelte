<script lang="ts">
  import { parseRoomPath, roomKey } from '../shared/sources.ts';
  import Huds from './components/Huds.svelte';
  import Toasts from './components/ui/Toasts.svelte';
  import { prefs } from './lib/prefs.svelte.ts';
  import { router } from './lib/router.svelte.ts';
  import Landing from './views/Landing.svelte';
  import RoomView from './views/RoomView.svelte';

  const ref = $derived(parseRoomPath(router.path));
  const kiosk = $derived(router.params.has('kiosk') && router.params.get('kiosk') !== '0');

  $effect(() => {
    document.documentElement.dataset.theme = prefs.theme;
  });
</script>

{#if ref}
  {#key roomKey(ref)}
    <RoomView {ref} {kiosk} />
  {/key}
{:else}
  <Landing />
{/if}

<Toasts />
<Huds />
