// production/conductor/mobile.js
// Mobile shell layered on top of the desktop Conductor.
//
// Responsibilities:
//   - Detect mobile / touch and switch the body into mobile mode
//   - Render the bottom-nav and drawer
//   - Route the body view (Now / Up next / Schedule / Log / More)
//   - Swipe between Now / Up next / Schedule
//   - Long-press a schedule row or up-next card → bottom sheet
//   - Pull-to-refresh → reloads schedule from REST
//   - Haptic feedback wrapper
//   - Wake Lock while timer is running
//
// Touch-first; idempotent if loaded on desktop (no-ops above 820px
// and on coarse pointers).

(function() {
  const isMobileWidth = () => window.innerWidth <= 820;
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

  if (isTouch) document.documentElement.classList.add('touch-device');

  // ---------- HAPTICS ----------
  function haptic(pattern) {
    if (!('vibrate' in navigator)) return;
    try { navigator.vibrate(pattern); } catch {}
  }
  window.Haptic = {
    light:   () => haptic(8),
    medium:  () => haptic(14),
    heavy:   () => haptic(28),
    success: () => haptic([10, 30, 10]),
    warning: () => haptic([20, 40, 20]),
    error:   () => haptic([30, 50, 30, 50, 30]),
  };

  // ---------- WAKE LOCK ----------
  let wakeLock = null;
  async function acquireWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); }
    catch (e) { /* user can deny; that's fine */ }
  }
  function releaseWakeLock() {
    if (wakeLock) { try { wakeLock.release(); } catch {} wakeLock = null; }
  }
  window.MobileWakeLock = { acquire: acquireWakeLock, release: releaseWakeLock };
  // Re-acquire on visibility (browsers drop it when tab hidden)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && window.STATE && window.STATE.timerRunning) acquireWakeLock();
  });

  // ---------- MOBILE SHELL DOM ----------
  let shellInjected = false;
  function injectShell() {
    if (shellInjected) return;
    shellInjected = true;

    // Bottom nav
    const nav = document.createElement('nav');
    nav.className = 'mobile-nav';
    nav.id = 'mobileNav';
    nav.innerHTML = `
      <button data-mv="now" class="active"><span class="ico">▶</span>Now</button>
      <button data-mv="upnext"><span class="ico">⇥</span>Up next</button>
      <button data-mv="schedule"><span class="ico">▦</span>Schedule</button>
      <button data-mv="log"><span class="ico">✎</span>Log<span class="badge hidden" id="logBadge">0</span></button>
      <button data-mv="more"><span class="ico">⋯</span>More</button>
    `;
    document.body.appendChild(nav);

    // Sticky action bar (Now view only)
    const ab = document.createElement('div');
    ab.className = 'mobile-action-bar';
    ab.id = 'mobileActionBar';
    ab.innerHTML = `
      <button id="mab-primary" class="next" type="button"><span class="ico">▶</span>Start</button>
      <button id="mab-next" class="next" type="button"><span class="ico">↦</span>Next run</button>
    `;
    document.body.appendChild(ab);

    // Drawer (More)
    const dbk = document.createElement('div');
    dbk.className = 'mobile-drawer-backdrop';
    dbk.id = 'mobileDrawerBackdrop';
    document.body.appendChild(dbk);
    const drw = document.createElement('div');
    drw.className = 'mobile-drawer';
    drw.id = 'mobileDrawer';
    drw.innerHTML = `
      <div class="grabber"></div>
      <h3>More</h3>
      <ul class="drawer-list">
        <li data-act="back"><div class="ico">↤</div><div class="lbl"><div class="t">Back to previous run</div><div class="s">Re-select the previous run as current</div></div><span class="chev">›</span></li>
        <li data-act="capture"><div class="ico">📷</div><div class="lbl"><div class="t">Stream capture</div><div class="s">OCR-verify timer</div></div><span class="chev">›</span></li>
        <li data-act="message"><div class="ico">📋</div><div class="lbl"><div class="t">Message panel</div><div class="s">Overlay text on kiosk</div></div><span class="chev">›</span></li>
        <li data-act="kiosk"><div class="ico">⊞</div><div class="lbl"><div class="t">Kiosk config</div><div class="s">Pop out & assign panels</div></div><span class="chev">›</span></li>
        <li data-act="progress"><div class="ico">📊</div><div class="lbl"><div class="t">Marathon progress</div><div class="s">Overall stats</div></div><span class="chev">›</span></li>
        <li data-act="palette"><div class="ico">⌕</div><div class="lbl"><div class="t">Jump / command</div><div class="s">Search games, runners, actions</div></div><span class="chev">›</span></li>
        <li data-act="change"><div class="ico">⏏</div><div class="lbl"><div class="t">Change schedule</div><div class="s">Load a different marathon</div></div><span class="chev">›</span></li>
      </ul>
    `;
    document.body.appendChild(drw);

    // Bottom sheet (long-press run actions)
    const sbk = document.createElement('div');
    sbk.className = 'bottom-sheet-backdrop';
    sbk.id = 'sheetBackdrop';
    document.body.appendChild(sbk);
    const sht = document.createElement('div');
    sht.className = 'bottom-sheet';
    sht.id = 'runSheet';
    sht.innerHTML = `
      <div class="grabber"></div>
      <header><div class="title" id="rs-title">—</div><div class="sub" id="rs-sub">—</div></header>
      <ul class="actions" id="rs-actions"></ul>
    `;
    document.body.appendChild(sht);

    // PTR indicator
    const ptr = document.createElement('div');
    ptr.className = 'ptr-indicator';
    ptr.id = 'ptrIndicator';
    ptr.innerHTML = '<div class="spin"></div><span id="ptr-text">Pull to refresh</span>';
    document.body.appendChild(ptr);

    // Wire bottom nav
    nav.addEventListener('click', e => {
      const b = e.target.closest('button[data-mv]');
      if (!b) return;
      Haptic.light();
      setMobileView(b.dataset.mv);
    });

    // Wire drawer
    drw.addEventListener('click', e => {
      const li = e.target.closest('li[data-act]');
      if (!li) return;
      const act = li.dataset.act;
      closeDrawer();
      if (act === 'capture' || act === 'message' || act === 'kiosk' || act === 'progress') {
        // surface that tab inside the workspace; set view to schedule so the workspace shows
        window.setTab && window.setTab(act);
        setMobileView('schedule'); // workspace tabs live under "schedule" view
        // Actually simplest: make the workspace visible and scroll to it
        const wp = document.querySelector('.workspace');
        if (wp) wp.scrollIntoView({ behavior: 'smooth' });
      } else if (act === 'palette') {
        window.openPalette && window.openPalette();
      } else if (act === 'change') {
        window.showLanding && window.showLanding();
      } else if (act === 'back') {
        Haptic.medium();
        window.goBack && window.goBack();
        setMobileView('now');
      }
    });
    dbk.addEventListener('click', closeDrawer);

    // Drag-to-close drawer
    addDragToClose(drw, dbk, closeDrawer);
    addDragToClose(sht, sbk, closeSheet);

    // Wire sheet backdrop
    sbk.addEventListener('click', closeSheet);

    // Wire action bar
    document.getElementById('mab-primary').addEventListener('click', () => {
      Haptic.medium();
      window.toggleTimer && window.toggleTimer();
    });
    document.getElementById('mab-next').addEventListener('click', () => {
      Haptic.medium();
      window.advance && window.advance();
    });
  }

  function addDragToClose(panel, backdrop, close) {
    let startY = 0, currentY = 0, dragging = false;
    const grabber = panel.querySelector('.grabber');
    if (!grabber) return;
    grabber.parentElement.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      startY = currentY = e.touches[0].clientY;
      dragging = true;
      panel.style.transition = 'none';
    }, { passive: true });
    grabber.parentElement.addEventListener('touchmove', e => {
      if (!dragging) return;
      currentY = e.touches[0].clientY;
      const dy = Math.max(0, currentY - startY);
      panel.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    grabber.parentElement.addEventListener('touchend', () => {
      if (!dragging) return;
      dragging = false;
      panel.style.transition = '';
      const dy = currentY - startY;
      if (dy > 80) close();
      else panel.style.transform = '';
    });
  }

  // ---------- VIEW ROUTING ----------
  function setMobileView(view) {
    const valid = ['now', 'upnext', 'schedule', 'log', 'more'];
    if (!valid.includes(view)) return;
    if (view === 'more') { openDrawer(); return; }
    document.body.classList.remove('mv-now', 'mv-upnext', 'mv-schedule', 'mv-log');
    document.body.classList.add('mv-' + view);
    document.querySelectorAll('#mobileNav button[data-mv]').forEach(b => {
      b.classList.toggle('active', b.dataset.mv === view);
    });
    // Drive the workspace tab to match
    if (view === 'schedule') window.setTab && window.setTab('schedule');
    else if (view === 'log')  window.setTab && window.setTab('log');
    // When switching to a view backed by a body section (now/upnext), ensure tab content
    // doesn't keep growing unrelated workspace below — but workspace is hidden anyway via CSS.
    // Scroll to top of the relevant section
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  window.setMobileView = setMobileView;

  // ---------- DRAWER + SHEET ----------
  function openDrawer() {
    document.getElementById('mobileDrawerBackdrop').classList.add('on');
    document.getElementById('mobileDrawer').classList.add('on');
  }
  function closeDrawer() {
    document.getElementById('mobileDrawerBackdrop')?.classList.remove('on');
    document.getElementById('mobileDrawer')?.classList.remove('on');
    document.getElementById('mobileDrawer').style.transform = '';
    // Restore active nav button if user is mid-view
    const active = document.querySelector('#mobileNav button.active');
    if (active && active.dataset.mv === 'more') {
      // No specific view → pick whatever class is on body
      const cur = ['now', 'upnext', 'schedule', 'log'].find(v => document.body.classList.contains('mv-' + v)) || 'now';
      document.querySelectorAll('#mobileNav button').forEach(b => b.classList.toggle('active', b.dataset.mv === cur));
    }
  }
  function openSheet({ title, sub, actions }) {
    document.getElementById('rs-title').textContent = title;
    document.getElementById('rs-sub').textContent = sub || '';
    const ul = document.getElementById('rs-actions');
    ul.innerHTML = actions.map((a, i) => `
      <li data-i="${i}" ${a.danger ? 'class="danger"' : ''}><span class="ico">${a.ico}</span><span>${a.label}</span></li>
    `).join('');
    ul.querySelectorAll('li').forEach(li => li.addEventListener('click', () => {
      const a = actions[parseInt(li.dataset.i, 10)];
      Haptic.light();
      closeSheet();
      try { a.act(); } catch (e) { console.error(e); }
    }));
    document.getElementById('sheetBackdrop').classList.add('on');
    document.getElementById('runSheet').classList.add('on');
  }
  function closeSheet() {
    document.getElementById('sheetBackdrop')?.classList.remove('on');
    document.getElementById('runSheet')?.classList.remove('on');
    const el = document.getElementById('runSheet');
    if (el) el.style.transform = '';
  }

  // ---------- LONG-PRESS ON SCHEDULE / UP-NEXT ----------
  function bindLongPress(root) {
    let timer = null, target = null, startX = 0, startY = 0;
    const start = e => {
      const candidate = e.target.closest('[data-idx], [data-run-n]');
      if (!candidate) return;
      target = candidate;
      const t = e.touches ? e.touches[0] : e;
      startX = t.clientX; startY = t.clientY;
      target.classList.add('lp-pressing');
      timer = setTimeout(() => {
        Haptic.medium();
        const idx = parseInt(target.dataset.idx || target.dataset.runN, 10);
        const r = (window.STATE.schedule || [])[idx];
        if (!r) return;
        const runners = (r.runners || []).join(', ');
        openSheet({
          title: r.game || 'Setup',
          sub: `${runners || '—'} · ${r.console || '—'}${r.category ? ' · ' + r.category : ''}`,
          actions: [
            { ico: '▦', label: 'Make this the current run', act: () => window.wsSend('run:select', { index: idx }) },
            { ico: '✎', label: 'Edit timing', act: () => window.RunEdit && window.RunEdit.open(idx) },
            { ico: '⏭', label: 'Skip this run', act: () => window.wsSend && window.wsSend('run:skip', { index: idx }), danger: false },
            { ico: '👤', label: 'Mark runners ready', act: () => { const cur = (window.STATE.runnerStatus || {})[idx] || 'unchecked'; const steps = (1 - ['unchecked','ready','missing'].indexOf(cur) + 3) % 3; for (let k = 0; k < steps; k++) window.wsSend('runner:cycle', { index: idx }); } },
          ],
        });
        target.classList.remove('lp-pressing');
        target = null; timer = null;
      }, 450);
    };
    const cancel = e => {
      if (target) target.classList.remove('lp-pressing');
      if (timer) { clearTimeout(timer); timer = null; }
      target = null;
    };
    const move = e => {
      if (!target) return;
      const t = e.touches ? e.touches[0] : e;
      if (Math.abs(t.clientX - startX) > 8 || Math.abs(t.clientY - startY) > 8) cancel();
    };
    root.addEventListener('touchstart', start, { passive: true });
    root.addEventListener('touchend', cancel);
    root.addEventListener('touchcancel', cancel);
    root.addEventListener('touchmove', move, { passive: true });
  }

  // ---------- SWIPE BETWEEN VIEWS ----------
  function bindSwipe() {
    const ORDER = ['now', 'upnext', 'schedule', 'log'];
    let sx = 0, sy = 0, t0 = 0, tracking = false;
    document.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      if (e.target.closest('.bottom-sheet, .mobile-drawer, .palette, input, textarea, button')) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; t0 = Date.now();
      tracking = true;
    }, { passive: true });
    document.addEventListener('touchend', e => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy, dt = Date.now() - t0;
      if (Math.abs(dx) < 80 || Math.abs(dy) > 60 || dt > 400) return;
      const cur = ORDER.find(v => document.body.classList.contains('mv-' + v));
      if (!cur) return;
      const i = ORDER.indexOf(cur);
      const next = dx < 0 ? ORDER[Math.min(ORDER.length - 1, i + 1)] : ORDER[Math.max(0, i - 1)];
      if (next && next !== cur) { Haptic.light(); setMobileView(next); }
    });
  }

  // ---------- PULL TO REFRESH ----------
  function bindPullToRefresh() {
    let startY = 0, dy = 0, pulling = false, ready = false;
    const ind = document.getElementById('ptrIndicator');
    const text = document.getElementById('ptr-text');
    document.addEventListener('touchstart', e => {
      if (window.scrollY > 0) return;
      if (e.target.closest('.bottom-sheet, .mobile-drawer, .palette, input, textarea')) return;
      startY = e.touches[0].clientY; dy = 0; pulling = true; ready = false;
    }, { passive: true });
    document.addEventListener('touchmove', e => {
      if (!pulling || window.scrollY > 0) return;
      dy = e.touches[0].clientY - startY;
      if (dy > 8) {
        ind.classList.add('visible');
        const armed = dy > 70;
        ind.classList.toggle('armed', armed);
        text.textContent = armed ? 'Release to refresh' : 'Pull to refresh';
        if (armed && !ready) Haptic.light();
        ready = armed;
      } else {
        ind.classList.remove('visible', 'armed');
      }
    }, { passive: true });
    document.addEventListener('touchend', async () => {
      if (!pulling) return;
      pulling = false;
      if (ready) {
        ind.classList.add('visible');
        text.textContent = 'Refreshing…';
        Haptic.medium();
        try {
          if (window.loadSchedule) await window.loadSchedule();
          if (window.renderAll) window.renderAll();
          Haptic.success();
        } catch (e) { Haptic.error(); }
      }
      setTimeout(() => { ind.classList.remove('visible', 'armed'); }, 350);
    });
  }

  // ---------- ENTER MOBILE MODE ----------
  function enterMobileMode() {
    document.body.classList.add('mobile');
    injectShell();
    if (!document.body.classList.contains('mv-now')
     && !document.body.classList.contains('mv-upnext')
     && !document.body.classList.contains('mv-schedule')
     && !document.body.classList.contains('mv-log')) {
      document.body.classList.add('mv-now');
    }
    // Watch for timer changes to drive action bar + wake lock
    syncMobileNow();
  }
  function leaveMobileMode() {
    document.body.classList.remove('mobile', 'mv-now', 'mv-upnext', 'mv-schedule', 'mv-log');
  }

  // Reflect timer state into the action bar
  function syncMobileNow() {
    if (!document.body.classList.contains('mobile')) return;
    const btn = document.getElementById('mab-primary');
    if (!btn) return;
    const running = !!(window.STATE && window.STATE.timerRunning);
    btn.classList.toggle('stop', running);
    btn.classList.remove('next');
    btn.innerHTML = running ? '<span class="ico">■</span>Stop' : '<span class="ico">▶</span>Start';
    if (running) acquireWakeLock(); else releaseWakeLock();
  }
  window.syncMobileNow = syncMobileNow;

  // Log badge: show count of recent additions since user last opened Log
  let logSeenCount = 0;
  function refreshLogBadge() {
    const b = document.getElementById('logBadge');
    if (!b) return;
    const total = (window.STATE && window.STATE.eventLog) ? window.STATE.eventLog.length : 0;
    const unseen = Math.max(0, total - logSeenCount);
    b.textContent = unseen > 9 ? '9+' : String(unseen);
    b.classList.toggle('hidden', unseen === 0 || document.body.classList.contains('mv-log'));
  }
  window.refreshMobileLogBadge = refreshLogBadge;
  document.addEventListener('click', e => {
    const b = e.target.closest('#mobileNav button[data-mv="log"]');
    if (!b) return;
    logSeenCount = (window.STATE && window.STATE.eventLog) ? window.STATE.eventLog.length : 0;
    refreshLogBadge();
  });

  // ---------- BOOT ----------
  function boot() {
    if (!isMobileWidth()) return;
    if (window.Kiosk && window.Kiosk.isKioskUrl && window.Kiosk.isKioskUrl()) return; // kiosk uses its own shell
    enterMobileMode();
    bindLongPress(document.body);
    bindSwipe();
    bindPullToRefresh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // React to viewport resize (rotation, devtools)
  window.addEventListener('resize', () => {
    if (isMobileWidth()) {
      if (!document.body.classList.contains('mobile')) enterMobileMode();
    } else {
      if (document.body.classList.contains('mobile')) leaveMobileMode();
    }
  });

  // Public for app.js to call after state updates
  window.MobileShell = { setView: setMobileView, syncNow: syncMobileNow, refreshLogBadge };
})();
