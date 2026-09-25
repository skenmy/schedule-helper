<script lang="ts">
  // 🏳️‍🌈 Type "huds" anywhere outside a text field. Esc to leave.
  import { isTypingTarget } from '../lib/ui.svelte.ts';

  const COLORS = [
    '#e40303',
    '#ff8c00',
    '#ffed00',
    '#008026',
    '#004dff',
    '#750787',
    '#ff69b4',
    '#00d4ff',
    '#ffffff',
  ];
  let on = $state(false);
  let buffer = '';

  function confetti(count: number) {
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'huds-confetti';
      el.style.left = `${Math.random() * 100}vw`;
      el.style.background = COLORS[Math.floor(Math.random() * COLORS.length)]!;
      el.style.width = `${6 + Math.random() * 8}px`;
      el.style.height = `${10 + Math.random() * 10}px`;
      el.style.animationDuration = `${2.5 + Math.random() * 3.5}s`;
      el.style.animationDelay = `${Math.random() * 0.6}s`;
      el.addEventListener('animationend', () => el.remove());
      document.body.append(el);
    }
  }

  $effect(() => {
    document.documentElement.classList.toggle('huds', on);
    if (!on) return;
    confetti(140);
    const timer = setInterval(() => confetti(20), 1500);
    return () => {
      clearInterval(timer);
      document.querySelectorAll('.huds-confetti').forEach((el) => el.remove());
    };
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && on) {
      on = false;
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1 || isTypingTarget(e.target))
      return;
    buffer = (buffer + e.key.toLowerCase()).slice(-4);
    if (buffer === 'huds') {
      buffer = '';
      on = true;
    }
  }
</script>

<svelte:window {onkeydown} />

{#if on}
  <div class="banner" role="status">
    🏳️‍🌈 <strong>HUDS MODE UNLOCKED</strong> 🏳️‍🌈 ·
    <a href="https://huds601.co.uk" target="_blank" rel="noopener">huds601.co.uk</a>
    <small>esc to exit</small>
  </div>
{/if}

<style>
  .banner {
    position: fixed;
    left: 50%;
    bottom: calc(24px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 9999;
    padding: 10px 18px;
    border-radius: 999px;
    background: linear-gradient(90deg, #e40303, #ff8c00, #ffed00, #008026, #004dff, #750787);
    background-size: 400% 100%;
    animation: huds-rainbow-text 4s linear infinite;
    color: #fff;
    font-weight: 700;
    text-shadow: 0 1px 2px rgb(0 0 0 / 0.5);
    white-space: nowrap;
    box-shadow: 0 10px 40px rgb(255 105 180 / 0.5);
  }
  .banner a {
    color: #fff;
    text-decoration: underline;
  }
  .banner small {
    opacity: 0.85;
    margin-left: 6px;
  }
</style>
