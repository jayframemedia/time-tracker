// App entry: state, screens, timer interaction.
import { getAllEntries, requestPersistence } from './store.js';
import { restoreRunning, startTimer, finishTimer, detectDevice } from './timer.js';
import { groupHistory, renderHistory, finishedEntries } from './history.js';
import {
  clock, shortDate, time12, isoDate, sumMinutes, formatHours, durationLabel, entryMinutes,
} from './format.js';
import { $, esc, toast, haptic, openExportSheet } from './ui.js';

const RING_C = 2 * Math.PI * 124; // 779.11 — ring radius from docs/DESIGN.md
const HOLD_MS = 1000;
const STALE_MS = 12 * 3600 * 1000; // "Still running?" after 12 h
const LAST_EXPORT = 'tt.lastExport';
const EMPTY_WARNED = 'tt.emptyWarned';

const state = {
  tab: 'timer',
  entries: [],
  running: null, // open entry
  hold: 0, // 0..1 while FINISH is held
  busy: false,
  animateButton: false, // fade/scale the big button in only when it changes
  device: detectDevice(),
  renderedDay: '',
};

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// ---------- Views ----------

const ICON_EXPORT = '<svg class="ico" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/></svg>';

function todayMinutes() {
  const today = isoDate(new Date());
  return sumMinutes(finishedEntries(state.entries).filter((e) => isoDate(new Date(e.start)) === today));
}

function noticeHtml() {
  const r = state.running;
  if (r && Date.now() - Date.parse(r.start) > STALE_MS) {
    return `<div class="notice danger" role="alert"><b>Still running?</b>
      This shift started ${esc(shortDate(r.start))} at ${esc(time12(r.start))}. Hold Finish if you forgot to clock out.</div>`;
  }
  const lastExport = ls.get(LAST_EXPORT);
  if (!state.entries.length && lastExport && ls.get(EMPTY_WARNED) !== lastExport) {
    return `<div class="notice"><b>Your history is empty.</b>
      You last exported a CSV on ${esc(shortDate(lastExport))}, so the device may have cleared this app's storage.
      Your exported CSV files are your backup. Export weekly to stay safe.
      <button type="button" class="link" id="dismiss-empty">OK</button></div>`;
  }
  return '';
}

function ringState() {
  const r = state.running;
  if (!r) return { p: 0, color: 'var(--accent)' };
  if (state.hold > 0) return { p: state.hold, color: 'var(--text)' };
  const elapsed = Date.now() - Date.parse(r.start);
  return { p: (elapsed % 3_600_000) / 3_600_000, color: 'var(--accent)' };
}

function timerView() {
  const r = state.running;
  const now = new Date();
  const elapsed = r ? Date.now() - Date.parse(r.start) : 0;
  const { p, color } = ringState();
  const enter = state.animateButton ? ' enter' : '';
  state.animateButton = false;
  return `
    <div class="timer">
      ${noticeHtml()}
      <div class="row-between"><div class="label">Today</div><div class="muted">${esc(shortDate(now))}</div></div>
      <div class="counter" id="counter" role="timer" aria-live="off">${clock(elapsed)}</div>
      <div class="subline muted">${r ? `Started ${esc(time12(r.start))}` : 'Tap start to clock in'}</div>
      <div class="btn-group">
        <svg width="264" height="264" viewBox="0 0 264 264" aria-hidden="true">
          <circle class="ring-track" cx="132" cy="132" r="124"/>
          <circle class="ring" id="ring" cx="132" cy="132" r="124"
            style="stroke:${color};stroke-dasharray:${RING_C.toFixed(2)};stroke-dashoffset:${(RING_C * (1 - p)).toFixed(2)}"/>
        </svg>
        ${r
          ? '<button type="button" class="big finish' + enter + '" id="finish" aria-label="Finish: press and hold for one second"><span>FINISH</span><small>HOLD 1 SEC</small></button>'
          : '<button type="button" class="big start' + enter + '" id="start" aria-label="Start timer">START</button>'}
      </div>
      <div class="card today"><span class="muted">Logged today</span><b>${formatHours(todayMinutes())} h</b></div>
    </div>`;
}

function historyView() {
  return `
    <div class="stack">
      ${noticeHtml()}
      <div class="row-between center"><h1>History</h1>
        <button type="button" class="export" id="export">${ICON_EXPORT}Export CSV</button></div>
      <div class="cols" aria-hidden="true"><div>Date</div><div>Clock in</div><div>Clock out</div><div class="r">Total</div></div>
      ${renderHistory(groupHistory(state.entries))}
    </div>`;
}

function settingsView() {
  const rows = [
    ['Time format', '12-hour'],
    ['Week starts', 'Monday'],
    ['Rounding', 'None'],
    ['Job &amp; employee labels', 'Hidden'],
    ['Device name', esc(state.device)],
    ['Google Sheets sync', 'Off'],
  ];
  return `
    <div class="stack">
      <h1>Settings</h1>
      <div class="card list">
        ${rows.map(([k, v]) => `<div class="set"><span>${k}</span><span class="muted">${v}</span></div>`).join('')}
        <button type="button" class="set set-btn" id="export-all"><span>Export all data</span><span class="muted">CSV ›</span></button>
      </div>
      <p class="muted small">These settings become editable in the next update.</p>
      <p class="muted small center-text">Open source · MIT licence · Your data stays on your devices</p>
    </div>`;
}

// ---------- Render ----------

function render() {
  const view = $('#view');
  view.innerHTML = state.tab === 'timer' ? timerView() : state.tab === 'history' ? historyView() : settingsView();
  document.querySelectorAll('.tabbar button').forEach((b) => {
    if (b.dataset.tab === state.tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  state.renderedDay = isoDate(new Date());
  bind();
}

/** Cheap per-frame / per-second update of the counter and ring only. */
function tick() {
  if (state.renderedDay !== isoDate(new Date())) { render(); return; } // midnight rollover
  if (state.tab !== 'timer') return;
  const c = $('#counter');
  const ring = $('#ring');
  if (!c || !ring) return;
  c.textContent = clock(state.running ? Date.now() - Date.parse(state.running.start) : 0);
  const { p, color } = ringState();
  ring.style.stroke = color;
  ring.style.strokeDashoffset = (RING_C * (1 - p)).toFixed(2);
}

// ---------- Actions ----------

async function onStart() {
  if (state.busy || state.running) return;
  state.busy = true;
  try {
    const entry = await startTimer(state.device);
    state.entries.push(entry);
    state.running = entry;
    state.animateButton = true;
    haptic(15);
    render();
    $('#finish')?.focus({ preventScroll: true });
  } catch (err) {
    console.error(err);
    toast('Could not start — storage unavailable');
  } finally {
    state.busy = false;
  }
}

async function onFinish() {
  if (state.busy || !state.running) return;
  state.busy = true;
  cancelHold(false);
  try {
    const done = await finishTimer(state.running);
    state.entries = state.entries.map((e) => (e.id === done.id ? done : e));
    state.running = null;
    state.animateButton = true;
    haptic([20, 60, 30]);
    render();
    toast(`Logged · ${durationLabel(entryMinutes(done))}`);
  } catch (err) {
    console.error(err);
    toast('Could not save — try again');
  } finally {
    state.busy = false;
  }
}

let holdRaf = 0;
let holdStart = 0;

function holdFrame() {
  state.hold = Math.min(1, (performance.now() - holdStart) / HOLD_MS);
  tick();
  if (state.hold >= 1) { holdRaf = 0; onFinish(); return; }
  holdRaf = requestAnimationFrame(holdFrame);
}

function beginHold(ev) {
  if (ev.button > 0 || state.busy) return; // primary button / touch only
  ev.preventDefault();
  holdStart = performance.now();
  cancelAnimationFrame(holdRaf);
  $('#finish')?.classList.add('holding');
  holdRaf = requestAnimationFrame(holdFrame);
}

function cancelHold(redraw = true) {
  if (holdRaf) cancelAnimationFrame(holdRaf);
  holdRaf = 0;
  state.hold = 0;
  $('#finish')?.classList.remove('holding');
  if (redraw) tick();
}

function bind() {
  $('#start')?.addEventListener('click', onStart);

  const f = $('#finish');
  if (f) {
    f.addEventListener('pointerdown', beginHold);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => f.addEventListener(t, () => { if (holdRaf) cancelHold(); }));
    f.addEventListener('contextmenu', (ev) => ev.preventDefault()); // no long-press menu
    f.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onFinish(); }
    });
  }

  const openExport = (initialRange) => openExportSheet({
    getEntries: () => state.entries,
    initialRange,
    onExported: (n, how) => {
      ls.set(LAST_EXPORT, isoDate(new Date()));
      toast(`${how === 'shared' ? 'Shared' : 'Exported'} · ${n} shift${n === 1 ? '' : 's'}`);
    },
  });
  $('#export')?.addEventListener('click', () => openExport('this-week'));
  $('#export-all')?.addEventListener('click', () => openExport('all'));

  $('#dismiss-empty')?.addEventListener('click', () => {
    ls.set(EMPTY_WARNED, ls.get(LAST_EXPORT) || '');
    render();
  });
}

// ---------- Boot ----------

document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => {
  if (state.tab === b.dataset.tab) return;
  cancelHold(false);
  state.tab = b.dataset.tab;
  render();
  $('#view').scrollTop = 0;
}));

// Coming back from the background: redraw so the counter and "today" are current.
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

async function boot() {
  try {
    state.entries = await getAllEntries();
    state.running = await restoreRunning(state.entries);
  } catch (err) {
    console.error(err);
    toast('Storage unavailable — shifts will not be saved', 5000);
  }
  render();
  setInterval(tick, 250);
  requestPersistence();
}

boot();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker not registered', err));
  });
}
