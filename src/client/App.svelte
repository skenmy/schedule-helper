<script lang="ts">
  import { parseRoomPath, roomKey } from '../shared/sources.ts';
  import Huds from './components/Huds.svelte';
  import Toasts from './components/ui/Toasts.svelte';
  import { prefs } from './lib/prefs.svelte.ts';
  import { router } from './lib/router.svelte.ts';
  import Landing from './views/Landing.svelte';
  import RoomView from './views/RoomView.svelte';

  const ref = $derived(parseRoomPath(router.path));
  const flag = (name: string) => router.params.has(name) && router.params.get(name) !== '0';
  const kiosk = $derived(flag('kiosk'));
  const report = $derived(!kiosk && flag('report'));
  /** A runner's check-in link: `?checkin={run key}&t={token}`. */
  const checkin = $derived.by(() => {
    const key = router.params.get('checkin');
    return key ? { key, token: router.params.get('t') ?? '' } : null;
  });

  $effect(() => {
    document.documentElement.dataset.theme = prefs.theme;
  });
</script>

{#if ref}
  {#key roomKey(ref)}
    <RoomView {ref} {kiosk} {report} {checkin} />
  {/key}
{:else}
  <Landing />
{/if}

<Toasts />
<Huds />
