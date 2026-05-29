// Tab content templates for production Conductor.
// Each receives a context object with schedule data + state from app.js.

window.TABS = {

  // ------------------------------------------------------------ SCHEDULE
  schedule(ctx) {
    const { schedule, helpers } = ctx;
    const { parseDuration, fmtHM, fmtTime, escapeHtml } = helpers;
    const stats = ctx.stats;
    const counts = {
      all: schedule.filter(r => !r.setupBlock).length,
      live: schedule.filter((r, i) => !r.setupBlock && i >= ctx.actualRunIndex).length,
      up: schedule.filter((r, i) => !r.setupBlock && i > ctx.actualRunIndex).length,
      done: schedule.filter((r, i) => !r.setupBlock && i < ctx.actualRunIndex).length,
      late: schedule.filter((r, i) => ctx.runnerStatus[i] === 'missing').length,
    };
    return `
      <div class="sec-head">
        <h2>Full schedule<small>${stats.runs} runs · ${fmtHM(stats.totalEstimate)} estimate · ${fmtHM(stats.totalSetup)} setup</small></h2>
        <div class="right">
          <input class="filter-input wide" id="filter-input" placeholder="⌕ Filter game, runner, console…" value="${escapeHtml(ctx.filter || '')}">
          <div class="chip-filter ${ctx.filterTag==='live'?'active':''}" data-tag="live">Current + Upcoming <span class="ct">${counts.live}</span></div>
          <div class="chip-filter ${ctx.filterTag==='all'?'active':''}" data-tag="all">All <span class="ct">${counts.all}</span></div>
          <div class="chip-filter ${ctx.filterTag==='up'?'active':''}" data-tag="up">Upcoming only <span class="ct">${counts.up}</span></div>
          <div class="chip-filter ${ctx.filterTag==='late'?'active':''}" data-tag="late">Runners missing <span class="ct">${counts.late}</span></div>
          <div class="chip-filter ${ctx.filterTag==='done'?'active':''}" data-tag="done">Done <span class="ct">${counts.done}</span></div>
        </div>
      </div>
      <table class="sched-table">
        <thead>
          <tr>
            <th style="width:46px">#</th>
            <th>Game</th>
            <th>Runner</th>
            <th>Console</th>
            <th style="width:78px">Estimate</th>
            <th style="width:64px">Setup</th>
            <th style="width:70px">Scheduled</th>
            <th style="width:70px">Predicted</th>
            <th style="width:70px">Actual</th>
            <th style="width:118px">Status</th>
            <th style="width:36px"></th>
          </tr>
        </thead>
        <tbody id="schedule-rows">${window.TABS.scheduleRows(ctx)}</tbody>
      </table>
    `;
  },

  scheduleRows(ctx) {
    const { schedule, helpers, filter, filterTag, actualRunIndex, selectedRunIndex, runnerStatus, skippedRuns, deltaSec, actualTimes, runEdits } = ctx;
    const { parseDuration, fmtHM, fmtTime, escapeHtml } = helpers;
    const f = (filter || '').trim().toLowerCase();
    const fmtClock = (date) => date ? fmtTime(date) : '—';
    const secsToToday = (secs) => {
      if (secs == null) return null;
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return new Date(d.getTime() + secs * 1000);
    };
    return schedule.map((r, i) => {
      // Setup rows
      if (r.setupBlock) {
        const setupSec = parseDuration(r.setupTime || 'PT0S') + parseDuration(r.estimate || 'PT0S');
        // Show in all/live; hide in narrower filters
        if (filterTag === 'up' || filterTag === 'done' || filterTag === 'late') return '';
        if (filterTag === 'live' && i < ctx.actualRunIndex) return '';
        if (f) return '';
        const sched = r.scheduledStart ? fmtTime(new Date(r.scheduledStart)) : '—';
        return `
          <tr class="setup-row" data-idx="${i}">
            <td class="t" style="color:var(--dimmer)">—</td>
            <td colspan="3" class="game" style="font-style:italic;color:var(--dim)">${escapeHtml(r.setupBlockText || 'Setup / interlude')}</td>
            <td class="t">${fmtHM(setupSec)}</td>
            <td class="t">—</td>
            <td class="t" style="color:var(--dim)">${sched}</td>
            <td class="t" style="color:var(--dim)">—</td>
            <td class="t" style="color:var(--dim)">—</td>
            <td><span class="pill-status done">Setup</span></td>
            <td class="edit-cell"></td>
          </tr>
        `;
      }
      const matches = !f || ((r.game + ' ' + (r.runners||[]).join(' ') + ' ' + (r.console||'')).toLowerCase().includes(f));
      if (!matches) return '';
      const isNow = i === actualRunIndex;
      const isDone = i < actualRunIndex;
      const rStatus = runnerStatus[i];
      const missing = rStatus === 'missing';
      if (filterTag === 'up'   && (isNow || isDone)) return '';
      if (filterTag === 'live' && isDone) return '';
      if (filterTag === 'done' && !isDone) return '';
      if (filterTag === 'late' && !missing) return '';
      let status, pillCls;
      if (isNow)                                 { status = '● On air';        pillCls = 'now'; }
      else if (isDone)                           { status = 'Done';            pillCls = 'done'; }
      else if (missing)                          { status = 'Runner missing';  pillCls = 'late'; }
      else if (skippedRuns && skippedRuns.has(i)){ status = 'Skipped';         pillCls = 'done'; }
      else if (rStatus === 'ready')              { status = 'Ready';           pillCls = 'up'; }
      else                                       { status = 'Upcoming';        pillCls = 'up'; }
      const typeBadge = r.type && r.type !== 'SINGLE' ? `<span class="type-badge ${r.type.toLowerCase()}">${r.type.toLowerCase()}</span>` : '';
      const cls = (isNow ? 'now-row ' : '') + (i === selectedRunIndex ? 'selected' : '');
      const schedDate = r.scheduledStart ? new Date(r.scheduledStart) : null;
      const sched = schedDate ? fmtTime(schedDate) : '—';
      const setupSec = parseDuration(r.setupTime || 'PT0S');
      const edit = (runEdits && runEdits[i]) || {};
      // Actual start (wallclock)
      let actualStartDate = null;
      if (edit.actualStart != null) actualStartDate = secsToToday(edit.actualStart);
      else if (isNow) actualStartDate = new Date(Date.now() - (ctx.elapsedSec || 0) * 1000);
      // Actual end (wallclock) for completed runs
      let actualEndDate = null;
      if (edit.actualEnd != null) actualEndDate = secsToToday(edit.actualEnd);
      else if (isDone && actualTimes && actualTimes[i] != null && actualStartDate) {
        actualEndDate = new Date(actualStartDate.getTime() + actualTimes[i] * 1000);
      }
      // Predicted
      let predictedDate;
      if (isDone) predictedDate = actualStartDate;
      else if (isNow) predictedDate = actualStartDate;
      else if (schedDate) predictedDate = new Date(schedDate.getTime() - (deltaSec || 0) * 1000);
      const actualCell = isDone
        ? (actualStartDate ? fmtClock(actualStartDate) : '—')
        : isNow ? (actualStartDate ? fmtClock(actualStartDate) : '—') : '—';
      const predClass = predictedDate && schedDate && Math.abs(predictedDate - schedDate) > 900000
        ? (predictedDate > schedDate ? 'behind' : 'ahead') : '';
      return `
        <tr class="${cls.trim()}" data-idx="${i}">
          <td class="t" style="color:var(--dim)">${String(i+1).padStart(2,'0')}</td>
          <td class="game">${escapeHtml(r.game)}${typeBadge}${r.category?`<small>${escapeHtml(r.category)}</small>`:''}</td>
          <td>${escapeHtml((r.runners||[]).join(', '))}</td>
          <td style="color:var(--dim)">${escapeHtml(r.console || '—')}</td>
          <td class="t">${fmtHM(parseDuration(r.estimate))}</td>
          <td class="t" style="color:var(--dim)">${setupSec ? '+' + fmtHM(setupSec) : '—'}</td>
          <td class="t" style="color:var(--dim)">${sched}</td>
          <td class="t adj ${predClass}">${predictedDate ? fmtClock(predictedDate) : '—'}</td>
          <td class="t">${actualCell}</td>
          <td><span class="pill-status ${pillCls}">${status}</span></td>
          <td class="edit-cell"><button class="row-edit-btn" data-idx="${i}" title="Edit timing">✎</button></td>
        </tr>
      `;
    }).join('');
  },

  // ------------------------------------------------------------ STREAM CAPTURE
  capture(ctx) {
    const { escapeHtml } = ctx.helpers;
    const channel = ctx.twitchChannel || '';
    const cur = ctx.schedule[ctx.actualRunIndex];
    const result = ctx.captureResult;
    // Server returns a full `data:image/png;base64,...` URI — embed it verbatim.
    const frameBg = result?.frameBase64
      ? `background: #050608 url(${result.frameBase64}) center/cover no-repeat;`
      : '';
    const allTimers = (result?.allTimers || []).map(t => t.display || t);
    // matchedGames is an array of { name, confidence } sorted desc by confidence on the server.
    const matched = result?.matchedGames || [];
    const topMatch = matched[0] || null;
    const elapsedStr = result?.elapsed?.display || result?.elapsed || '';
    const estimateStr = result?.estimate?.display || result?.estimate || '';
    const isLoading = ctx.captureStatus === 'loading';
    const hasError  = ctx.captureStatus === 'error';
    return `
      <div class="sec-head">
        <h2>Stream capture<small>OCR-based timer verification</small></h2>
        <div class="right">
          <button class="ctrl-btn ${isLoading ? '' : 'go'}" id="cap-go" ${isLoading ? 'disabled' : ''}>${isLoading ? '⏳ Capturing…' : '↻ Re-capture now'}</button>
        </div>
      </div>

      <div class="capture-grid">
        <div>
          <!-- Single big preview frame. Two OCR badges overlay it instead of a phantom second panel. -->
          <div class="capture-frame capture-frame-big ${isLoading ? 'is-loading' : ''}" style="${frameBg}">
            ${isLoading ? `
              <div class="cap-loading-overlay">
                <div class="cap-spinner"></div>
                <div class="cap-loading-text">Capturing & OCR-ing…</div>
                <div class="cap-loading-sub">streamlink → ffmpeg → Claude Vision. Usually 4–8s.</div>
              </div>
            ` : ''}
            ${!isLoading && !result ? `
              <div class="cap-empty">
                <div class="cap-empty-title">No capture yet</div>
                <div class="cap-empty-sub">Set a Twitch channel on the right, then click <b>Capture &amp; OCR</b>.</div>
              </div>
            ` : ''}
            ${!isLoading && result ? `
              <span class="label">Captured frame · ${new Date(result.capturedAt || Date.now()).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>
              ${elapsedStr ? `<div class="timer-ocr timer-elapsed"><span class="lbl">elapsed</span>${escapeHtml(elapsedStr)}</div>` : ''}
              ${estimateStr ? `<div class="timer-ocr timer-estimate"><span class="lbl">est</span>${escapeHtml(estimateStr)}</div>` : ''}
            ` : ''}
          </div>

          ${hasError ? `<div class="cap-error">${escapeHtml(ctx.captureError || 'Capture failed.')}</div>` : ''}

          ${result && elapsedStr ? `
            <!-- Big, obviously-actionable Apply call-to-action with the proposed change shown inline. -->
            <div class="cap-apply-card ${topMatch ? 'with-match' : 'no-match'}">
              <div class="cap-apply-summary">
                <div class="cap-apply-eyebrow">${topMatch ? 'Detected on stream' : 'No game match'}</div>
                <div class="cap-apply-line"><b>${topMatch ? escapeHtml(topMatch.name) : '—'}</b>
                  ${topMatch ? `<span class="cap-apply-conf">${Math.round((topMatch.confidence||0)*100)}% confident</span>` : ''}
                </div>
                <div class="cap-apply-line cap-apply-sub">
                  Timer ${escapeHtml(elapsedStr)} · detected via <span class="mono">${escapeHtml(result.detectionMethod || 'heuristic')}</span>
                </div>
              </div>
              <button class="cap-apply-btn" id="cap-apply">
                <span class="cap-apply-icon">↥</span>
                <span>
                  <span class="cap-apply-btn-line">Apply to live timer</span>
                  <span class="cap-apply-btn-sub">Sets run + starts timer with OCR delay compensated</span>
                </span>
              </button>
            </div>
          ` : ''}

          ${matched.length > 1 ? `
            <div class="capture-history">
              <h4>Other matches</h4>
              ${matched.slice(1, 6).map(m => `<div class="row"><span class="mono">${Math.round((m.confidence||0)*100)}%</span><span>${escapeHtml(m.name)}</span><span></span><span></span></div>`).join('')}
            </div>
          ` : ''}

          ${allTimers.length ? `
            <div class="capture-history">
              <h4>All timers detected</h4>
              ${allTimers.map(t => `<div class="row"><span>—</span><span class="mono">${escapeHtml(t)}</span><span></span><span></span></div>`).join('')}
            </div>
          ` : ''}

          ${result?.rawText ? `
            <details class="cap-raw-details">
              <summary>Raw OCR text</summary>
              <div class="raw">${escapeHtml(result.rawText)}</div>
            </details>
          ` : ''}
        </div>
        <aside class="capture-side">
          <h3>Source</h3>
          <div class="field">
            <label>Twitch channel</label>
            <input id="cap-channel" value="${escapeHtml(channel)}" placeholder="twitch.tv/your-channel">
          </div>
          <div class="field">
            <label>Match against current</label>
            <input value="${escapeHtml(cur ? cur.game : '—')}" readonly style="color:var(--dim)">
          </div>
          <button class="ctrl-btn go" id="cap-go" style="width:100%">↻ Capture &amp; OCR</button>
          <div style="margin-top:18px;padding-top:18px;border-top:1px solid var(--line);font-size:12px;color:var(--dim);line-height:1.6">
            <b style="color:var(--ink-soft);font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.16em;text-transform:uppercase">How it works</b><br>
            Grabs a single frame from the live Twitch stream, sends it to Claude Vision with the schedule for context, and returns the elapsed timer, estimate, and matched game.
          </div>
        </aside>
      </div>
    `;
  },

  // ------------------------------------------------------------ MESSAGE PANEL
  message(ctx) {
    const { escapeHtml } = ctx.helpers;
    const text = ctx.messageText || '';
    const color = ctx.messageColor || '#f87171';
    const colors = ['#34d399','#f87171','#fbbf24','#22d3ee','#60a5fa','#1d4ed8','#a78bfa','#f472b6','#ebedf1'];
    return `
      <div class="sec-head">
        <h2>Message panel<small>Overlay text shown on kiosk message-only views</small></h2>
      </div>
      <div class="msg-grid">
        <div class="msg-editor">
          <textarea id="msg-text" placeholder="Type a message to display on the kiosk…">${escapeHtml(text)}</textarea>
          <div class="msg-colors">
            <label>Color:</label>
            ${colors.map(c => `<div class="sw ${c.toLowerCase()===color.toLowerCase()?'selected':''}" style="background:${c}" data-c="${c}"></div>`).join('')}
          </div>
          <div class="msg-presets">
            <div class="msg-preset">Please hold</div>
            <div class="msg-preset">Technical issues</div>
            <div class="msg-preset">Be right back</div>
            <div class="msg-preset">Runner change</div>
            <div class="msg-preset">Message board</div>
          </div>
          <div class="msg-actions">
            <button class="ctrl-btn go" id="msg-send">Send to kiosk</button>
            <button class="ctrl-btn ghost" id="msg-clear">Clear</button>
          </div>
        </div>
        <div class="msg-preview">
          <h3>Live preview</h3>
          <div class="kiosk"><div class="msg" id="msg-preview-text" style="color:${escapeHtml(color)}">${escapeHtml(text || ' ')}</div></div>
          <div class="meta">Active message ${text ? 'is being broadcast' : 'is empty — nothing showing'}</div>
        </div>
      </div>
    `;
  },

  // ------------------------------------------------------------ KIOSK CONFIG
  kiosk(ctx) {
    const layouts = [
      { id: '1x1', cells: [{}], cols: '1fr', rows: '1fr', lbl: '1×1 full' },
      { id: '1x2', cells: [{}, {}], cols: '1fr', rows: '1fr 1fr', lbl: '1×2 stack' },
      { id: '2x1', cells: [{}, {}], cols: '1fr 1fr', rows: '1fr', lbl: '2×1 split' },
      { id: '2x2', cells: [{}, {}, {}, {}], cols: '1fr 1fr', rows: '1fr 1fr', lbl: '2×2 quad' },
      { id: '1+2', cells: [{ span: 2 }, {}, {}], cols: '1fr 1fr', rows: '1fr 1fr', lbl: '1+2 host', selected: true },
      { id: '2+1', cells: [{}, {}, { span: 2 }], cols: '1fr 1fr', rows: '1fr 1fr', lbl: '2+1' },
      { id: '3x3', cells: Array.from({length:9}).map(()=>({})), cols: '1fr 1fr 1fr', rows: '1fr 1fr 1fr', lbl: '3×3 grid' },
      { id: '1+3', cells: [{ span: 3 }, {}, {}, {}], cols: '1fr 1fr 1fr', rows: '1fr 1fr', lbl: '1+3' },
      { id: 'sb', cells: [{}, {}], cols: '1fr 2fr', rows: '1fr', lbl: 'sidebar' },
      { id: '2+3', cells: [{ span: 3 }, {}, {}, {}], cols: '1fr 1fr 1fr', rows: '1fr 1fr', lbl: '2+3' },
    ];
    const layoutHtml = layouts.map(L => `
      <div class="kiosk-layout ${L.selected?'selected':''}" data-id="${L.id}" style="grid-template-columns:${L.cols};grid-template-rows:${L.rows}">
        ${L.cells.map(c => {
          const st = c.span ? `grid-column: span ${c.span}` : '';
          return `<div class="cell"${st?` style="${st}"`:''}></div>`;
        }).join('')}
        <span class="lbl">${L.lbl}</span>
      </div>
    `).join('');
    const kioskUrl = `${location.pathname}?kiosk=1${location.hash}`;
    return `
      <div class="sec-head">
        <h2>Kiosk config<small>Multi-panel display for role-specific views</small></h2>
        <div class="right">
          <button class="ctrl-btn sm" onclick="window.open('${kioskUrl}','_blank','width=1280,height=800')">↗ Pop out window</button>
        </div>
      </div>
      <div class="kiosk-grid">
        <div>
          <h3 style="margin:0 0 26px;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:var(--dim);font-weight:600">Layout</h3>
          <div class="kiosk-layouts">${layoutHtml}</div>
          <div class="kiosk-cells">
            <div class="kiosk-cell-pick">
              <div class="h">URL</div>
              <input value="${kioskUrl}" readonly style="font-size:11px">
            </div>
            <div class="kiosk-cell-pick">
              <div class="h">Tip</div>
              <div style="color:var(--dim);font-size:12px;line-height:1.5">Layout selection wires into the existing kiosk renderer; pick a layout, then "Pop out" to launch.</div>
            </div>
          </div>
        </div>
        <aside class="kiosk-preview">
          <h3>Quick presets</h3>
          <div class="kiosk-presets">
            <div class="kiosk-preset" style="border-color:var(--accent)" data-preset="host">
              <div class="ico" style="background:linear-gradient(to right,var(--accent) 60%, var(--panel2) 60%)"></div>
              <div class="nm">Host view<small>1+2 · delta + running + on-deck</small></div>
              <span class="arrow">→</span>
            </div>
            <div class="kiosk-preset" data-preset="tech">
              <div class="ico" style="background:linear-gradient(to right,var(--panel2) 50%, var(--signal) 50%)"></div>
              <div class="nm">Tech view<small>2×2 · controls + running + log + on-deck</small></div>
              <span class="arrow">→</span>
            </div>
            <div class="kiosk-preset" data-preset="sched">
              <div class="ico" style="background:var(--warn);opacity:.5"></div>
              <div class="nm">Schedule only<small>1×1 · full schedule</small></div>
              <span class="arrow">→</span>
            </div>
            <div class="kiosk-preset" data-preset="green">
              <div class="ico" style="background:linear-gradient(135deg,#a78bfa,#6d28d9)"></div>
              <div class="nm">Runner green room<small>2+1 · on-deck + running + schedule</small></div>
              <span class="arrow">→</span>
            </div>
            <div class="kiosk-preset" data-preset="message">
              <div class="ico" style="background:#ebedf1"></div>
              <div class="nm">Message board<small>1×1 · big text on solid background</small></div>
              <span class="arrow">→</span>
            </div>
          </div>
        </aside>
      </div>
    `;
  },

  // ------------------------------------------------------------ PROGRESS
  progress(ctx) {
    const { stats, helpers, schedule, actualRunIndex } = ctx;
    const { fmtHM, fmtTime, parseDuration } = helpers;
    const totalSec = stats.totalEstimate + stats.totalSetup;
    let elapsedSchedSec = 0;
    if (schedule.length) {
      const start = new Date(schedule[0].scheduledStart).getTime();
      elapsedSchedSec = Math.max(0, (Date.now() - start) / 1000);
    }
    const actualPct = totalSec ? (stats.completed / stats.runs) * 100 : 0;
    const schedPct = totalSec ? Math.min(100, (elapsedSchedSec / totalSec) * 100) : 0;
    const runnersList = Object.entries(ctx.runnerStatus);
    return `
      <div class="sec-head"><h2>Marathon progress<small>${ctx.marathonInfo?.name || ''}</small></h2></div>
      <div class="progress-grid">
        <div class="prog-card accent"><div class="k">Runs done</div><div class="v">${stats.completed}<small> / ${stats.runs}</small></div><div class="s">${Math.round(actualPct)}% complete</div></div>
        <div class="prog-card"><div class="k">Currently running</div><div class="v">${actualRunIndex>=0?String(actualRunIndex+1).padStart(2,'0'):'—'}</div><div class="s">${actualRunIndex>=0?schedule[actualRunIndex]?.game||'—':'no run selected'}</div></div>
        <div class="prog-card"><div class="k">Runners on-site</div><div class="v">${stats.runnersHere}<small> / ${stats.allRunners}</small></div><div class="s">${stats.allRunners?Math.round(stats.runnersHere/stats.allRunners*100):0}% here</div></div>
        <div class="prog-card"><div class="k">Total estimate</div><div class="v">${fmtHM(stats.totalEstimate)}</div><div class="s">across ${stats.runs} runs</div></div>
        <div class="prog-card"><div class="k">Total setup</div><div class="v">${fmtHM(stats.totalSetup)}</div><div class="s">${totalSec?Math.round(stats.totalSetup/totalSec*100):0}% of marathon</div></div>
        <div class="prog-card"><div class="k">Marathon start</div><div class="v">${schedule.length ? fmtTime(new Date(schedule[0].scheduledStart)) : '—'}</div><div class="s">scheduled</div></div>
        <div class="prog-card"><div class="k">Total time</div><div class="v">${fmtHM(totalSec)}</div><div class="s">estimate + setup</div></div>
        <div class="prog-card"><div class="k">Setup blocks</div><div class="v">${stats.setups}</div><div class="s">in schedule</div></div>
      </div>
      <div class="progress-bar-big">
        <h3>Marathon completion · scheduled vs. actual</h3>
        <div class="bar">
          <div class="fill" style="width:${actualPct}%"></div>
          <div class="marker-sched" style="left:${schedPct}%"></div>
        </div>
        <div class="legend">
          <span>start</span>
          <span style="color:var(--accent)">${actualPct.toFixed(1)}% actual</span>
          <span style="color:var(--ink)">${schedPct.toFixed(1)}% scheduled</span>
          <span>end</span>
        </div>
      </div>
      <div class="attendance">
        <h3>Runner status <span style="color:var(--dim);font-weight:500">${runnersList.length} tracked</span></h3>
        <div class="grid">
          ${runnersList.length ? runnersList.map(([nm, st], i) => `
            <div class="pers">
              <div class="avatar a${(i % 5) + 1}">${(nm[0]||'?').toUpperCase()}</div>
              <div class="nm">${helpers.escapeHtml(nm)}<small>${st}</small></div>
              <span class="chip ${st === 'late' ? 'late' : st === 'away' ? 'away' : 'here'}">${st}</span>
            </div>
          `).join('') : '<div style="color:var(--dim);font-size:13px">No runner status set yet — click runner pills in the detail panel to mark check-ins.</div>'}
        </div>
      </div>
    `;
  },

  // ------------------------------------------------------------ EVENT LOG
  log(ctx) {
    const { eventLog, helpers } = ctx;
    const { escapeHtml, fmtTime } = helpers;
    return `
      <div class="sec-head">
        <h2>Event log<small>${eventLog.length} entries · marathon-local times</small></h2>
      </div>
      <div class="log-composer">
        <input id="log-input" placeholder="Type a log entry and press Enter…">
        <div class="tag-pick">
          <button class="selected" data-tag="note">Note</button>
          <button data-tag="tech">Tech</button>
          <button data-tag="runner">Runner</button>
          <button data-tag="start">Start</button>
        </div>
        <button class="ctrl-btn go sm" id="log-add">Add</button>
      </div>
      <table class="log-table">
        <tbody>
          ${eventLog.length ? eventLog.map(e => {
            const tag = (e.type || 'note').toLowerCase();
            const t = e.timestamp ? fmtTime(new Date(e.timestamp)) : '';
            return `
              <tr>
                <td class="t">${escapeHtml(t)}</td>
                <td class="cat"><span class="log-tag ${tag}">${tag}</span></td>
                <td><div>${escapeHtml(e.text || '')}</div><div class="ctx">${escapeHtml(e.runName || '')}</div></td>
              </tr>
            `;
          }).join('') : '<tr><td colspan="3" style="text-align:center;color:var(--dim);padding:32px">No log entries yet.</td></tr>'}
        </tbody>
      </table>
    `;
  }
};
