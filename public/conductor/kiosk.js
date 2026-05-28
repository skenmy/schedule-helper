// production/conductor/kiosk.js
// Self-contained kiosk renderer. Activated by ?kiosk=1 URL param.
//
// Layout + panel assignment is stored in localStorage (`sched-kiosk-config`)
// to stay compatible with the original. Each panel is a small self-rendering
// template that reads from window.STATE and updates on every state change.
//
// Panels: delta, current, running, ondeck, nextup, schedule, controls,
//         log, message, marathon, progress, twitch, timing.

(function() {
  // ---------- Layout definitions (match original keys + areas)
  const LAYOUTS = {
    '1x1':  { name: '1×1',           cols: '1fr',        rows: '1fr',         cells: 1 },
    '1x2':  { name: '1+1 Wide',      cols: '1fr 1fr',    rows: '1fr',         cells: 2 },
    '2x1':  { name: '2 Stacked',     cols: '1fr',        rows: '1fr 1fr',     cells: 2 },
    '2x2':  { name: '2×2',           cols: '1fr 1fr',    rows: '1fr 1fr',     cells: 4 },
    '1+2':  { name: '1 Top, 2 Below',cols: '1fr 1fr',    rows: '1fr 1fr',     cells: 3, areas: '"a a" "b c"' },
    '2+1':  { name: '2 Top, 1 Below',cols: '1fr 1fr',    rows: '1fr 1fr',     cells: 3, areas: '"a b" "c c"' },
    '2+3':  { name: '2 Top, 3 Below',cols: '1fr 1fr 1fr 1fr 1fr 1fr', rows: '1fr 1fr', cells: 5, areas: '"a a a b b b" "c c d d e e"' },
    '3x3':  { name: '3×3',           cols: '1fr 1fr 1fr',rows: '1fr 1fr 1fr', cells: 9 },
    '1+3':  { name: '1 Top, 3 Below',cols: '1fr 1fr 1fr',rows: '1fr 1fr',     cells: 4, areas: '"a a a" "b c d"' },
    'side': { name: 'Sidebar + Main',cols: '1fr 2fr',    rows: '1fr 1fr',     cells: 3, areas: '"a b" "a c"' },
  };

  // ---------- Panel renderers
  // Each: returns { title, html, scroll? }
  const PANELS = {
    delta(s) {
      const delta = s.derived.delta;
      const cls = s.derived.preMarathon ? 'warn'
                : Math.abs(delta) <= 60 ? 'ontime'
                : delta > 0 ? 'ahead' : 'behind';
      const stateLabel = s.derived.preMarathon
        ? 'Pre-marathon'
        : Math.abs(delta) <= 60 ? 'On schedule'
        : delta > 0 ? 'Running ahead' : 'Running behind';
      const value = s.derived.preMarathon
        ? s.derived.preMarathonCountdown
        : window.fmtDelta(delta);
      const sub = s.derived.preMarathon
        ? 'until first run · ' + window.fmtTime(new Date(s.schedule[0].scheduledStart))
        : 'scheduled ' + (s.derived.currentRun ? window.fmtTime(new Date(s.derived.currentRun.scheduledStart)) : '—')
          + ' · actual ' + window.fmtTime(s.derived.actualStartDate || new Date());
      return {
        title: 'Delta', badge: stateLabel,
        html: `<div class="kpanel-delta ${cls}">
          <div class="state">${stateLabel}</div>
          <div class="value">${escapeHtml(value)}</div>
          <div class="sub">${escapeHtml(sub)}</div>
        </div>`
      };
    },

    current(s) { return PANELS.running(s); },
    running(s) {
      const r = s.derived.currentRun;
      if (!r) return blankCell('Now running', 'no run selected');
      const est = window.parseDuration(r.estimate);
      const elapsed = s.derived.elapsed;
      const over = elapsed - est;
      const overTxt = over > 0
        ? `<span class="over">over by ${window.fmtDelta(over)}</span>`
        : `<span class="ok">${window.fmtDelta(over)} of estimate</span>`;
      const runners = (r.runners||[]).join(', ');
      return {
        title: 'Now running',
        badge: r.type && r.type !== 'SINGLE' ? r.type : '',
        html: `<div class="kpanel-current">
          <h2>${escapeHtml(r.game)}</h2>
          <div class="cat">${escapeHtml(runners || '—')} · ${escapeHtml(r.console || '—')}${r.category ? ' · ' + escapeHtml(r.category) : ''}</div>
          <div class="timer">${window.fmtHMS(elapsed)}</div>
          <div class="of">of ${window.fmtHMS(est)} — ${overTxt}</div>
        </div>`
      };
    },

    ondeck(s) { return PANELS.nextup(s); },
    nextup(s) {
      const rows = nextRuns(s, 5);
      if (!rows.length) return blankCell('Up next', 'nothing queued');
      return {
        title: 'Up next', badge: `next ${rows.length}`,
        html: `<div class="kpanel-ondeck">
          ${rows.map((r, i) => `
            <div class="row ${i === 0 ? 'queued' : ''}">
              <div class="when">${r.scheduledStart ? window.fmtTime(new Date(r.scheduledStart)) : '—'}</div>
              <div>
                <div class="nm">${escapeHtml(r.game)}<small>${escapeHtml((r.runners||[]).join(', '))} · ${escapeHtml(r.console || '—')}</small></div>
              </div>
              <div class="est">${window.fmtHM(window.parseDuration(r.estimate))}</div>
            </div>
          `).join('')}
        </div>`
      };
    },

    schedule(s) {
      return {
        title: 'Full schedule', badge: `${s.derived.runs.length} runs`,
        scroll: true,
        html: `<div class="kpanel-schedule">
          <table>
            <thead><tr>
              <th style="width:36px;color:var(--dim)">#</th>
              <th style="color:var(--dim);text-align:left">Game</th>
              <th style="width:80px;text-align:right;color:var(--dim)">Est.</th>
              <th style="width:70px;text-align:right;color:var(--dim)">Sched.</th>
              <th style="width:90px;color:var(--dim)">Status</th>
            </tr></thead>
            <tbody>
              ${s.schedule.filter(r => !r.setupBlock).slice(0, 80).map((r, i) => {
                const realIdx = s.schedule.indexOf(r);
                const isNow = realIdx === s.actualRunIndex;
                const isDone = realIdx < s.actualRunIndex;
                const status = isNow ? '<span class="pill-status now">● On air</span>'
                  : isDone ? '<span class="pill-status done">Done</span>'
                  : '<span class="pill-status up">Upcoming</span>';
                return `<tr class="${isNow ? 'now-row' : ''}">
                  <td style="color:var(--dim)">${String(realIdx+1).padStart(2,'0')}</td>
                  <td>${escapeHtml(r.game)}<br><small style="color:var(--dim)">${escapeHtml((r.runners||[]).join(', '))}</small></td>
                  <td style="text-align:right;font-family:'JetBrains Mono',monospace">${window.fmtHM(window.parseDuration(r.estimate))}</td>
                  <td style="text-align:right;color:var(--dim);font-family:'JetBrains Mono',monospace">${r.scheduledStart ? window.fmtTime(new Date(r.scheduledStart)) : '—'}</td>
                  <td>${status}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`
      };
    },

    controls(s) {
      const r = s.derived.currentRun;
      return {
        title: 'Timer controls', badge: r ? r.game : 'no run',
        html: `<div class="kpanel-controls">
          <div class="timer-big">${window.fmtHMS(s.derived.elapsed)}</div>
          <div class="row">
            <button class="ctrl-btn ${s.timerRunning ? 'primary' : 'go'}" onclick="window.kioskToggleTimer()">${s.timerRunning ? '■ Stop' : '▶ Start'}</button>
            <button class="ctrl-btn" onclick="window.wsSend('run:advance')">↦ Next</button>
            <button class="ctrl-btn" onclick="window.wsSend('timer:reset')">↺ Reset</button>
            <button class="ctrl-btn" onclick="window.wsSend('run:skip')">⏭ Skip</button>
          </div>
        </div>`
      };
    },

    log(s) {
      const items = (s.eventLog || []).slice().reverse().slice(0, 8);
      if (!items.length) return blankCell('Event log', 'no entries yet');
      return {
        title: 'Event log', badge: `${s.eventLog.length} entries`,
        scroll: true,
        html: `<div class="kpanel-log">
          ${items.map(e => `
            <div class="row"><span class="t">${escapeHtml(e.time || '')}</span> ${escapeHtml(e.message || '')}</div>
          `).join('')}
        </div>`
      };
    },

    message(s) {
      const text = s.messageText || '';
      const color = s.messageColor || 'var(--accent)';
      return {
        title: 'Message', badge: text ? 'broadcasting' : 'empty',
        html: `<div class="kpanel-message"><div class="text" style="color:${escapeAttr(color)}">${escapeHtml(text || '—')}</div></div>`
      };
    },

    marathon(s) { return PANELS.progress(s); },
    progress(s) {
      const stats = s.derived.stats;
      const actualPct = stats.runs ? (stats.completed / stats.runs) * 100 : 0;
      return {
        title: 'Marathon progress', badge: `${Math.round(actualPct)}% complete`,
        html: `<div class="kpanel-progress">
          <div class="grid">
            <div class="item"><div class="k">Runs done</div><div class="v">${stats.completed} / ${stats.runs}</div></div>
            <div class="item"><div class="k">Runners here</div><div class="v">${stats.runnersHere} / ${stats.allRunners}</div></div>
            <div class="item"><div class="k">Est. total</div><div class="v">${window.fmtHM(stats.totalEstimate)}</div></div>
            <div class="item"><div class="k">Setup</div><div class="v">${window.fmtHM(stats.totalSetup)}</div></div>
          </div>
          <div style="margin-top:18px"><div class="k" style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:var(--dim)">Completion</div></div>
          <div class="bar-wrap"><div class="fill" style="width:${actualPct}%"></div></div>
          <div class="pct"><span>${actualPct.toFixed(1)}% actual</span><span>${stats.runs} runs · ${stats.setups} setups</span></div>
        </div>`
      };
    },

    timing(s) {
      const r = s.derived.currentRun;
      const elapsed = s.derived.elapsed;
      const est = r ? window.parseDuration(r.estimate) : 0;
      const over = elapsed - est;
      return {
        title: 'Timing',
        html: `<div class="kpanel-progress" style="height:100%">
          <div class="grid">
            <div class="item"><div class="k">Elapsed</div><div class="v">${window.fmtHMS(elapsed)}</div></div>
            <div class="item"><div class="k">Estimate</div><div class="v">${window.fmtHMS(est)}</div></div>
            <div class="item"><div class="k">${over > 0 ? 'Over by' : 'Under by'}</div><div class="v" style="color:${over > 0 ? 'var(--hot)' : 'var(--accent)'}">${window.fmtDelta(over)}</div></div>
            <div class="item"><div class="k">Delta</div><div class="v">${window.fmtDelta(s.derived.delta)}</div></div>
          </div>
        </div>`
      };
    },

    twitch(s) {
      const ch = (s.twitchChannel || '').replace(/^https?:\/\/(www\.)?twitch\.tv\//, '').replace(/\/$/, '');
      if (!ch) return blankCell('Stream', 'no channel set');
      const parent = location.hostname;
      return {
        title: 'Stream', badge: '@' + ch,
        html: `<iframe src="https://player.twitch.tv/?channel=${encodeURIComponent(ch)}&parent=${encodeURIComponent(parent)}&muted=true" allow="autoplay" style="width:100%;height:100%;border:0;border-radius:6px"></iframe>`
      };
    },
  };

  function blankCell(title, msg) {
    return { title, html: `<div style="display:grid;place-items:center;height:100%;color:var(--dim);font-size:13px">${escapeHtml(msg)}</div>` };
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function nextRuns(s, count) {
    const start = Math.max(0, s.actualRunIndex) + (s.actualRunIndex < 0 ? 0 : 1);
    const out = [];
    for (let i = start; i < s.schedule.length && out.length < count; i++) {
      const r = s.schedule[i];
      if (r.setupBlock) continue;
      if (s.skippedRuns && s.skippedRuns.has(i)) continue;
      out.push(r);
    }
    return out;
  }

  // ---------- Build a render-friendly state snapshot
  function snapshot() {
    const S = window.STATE;
    if (!S) return null;
    const sched = S.schedule || [];
    const runs = sched.filter(r => !r.setupBlock);
    const cur = (S.actualRunIndex >= 0) ? sched[S.actualRunIndex] : null;
    const elapsed = window.elapsedNow ? window.elapsedNow() : (S.elapsedSeconds || 0);
    const actualStartDate = cur ? new Date(Date.now() - elapsed * 1000) : null;
    let delta = 0;
    if (cur && cur.scheduledStart) {
      delta = Math.round((new Date(cur.scheduledStart) - actualStartDate) / 1000);
    }
    const allRunners = new Set();
    runs.forEach(r => (r.runners||[]).forEach(n => { if (n && n !== 'Unknown') allRunners.add(n); }));
    const runnersHere = [...allRunners].filter(n => S.runnerStatus[n] === 'here').length;
    const completed = S.actualRunIndex >= 0 ? sched.slice(0, S.actualRunIndex).filter(r => !r.setupBlock).length : 0;
    const totalEstimate = runs.reduce((a, r) => a + window.parseDuration(r.estimate), 0);
    const totalSetup = sched.reduce((a, r) => a + window.parseDuration(r.setupTime), 0);
    // pre-marathon
    let preMarathon = false, preMarathonCountdown = '';
    if (sched.length && new Date() < new Date(sched[0].scheduledStart)) {
      preMarathon = true;
      const sec = Math.max(0, Math.floor((new Date(sched[0].scheduledStart) - new Date()) / 1000));
      preMarathonCountdown = window.fmtHMS(sec);
    }
    return {
      ...S,
      derived: {
        currentRun: cur,
        elapsed,
        delta,
        actualStartDate,
        runs,
        stats: { runs: runs.length, setups: sched.length - runs.length, completed, runnersHere, allRunners: allRunners.size, totalEstimate, totalSetup },
        preMarathon, preMarathonCountdown,
      }
    };
  }

  // ---------- Render kiosk
  let configCache = { layout: '2x2', panels: ['delta', 'running', 'controls', 'ondeck'] };
  function loadConfig() {
    try {
      const saved = localStorage.getItem('sched-kiosk-config');
      if (saved) {
        const cfg = JSON.parse(saved);
        if (cfg.layout) configCache.layout = cfg.layout;
        if (Array.isArray(cfg.panels)) configCache.panels = cfg.panels;
      }
    } catch {}
  }
  function saveConfig(layout, panels) {
    configCache.layout = layout;
    configCache.panels = panels;
    try { localStorage.setItem('sched-kiosk-config', JSON.stringify(configCache)); } catch {}
  }

  function render() {
    const s = snapshot();
    if (!s) return;
    const layout = LAYOUTS[configCache.layout] || LAYOUTS['2x2'];
    let overlay = document.getElementById('kioskOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'kioskOverlay';
      overlay.className = 'kiosk-overlay';
      document.body.appendChild(overlay);
    }
    let st = `grid-template-columns:${layout.cols};grid-template-rows:${layout.rows};`;
    if (layout.areas) st += `grid-template-areas:${layout.areas};`;
    overlay.setAttribute('style', st);

    // Top hover bar
    let html = `
      <div class="kiosk-bar">
        <span class="kiosk-bar-title">Kiosk · ${escapeHtml(layout.name)} · ${escapeHtml(configCache.panels.join(' / '))}</span>
        <div class="kiosk-bar-actions">
          <button onclick="window.kioskCycleLayout()">⊞ Layout: ${escapeHtml(configCache.layout)}</button>
          <button onclick="window.kioskExit()">Exit kiosk</button>
        </div>
      </div>
    `;

    const areaNames = layout.areas
      ? [...new Set(layout.areas.replace(/"/g, '').split(/\s+/).filter(a => a && a !== '.'))]
      : null;

    for (let i = 0; i < layout.cells; i++) {
      const panelId = configCache.panels[i] || null;
      const area = areaNames ? areaNames[i] : null;
      const styleAttr = area ? ` style="grid-area:${area}"` : '';
      if (!panelId) {
        html += `<div class="kiosk-cell"${styleAttr}><div class="kc-body"><div style="display:grid;place-items:center;height:100%;color:var(--dimmer);font-size:12px">Empty cell</div></div></div>`;
        continue;
      }
      const fn = PANELS[panelId];
      if (!fn) {
        html += `<div class="kiosk-cell"${styleAttr}><div class="kc-body"><div style="display:grid;place-items:center;height:100%;color:var(--dim);font-size:12px">${escapeHtml(panelId)} (not available)</div></div></div>`;
        continue;
      }
      const out = fn(s);
      html += `
        <div class="kiosk-cell"${styleAttr}>
          <div class="kc-head"><h3>${escapeHtml(out.title)}</h3>${out.badge ? `<span class="badge">${escapeHtml(out.badge)}</span>` : ''}</div>
          <div class="kc-body${out.scroll ? ' scroll' : ''}">${out.html}</div>
        </div>
      `;
    }
    overlay.innerHTML = html;
  }

  // ---------- Boot
  function isKioskUrl() {
    return new URLSearchParams(location.search).get('kiosk') === '1';
  }
  function enterKiosk() {
    document.body.classList.add('kiosk-mode');
    loadConfig();
    render();
    // hook into state updates: just re-render on every tick (cheap, scoped to overlay)
    if (!window.__kioskTimer) {
      window.__kioskTimer = setInterval(render, 1000);
    }
  }
  function exitKiosk() {
    document.body.classList.remove('kiosk-mode');
    const o = document.getElementById('kioskOverlay');
    if (o) o.remove();
    if (window.__kioskTimer) { clearInterval(window.__kioskTimer); window.__kioskTimer = null; }
    // strip ?kiosk=1
    const u = new URL(location.href);
    u.searchParams.delete('kiosk');
    location.replace(u.toString());
  }
  function cycleLayout() {
    const keys = Object.keys(LAYOUTS);
    const cur = keys.indexOf(configCache.layout);
    const next = keys[(cur + 1) % keys.length];
    saveConfig(next, configCache.panels);
    render();
  }
  function setLayout(key, panels) { saveConfig(key, panels || configCache.panels); render(); }
  function toggleTimer() {
    if (window.STATE.timerRunning) window.wsSend('timer:stop');
    else window.wsSend('timer:start', { seconds: window.STATE.elapsedSeconds || 0 });
  }

  // Public API
  window.Kiosk = { isKioskUrl, enter: enterKiosk, exit: exitKiosk, cycleLayout, setLayout, render, LAYOUTS };
  window.kioskExit = exitKiosk;
  window.kioskCycleLayout = cycleLayout;
  window.kioskToggleTimer = toggleTimer;

  // Auto-boot when DOM ready, if ?kiosk=1
  function boot() { if (isKioskUrl()) enterKiosk(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
