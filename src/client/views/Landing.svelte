<script lang="ts">
  import { ArrowRight, Camera, LayoutGrid, Radio, Sparkles, Undo2, X } from '@lucide/svelte';
  import type { PartialRef } from '../../shared/sources.ts';
  import { DEMO_REF, parseScheduleInput, roomPath } from '../../shared/sources.ts';
  import type { ScheduleSummary } from '../../shared/types.ts';
  import { relTime } from '../lib/format.ts';
  import { prefs } from '../lib/prefs.svelte.ts';
  import { router } from '../lib/router.svelte.ts';

  let input = $state('');
  let error = $state<string | null>(null);
  let loading = $state(false);
  let choices = $state<{ ref: PartialRef; eventName: string; schedules: ScheduleSummary[] } | null>(
    null,
  );

  $effect(() => {
    document.title = 'Schedule Helper';
    document.documentElement.removeAttribute('data-brand');
    document.documentElement.removeAttribute('data-brand-variant');
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    choices = null;
    const ref = parseScheduleInput(input);
    if (!ref) {
      error = 'That doesn’t look like an Oengus or Horaro schedule link.';
      return;
    }
    if (ref.slug) {
      router.navigate(roomPath({ ...ref, slug: ref.slug }));
      return;
    }
    loading = true;
    try {
      const res = await fetch(`/api/events/${ref.source}/${encodeURIComponent(ref.event)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const schedules = body.schedules as ScheduleSummary[];
      if (schedules.length === 0)
        error = `${body.name || ref.event} has no published schedules yet.`;
      else if (schedules.length === 1)
        router.navigate(roomPath({ ...ref, slug: schedules[0]!.slug }));
      else choices = { ref, eventName: body.name || ref.event, schedules };
    } catch (err) {
      error = res404(err)
        ? 'Couldn’t find that marathon.'
        : `Couldn’t load that marathon: ${(err as Error).message}`;
    } finally {
      loading = false;
    }
  }

  const res404 = (err: unknown) => err instanceof Error && /not found/i.test(err.message);
</script>

<main class="landing">
  <div class="hero">
    <div class="mark" aria-hidden="true"><Radio size={22} /></div>
    <h1>Schedule Helper</h1>
    <p class="lede">
      The operator console for speedrun marathons. Paste your schedule and everyone on the team sees
      the same live timer, delta and run order.
    </p>

    <form class="load" onsubmit={submit}>
      <label class="visually-hidden" for="schedule-url">Schedule link</label>
      <input
        id="schedule-url"
        class="input"
        placeholder="https://oengus.io/marathon/uksgred26/schedule/main"
        autocomplete="off"
        spellcheck="false"
        bind:value={input}
      />
      <button class="btn primary lg" type="submit" disabled={loading || !input.trim()}>
        {loading ? 'Loading…' : 'Open'}
        <ArrowRight size={18} />
      </button>
    </form>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <p class="hint">
      Oengus or Horaro links, or shorthand like <code>uksgred26/main</code>.
      <button class="linkish" onclick={() => router.navigate(roomPath(DEMO_REF))}
        >Try the demo marathon</button
      >
    </p>

    {#if choices}
      <section class="card choices">
        <h2>{choices.eventName} has {choices.schedules.length} schedules</h2>
        {#each choices.schedules as s (s.slug)}
          <button
            class="choice"
            onclick={() => router.navigate(roomPath({ ...choices!.ref, slug: s.slug }))}
          >
            <span>{s.name}</span>
            <code>{s.slug}</code>
            <ArrowRight size={16} />
          </button>
        {/each}
      </section>
    {/if}

    {#if prefs.recent.length}
      <section class="recent">
        <h2 class="label">Recent</h2>
        {#each prefs.recent as r (roomPath(r.ref))}
          <div class="recent-row">
            <a
              href={roomPath(r.ref)}
              onclick={(e) => {
                e.preventDefault();
                router.navigate(roomPath(r.ref));
              }}
            >
              <strong class="truncate">{r.name}</strong>
              <span class="num">{r.ref.source}/{r.ref.event}/{r.ref.slug}</span>
              <span class="when">{relTime(r.openedAt, Date.now())}</span>
            </a>
            <button
              class="btn ghost icon sm"
              aria-label="Remove {r.name} from recent"
              onclick={() => prefs.forget(r.ref)}
            >
              <X size={15} />
            </button>
          </div>
        {/each}
      </section>
    {/if}
  </div>

  <ul class="features">
    <li>
      <Sparkles size={18} /><b>Real-time sync</b><span
        >One shared timer and run order across every operator’s screen.</span
      >
    </li>
    <li>
      <Camera size={18} /><b>Stream capture</b><span
        >Claude reads the timer off the Twitch stream and flags drift.</span
      >
    </li>
    <li>
      <LayoutGrid size={18} /><b>Kiosks & overlays</b><span
        >Venue screens by URL, plus a JSON feed for stream overlays.</span
      >
    </li>
    <li>
      <Undo2 size={18} /><b>Undo & audit</b><span
        >Every action is logged with who did it, and one tap undoes it.</span
      >
    </li>
  </ul>
</main>

<style>
  .landing {
    min-height: 100dvh;
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 56px;
    padding: 64px var(--gutter);
    background:
      radial-gradient(1200px 500px at 50% -10%, var(--accent-soft), transparent 60%), var(--bg);
  }
  .hero {
    width: min(680px, 100%);
    display: grid;
    gap: 16px;
  }
  .mark {
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border-radius: 12px;
    background: var(--accent);
    color: var(--accent-ink);
  }
  h1 {
    font-size: clamp(36px, 6vw, 56px);
    font-weight: 800;
    letter-spacing: -0.035em;
    line-height: 1;
  }
  .lede {
    font-size: 18px;
    color: var(--text-2);
    max-width: 560px;
  }
  .load {
    display: flex;
    gap: 10px;
    margin-top: 12px;
  }
  .load .input {
    min-height: 52px;
    font-size: 16px;
    padding: 0 16px;
  }
  .error {
    color: var(--bad);
    font-weight: 600;
  }
  .hint code,
  .choice code {
    font-family: var(--font-mono);
    font-size: 12.5px;
    color: var(--text-2);
  }
  .linkish {
    margin-left: 6px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-weight: 600;
    cursor: pointer;
  }
  .linkish:hover {
    text-decoration: underline;
  }
  .choices {
    padding: 8px;
    display: grid;
    gap: 2px;
  }
  .choices h2 {
    padding: 10px 12px;
    font-size: 15px;
  }
  .choice {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    text-align: left;
    cursor: pointer;
  }
  .choice span {
    flex: 1;
    font-weight: 600;
  }
  .choice:hover {
    background: var(--surface-2);
  }
  .recent {
    display: grid;
    gap: 4px;
    margin-top: 16px;
  }
  .recent h2 {
    margin-bottom: 6px;
  }
  .recent-row {
    display: flex;
    align-items: center;
    gap: 6px;
    border-radius: var(--radius-sm);
  }
  .recent-row:hover {
    background: var(--surface);
  }
  .recent-row a {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 16px;
    padding: 10px 12px;
    color: var(--text);
    text-decoration: none;
    min-width: 0;
  }
  .recent-row .num {
    color: var(--muted);
    font-size: 12px;
  }
  .when {
    color: var(--muted);
    font-size: 12.5px;
  }
  .features {
    width: min(980px, 100%);
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 24px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .features li {
    display: grid;
    gap: 4px;
    color: var(--muted);
    font-size: 14px;
  }
  .features :global(svg) {
    color: var(--accent);
    margin-bottom: 4px;
  }
  .features b {
    color: var(--text);
  }
  @media (max-width: 640px) {
    .load {
      flex-direction: column;
    }
    .recent-row a {
      grid-template-columns: 1fr auto;
    }
    .recent-row .num {
      display: none;
    }
  }
</style>
