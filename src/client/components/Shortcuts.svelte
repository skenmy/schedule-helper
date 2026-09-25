<script lang="ts">
  import { getLive, getOps } from '../lib/live.svelte.ts';
  import { getRoom } from '../lib/room.svelte.ts';
  import { isTypingTarget, ui } from '../lib/ui.svelte.ts';

  const room = getRoom();
  const live = getLive();
  const ops = getOps();

  function onkeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      ui.palette = !ui.palette;
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    if (isTypingTarget(e.target) || document.querySelector('dialog[open]')) return;

    if (e.key === '?') {
      ui.help = true;
      return;
    }
    const key = e.key === ' ' ? 'space' : e.key.toLowerCase();
    if (!['space', 'n', 'b', 'z', 't', 'e'].includes(key)) return;
    e.preventDefault();
    // Stop a focused button from also being activated by the same keypress.
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (!room.canWrite) {
      room.promptSignIn();
      return;
    }
    switch (key) {
      case 'space':
        ops.toggleTimer();
        break;
      case 'n':
        ops.advance();
        break;
      case 'b':
        ops.back();
        break;
      case 'z':
        if (live.state.undo) ops.undo();
        break;
      case 't':
        ui.setElapsed = true;
        break;
      case 'e':
        if (live.current) ui.editTimes = live.current.key;
        break;
    }
  }
</script>

<svelte:window {onkeydown} />
