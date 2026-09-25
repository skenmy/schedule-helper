<script lang="ts">
  import { CircleQuestionMark, House, LogIn, MonitorPlay, Search } from '@lucide/svelte';
  import { detectBrand, roomPath } from '../../../shared/sources.ts';
  import { clock } from '../../lib/clock.svelte.ts';
  import { fmtClock } from '../../lib/format.ts';
  import { kioskUrl } from '../../lib/kiosk.ts';
  import { prefs, THEMES } from '../../lib/prefs.svelte.ts';
  import { getRoom } from '../../lib/room.svelte.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { ui } from '../../lib/ui.svelte.ts';

  let { compact = false }: { compact?: boolean } = $props();

  const room = getRoom();
  const brand = $derived(detectBrand(room.ref));
  const auth = $derived(room.auth);
  const role = $derived(auth?.root ? 'root' : auth?.canWrite ? 'operator' : 'viewer');
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  const conn = $derived.by(() => {
    if (room.status === 'open') return { tone: 'ok', text: `${room.presence} online` };
    if (room.status === 'reconnecting') return { tone: 'bad', text: 'Reconnecting…' };
    return { tone: 'warn', text: 'Connecting…' };
  });

  function openKiosk() {
    window.open(kioskUrl(roomPath(room.ref), prefs.kiosk), '_blank', 'width=1280,height=800');
  }
</script>

<header class="topbar" class:compact data-huds="bar">
  <div class="left">
    <button
      class="btn ghost icon"
      title="Change schedule"
      aria-label="Change schedule"
      onclick={() => router.navigate('/')}
    >
      <House size={18} />
    </button>
    {#if brand}
      <span class="logo" role="img" aria-label="UKSG"></span>
    {/if}
    <div class="names">
      <strong class="truncate" data-huds="text">{room.schedule?.eventName ?? room.ref.event}</strong
      >
      {#if !compact}<span class="truncate">{room.schedule?.scheduleName ?? room.ref.slug}</span
        >{/if}
    </div>
  </div>

  {#if !compact}
    <button class="search" onclick={() => (ui.palette = true)}>
      <Search size={16} />
      <span>Jump to a run or command…</span>
      <span class="kbd">{isMac ? '⌘' : 'Ctrl'} K</span>
    </button>
  {/if}

  <div class="right">
    <span class="conn" title={room.status === 'open' ? 'Live sync connected' : 'Sync disconnected'}>
      <span class="dot {conn.tone}" class:pulse={room.status !== 'open'}></span>
      {#if !compact}{conn.text}{/if}
    </span>
    {#if !compact}
      <span class="clock num">{fmtClock(clock.now, true)}</span>
      {#if !brand}
        <select class="select theme" bind:value={prefs.theme} aria-label="Theme">
          {#each THEMES as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
        </select>
      {/if}
      <button
        class="btn ghost sm"
        onclick={openKiosk}
        title="Open a kiosk window with your saved layout"
      >
        <MonitorPlay size={16} /> Kiosk
      </button>
      <button
        class="btn ghost icon sm"
        aria-label="Help and shortcuts"
        title="Help (?)"
        onclick={() => (ui.help = true)}
      >
        <CircleQuestionMark size={17} />
      </button>
    {/if}

    {#if auth?.user}
      <a
        class="user"
        href={auth.manageUrl ?? undefined}
        target="_blank"
        rel="noopener"
        title="Signed in as {auth.user.login} ({role})"
      >
        {#if auth.user.avatar}<img src={auth.user.avatar} alt="" />{/if}
        {#if !compact}<span class="name truncate">{auth.user.display}</span>{/if}
        <span class="role chip {auth.canWrite ? 'accent' : ''}">{role}</span>
      </a>
    {:else if auth?.loginUrl}
      <button class="btn sm primary" onclick={() => room.signIn()}
        ><LogIn size={15} /> Sign in</button
      >
    {/if}
  </div>
</header>

<style>
  .topbar {
    position: sticky;
    top: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    gap: 16px;
    height: var(--topbar-h);
    padding: 0 var(--gutter) 0 calc(var(--gutter) - 8px);
    background: color-mix(in oklab, var(--bg) 88%, transparent);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border);
  }
  .left,
  .right {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .left {
    flex: 1 1 auto;
  }
  .right {
    flex: none;
    gap: 12px;
  }
  .logo {
    height: 26px;
    aspect-ratio: 1022 / 293;
    background: var(--uksg-logo) left center / contain no-repeat;
    flex: none;
  }
  .names {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
  }
  .names strong {
    font-size: 15px;
  }
  .names span {
    color: var(--muted);
    font-size: 13.5px;
  }
  .search {
    flex: 0 1 380px;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 36px;
    padding: 0 8px 0 12px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--bg-2);
    color: var(--muted);
    font-size: 13.5px;
    cursor: pointer;
  }
  .search:hover {
    border-color: var(--border-strong);
    color: var(--text-2);
  }
  .search span:not(.kbd) {
    flex: 1;
    text-align: left;
  }
  .conn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 13px;
    color: var(--text-2);
    white-space: nowrap;
  }
  .conn .dot.ok {
    color: var(--ok);
  }
  .conn .dot.warn {
    color: var(--warn);
  }
  .conn .dot.bad {
    color: var(--bad);
  }
  .clock {
    font-size: 14px;
    color: var(--text-2);
  }
  .theme {
    width: auto;
    min-height: 32px;
    padding: 4px 8px;
    font-size: 13px;
  }
  .user {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 240px;
    color: var(--text);
    text-decoration: none;
  }
  .user img {
    width: 28px;
    height: 28px;
    border-radius: 50%;
  }
  .user .name {
    font-size: 13.5px;
    font-weight: 600;
  }
  .role {
    height: 20px;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  @media (max-width: 1100px) {
    .search span:not(.kbd),
    .theme {
      display: none;
    }
    .search {
      flex: none;
    }
  }
</style>
