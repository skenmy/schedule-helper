<script lang="ts">
  import { ui } from '../../lib/ui.svelte.ts';
  import AlertsSetting from '../AlertsSetting.svelte';
  import Dialog from '../ui/Dialog.svelte';
</script>

<Dialog bind:open={ui.alerts} title="Alerts" size="sm">
  {#if ui.alerts}<AlertsSetting />{/if}
</Dialog>
