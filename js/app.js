// App entry: render the screens, wire up events, start up, and apply updates.
// The work itself lives in: state.js (shared state), views.js (screen HTML), actions.js (your shifts),
// hold.js (press and hold), syncing.js (sync timing), teamActions.js (owner Team view).
import { getAllEntries, requestPersistence } from './store.js';
import { restoreRunning } from './timer.js';
import { clock, isoDate } from './format.js';
import { $, toast } from './ui.js';
import { isOwner } from './sync.js';
import { enableSwipe } from './swipe.js';
import {
  state, ls, isWide, wideQuery, typingInView, setRenderers, LAST_EXPORT, EMPTY_WARNED,
} from './state.js';
import {
  timerView, historyView, macHistoryView, settingsView, teamView, ringState,
} from './views.js';
import {
  onStart, onFinish, deleteShift, editShift, editLabels, updateSettings, openExport, discardOther,
} from './actions.js';
import { beginHold, cancelHold, isHolding } from './hold.js';
import { scheduleSync, openSync } from './syncing.js';
import { onTeamClick } from './teamActions.js';

// ---------- Render ----------

function render() {
  const el = $('#view');
  const wide = isWide();
  const owner = isOwner();
  document.body.classList.toggle('wide', wide);
  document.body.classList.toggle('owner', owner);
  if (!owner && state.tab === 'team') state.tab = 'timer';
  if (!owner && state.pane === 'team') state.pane = 'history';
  const scroller = wide ? el.querySelector('.right') : el;
  const keepScroll = scroller ? scroller.scrollTop : 0;
  if (wide) {
    el.innerHTML = `
      <div class="split">
        <section class="left" aria-label="Timer">${timerView()}</section>
        <section class="right" aria-label="${{ settings: 'Settings', team: 'Team' }[state.pane] || 'History'}">
          ${state.pane === 'settings' ? settingsView() : state.pane === 'team' ? teamView() : macHistoryView()}</section>
      </div>`;
    const right = el.querySelector('.right');
    if (right) right.scrollTop = keepScroll;
  } else {
    el.innerHTML = { timer: timerView, history: historyView, settings: settingsView, team: teamView }[state.tab]();
    el.scrollTop = keepScroll;
  }
  document.querySelectorAll('.tabbar button').forEach((b) => {
    if (b.dataset.tab === 'team') b.hidden = !owner;
    if (b.dataset.tab === state.tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  state.renderedDay = isoDate(new Date());
  state.newId = null;
  swipe.reset();
  bind();
}

/** Cheap per-frame / per-second update of the counter and ring only. */
function tick() {
  if (state.renderedDay !== isoDate(new Date())) { render(); return; } // midnight rollover
  const c = $('#counter');
  const ring = $('#ring');
  if (!c || !ring) return;
  c.textContent = clock(state.running ? Date.now() - Date.parse(state.running.start) : 0);
  const { p, color } = ringState();
  const circ = Number(ring.dataset.c);
  ring.classList.toggle('holding', color === 'var(--text)');
  ring.setAttribute('stroke-dashoffset', (circ * (1 - p)).toFixed(2));
}

setRenderers({ render, tick });

// ---------- Events ----------

/** Per-render bindings for elements that are replaced on every render. */
function bind() {
  $('#start')?.addEventListener('click', onStart);
  const f = $('#finish');
  if (f) {
    f.addEventListener('pointerdown', beginHold);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => f.addEventListener(t, () => { if (isHolding()) cancelHold(); }));
    f.addEventListener('contextmenu', (ev) => ev.preventDefault()); // no long-press menu
    f.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onFinish(); }
    });
  }
  const name = $('#device-name');
  if (name) {
    const commit = () => { if (name.value.trim() !== state.settings.deviceName) updateSettings({ deviceName: name.value }); };
    name.addEventListener('change', commit);
    name.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); name.blur(); } });
  }
}

/** Delegated clicks for everything else in the view. */
function onViewClick(ev) {
  const t = ev.target;
  const del = t.closest('[data-delete]');
  if (del) { ev.stopPropagation(); deleteShift(del.dataset.delete); return; }
  const edit = t.closest('[data-edit]');
  if (edit) { editShift(edit.dataset.edit); return; }
  if (t.closest('[data-locked]')) { toast('This week is locked by the owner'); return; }
  if (onTeamClick(t)) return;
  if (t.closest('[data-labels]')) { editLabels(); return; }
  const set = t.closest('[data-set]');
  if (set) {
    const raw = set.dataset.value;
    updateSettings({ [set.dataset.set]: set.dataset.set === 'timeFormat' ? raw : Number(raw) });
    return;
  }
  const filter = t.closest('[data-filter]');
  if (filter) { state.filter = filter.dataset.filter; render(); return; }
  if (t.closest('#toggle-labels')) { updateSettings({ showLabels: !state.settings.showLabels }); return; }
  if (t.closest('#export')) { openExport(isWide() && state.filter === 'month' ? 'this-month' : 'this-week'); return; }
  if (t.closest('#export-all')) { openExport('all'); return; }
  if (t.closest('#open-sync')) { openSync(); return; }
  const other = t.closest('[data-discard-other]');
  if (other) { discardOther(other.dataset.discardOther); return; }
  if (t.closest('#open-settings')) { state.pane = 'settings'; render(); return; }
  if (t.closest('#close-settings')) { state.pane = 'history'; render(); return; }
  if (t.closest('#dismiss-empty')) { ls.set(EMPTY_WARNED, ls.get(LAST_EXPORT) || ''); render(); }
}

function onViewKey(ev) {
  const personRow = ev.target.closest?.('tr[data-person]');
  if (personRow && ev.target === personRow && (ev.key === 'Enter' || ev.key === ' ')) {
    ev.preventDefault();
    state.team.person = Number(personRow.dataset.person);
    render();
    return;
  }
  const row = ev.target.closest?.('tr[data-edit]');
  if (!row || ev.target !== row) return;
  if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); editShift(row.dataset.edit); }
  if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); deleteShift(row.dataset.edit); }
}

const viewEl = $('#view');
const swipe = enableSwipe(viewEl, { onDelete: deleteShift });
viewEl.addEventListener('click', onViewClick);
viewEl.addEventListener('keydown', onViewKey);

document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => {
  if (state.tab === b.dataset.tab) return;
  cancelHold(false);
  state.tab = b.dataset.tab;
  render();
  viewEl.scrollTop = 0;
}));

// Phone ↔ Mac layout when the window crosses 900 px.
wideQuery.addEventListener('change', () => { cancelHold(false); render(); });

// Coming back from the background: redraw so the counter and "today" are current.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (!isHolding()) render();
  scheduleSync(0);
});
window.addEventListener('online', () => scheduleSync(0));
// While the app is open, check every 30 s so a shift started on the other device shows up.
setInterval(() => { if (!document.hidden) scheduleSync(0); }, 30_000);

// ---------- Boot ----------

async function boot() {
  try {
    state.entries = await getAllEntries();
    state.running = await restoreRunning(state.entries);
    state.otherRunning = state.entries.filter((e) => !e.end && !e.deleted && e.id !== state.running?.id);
  } catch (err) {
    console.error(err);
    toast('Storage unavailable — shifts will not be saved', 5000);
  }
  render();
  setInterval(tick, 250);
  requestPersistence();
  scheduleSync(0);
}

boot();

// ---------- Updates ----------
// Installed apps usually resume rather than restart, so: look for a new version whenever the app
// comes to the foreground, and when one takes over, reload at a safe moment (never mid-hold,
// with a sheet open, or while typing). Everything is saved, so a reload loses nothing.

function safeToReload() {
  return !isHolding() && !state.busy && !document.querySelector('dialog[open]') && !typingInView();
}

function reloadWhenSafe() {
  if (safeToReload()) location.reload();
  else setTimeout(reloadWhenSafe, 2000);
}

if ('serviceWorker' in navigator) {
  // The first time a worker takes control (very first visit) is not an update, so skip it.
  let controlled = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) { controlled = true; return; }
    if (reloading) return;
    reloading = true;
    reloadWhenSafe();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      const check = () => reg.update().catch(() => { /* offline — try next time */ });
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
      setInterval(() => { if (!document.hidden) check(); }, 30 * 60 * 1000);
    }).catch((err) => console.warn('Service worker not registered', err));
  });
}
