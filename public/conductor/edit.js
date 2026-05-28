// production/conductor/edit.js
// Run-edit modal: actualStart / actualEnd / actualDuration (HH:MM[:SS])
// Wires to wsSend('run:edit', { index, actualStart?, actualEnd?, actualDuration? })
// and wsSend('run:editClear', { index }). Server stores values in seconds.
//
// Field inference (matches the original): given any 2 of the 3 fields,
// the third is shown dimmed in the form so the operator can see what the
// server will infer. Empty fields are sent as undefined (left unchanged).

(function() {
  const $ = sel => document.querySelector(sel);

  function parseHM(str) {
    if (!str) return null;
    const parts = String(str).trim().split(':').map(s => parseInt(s, 10));
    if (parts.length < 2 || parts.some(isNaN)) return null;
    return parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0);
  }
  function fmtSecs(s, withSecs = false) {
    if (s == null || isNaN(s)) return '';
    const abs = Math.max(0, Math.floor(s));
    const h = Math.floor(abs / 3600), m = Math.floor((abs % 3600) / 60), x = abs % 60;
    return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + (withSecs ? ':' + String(x).padStart(2,'0') : '');
  }

  function ensureModal() {
    let m = document.getElementById('runEditModal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'runEditModal';
    m.className = 'modal-backdrop';
    m.innerHTML = `
      <div class="modal">
        <header>
          <h2 id="re-title">Edit timing<small id="re-sub"></small></h2>
          <button class="close" id="re-close" title="Close">×</button>
        </header>
        <div class="body">
          <div class="modal-info">
            Set any combination of <b>actual start</b>, <b>actual end</b>, and <b>actual duration</b>.
            Empty fields are left unchanged. Missing values are inferred from the other two.
            Stored on the server, broadcast to all operators, persisted to disk.
          </div>
          <div class="field">
            <label for="re-start">Actual start</label>
            <input id="re-start" placeholder="HH:MM or HH:MM:SS" autocomplete="off">
          </div>
          <div class="field">
            <label for="re-end">Actual end</label>
            <input id="re-end" placeholder="HH:MM or HH:MM:SS" autocomplete="off">
          </div>
          <div class="field">
            <label for="re-dur">Actual duration</label>
            <input id="re-dur" placeholder="H:MM:SS" autocomplete="off">
          </div>
          <div id="re-preview" class="modal-info" style="margin: 14px 0 0; display: none"></div>
        </div>
        <footer>
          <button class="ctrl-btn" id="re-clear">Clear edits</button>
          <div class="spacer"></div>
          <button class="ctrl-btn ghost" id="re-cancel">Cancel</button>
          <button class="ctrl-btn go" id="re-save">Save</button>
        </footer>
      </div>
    `;
    document.body.appendChild(m);
    // Wire
    m.addEventListener('click', e => { if (e.target === m) close(); });
    $('#re-close').addEventListener('click', close);
    $('#re-cancel').addEventListener('click', close);
    $('#re-save').addEventListener('click', save);
    $('#re-clear').addEventListener('click', clearEdits);
    ['#re-start', '#re-end', '#re-dur'].forEach(id => {
      $(id).addEventListener('input', updatePreview);
      $(id).addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    });
    return m;
  }

  let currentIndex = -1;

  function open(index) {
    if (index < 0 || !window.STATE || !window.STATE.schedule[index]) return;
    currentIndex = index;
    const m = ensureModal();
    const run = window.STATE.schedule[index];
    $('#re-title').firstChild.nodeValue = 'Edit timing';
    $('#re-sub').textContent = ` · ${run.game || 'Setup'}`;
    // Prefill from existing edits
    const edit = (window.STATE.runEdits || {})[index] || {};
    $('#re-start').value = edit.actualStart != null ? fmtSecs(edit.actualStart) : '';
    $('#re-end').value = edit.actualEnd != null ? fmtSecs(edit.actualEnd) : '';
    $('#re-dur').value = edit.actualDuration != null ? fmtSecs(edit.actualDuration, true) : '';
    m.classList.add('on');
    setTimeout(() => $('#re-start').focus(), 50);
    updatePreview();
  }

  function close() {
    const m = document.getElementById('runEditModal');
    if (m) m.classList.remove('on');
    currentIndex = -1;
  }

  function updatePreview() {
    const sSec = parseHM($('#re-start').value);
    const eSec = parseHM($('#re-end').value);
    const dSec = parseHM($('#re-dur').value);
    const inferred = { start: sSec, end: eSec, dur: dSec };
    let inferredFields = [];
    if (inferred.start != null && inferred.dur != null && inferred.end == null) {
      inferred.end = inferred.start + inferred.dur; inferredFields.push('end');
    }
    if (inferred.start != null && inferred.end != null && inferred.dur == null) {
      inferred.dur = inferred.end - inferred.start; inferredFields.push('duration');
    }
    if (inferred.end != null && inferred.dur != null && inferred.start == null) {
      inferred.start = inferred.end - inferred.dur; inferredFields.push('start');
    }
    const pv = $('#re-preview');
    if (sSec == null && eSec == null && dSec == null) {
      pv.style.display = 'none'; return;
    }
    const lines = [];
    if (inferred.start != null) lines.push(`start <b>${fmtSecs(inferred.start)}</b>${inferredFields.includes('start') ? ' <span style="color:var(--signal)">(inferred)</span>' : ''}`);
    if (inferred.end   != null) lines.push(`end <b>${fmtSecs(inferred.end)}</b>${inferredFields.includes('end') ? ' <span style="color:var(--signal)">(inferred)</span>' : ''}`);
    if (inferred.dur   != null) lines.push(`duration <b>${fmtSecs(inferred.dur, true)}</b>${inferredFields.includes('duration') ? ' <span style="color:var(--signal)">(inferred)</span>' : ''}`);
    pv.style.display = 'block';
    pv.innerHTML = 'Server will store: ' + lines.join(' · ');
  }

  function save() {
    if (currentIndex < 0) return;
    const payload = { index: currentIndex };
    const sSec = parseHM($('#re-start').value);
    const eSec = parseHM($('#re-end').value);
    const dSec = parseHM($('#re-dur').value);
    if (sSec != null) payload.actualStart = sSec;
    if (eSec != null) payload.actualEnd = eSec;
    if (dSec != null) payload.actualDuration = dSec;
    if (Object.keys(payload).length === 1) { close(); return; }
    window.wsSend('run:edit', payload);
    close();
  }

  function clearEdits() {
    if (currentIndex < 0) return;
    window.wsSend('run:editClear', { index: currentIndex });
    close();
  }

  // Public API
  window.RunEdit = { open, close };
})();
