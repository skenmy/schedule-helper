<script lang="ts">
  import { ui } from '../../lib/ui.svelte.ts';
  import Dialog from './Dialog.svelte';

  const req = $derived(ui.confirm);

  function settle(ok: boolean) {
    ui.confirm?.resolve(ok);
    ui.confirm = null;
  }
</script>

{#if req}
  <Dialog bind:open={() => !!ui.confirm, (v) => !v && settle(false)} title={req.title} size="sm">
    {#if req.body}<p class="body">{req.body}</p>{/if}
    {#snippet footer()}
      <button class="btn ghost" onclick={() => settle(false)}>Cancel</button>
      <button class="btn {req.danger ? 'danger' : 'primary'}" onclick={() => settle(true)}
        >{req.confirmLabel}</button
      >
    {/snippet}
  </Dialog>
{/if}

<style>
  .body {
    color: var(--text-2);
  }
</style>
