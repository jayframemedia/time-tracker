// App entry: state, screens, timer interaction.
import { getAllEntries, putEntry, requestPersistence } from './store.js';
import {
  restoreRunning, startTimer, finishTimer, discardTimer, detectDevice, setRunningMirror,
} from './timer.js';
import {
  groupHistory, renderHistory, renderHistoryTable, finishedEntries, HISTORY_FILTERS, historyRange,
  filterEntries, esc,
} from './history.js';
import {
  clock, shortDate, formatTime, isoDate, sumMinutes, formatHours, durationLabel, entryMinutes,
  toLocalISO, startOfWeek, addDays,
} from './format.js';
import { loadSettings, saveSettings } from './settings.js';
import { $, toast, haptic, openExportSheet } from './ui.js';
import {
  openEditSheet, openLabelsSheet, askKeepOrDiscard, openSyncSheet,
} from './sheets.js';
import {
  getSyncConfig, getSyncStatus, syncNow, testConnection, connectSync, disconnectSync, agoLabel,
  getMe, isOwner, getLockBefore, teamFetch, teamSave, teamLock,
} from './sync.js';
import {
  renderTeam, renderPerson, weekRange, openLockSheet, openTeamExportSheet,
} from './team.js';
import { enableSwipe } from './swipe.js';

const HOLD_MS = 1000;
const STALE_MS = 12 * 3600 * 1000; // "Still running?" after 12 h
const SHORT_MS = 60 * 1000; // "Keep or discard?" under 60 s
const LAST_EXPORT = 'tt.lastExport';
const EMPTY_WARNED = 'tt.emptyWarned';
const NEXT_LABELS = 'tt.nextLabels';
const wideQuery = matchMedia('(min-width: 900px)');

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const readJSON = (k) => { try { return JSON.parse(ls.get(k)) || null; } catch { return null; } };

const state = {
  tab: 'timer', // iPhone tabs: timer | history | settings | team (owner)
  pane: 'history', // Mac right pane: history | settings | team (owner)
  team: { weekStart: startOfWeek(new Date(), loadSettings().weekStartsOn), data: null, loading: false, error: null, person: null, key: '' },
  filter: 'two-weeks', // Mac history filter
  entries: [],
  running: null, // open entry
  hold: 0, // 0..1 while FINISH is held
  busy: false,
  animateButton: false, // fade/scale the big button in only when it changes
  newId: null, // fade in this History row once
  settings: loadSettings(),
  nextLabels: readJSON(NEXT_LABELS) || { job: null, employee: null },
  renderedDay: '',
  otherRunning: [], // open shifts started on another device while this one also runs
};

const deviceName = () => state.settings.deviceName || detectDevice();
const isWide = () => wideQuery.matches;
const view = () => ({
  timeFormat: state.settings.timeFormat,
  rounding: state.settings.rounding,
  weekStartsOn: state.settings.weekStartsOn,
  showLabels: state.settings.showLabels,
  lockedBefore: getLockBefore(),
});

// ---------- Views ----------

const ICON_EXPORT = '<svg class="ico" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/></svg>';
const ICON_GEAR = '<svg class="ico" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h9"/><path d="M17 6h3"/><circle cx="15" cy="6" r="2"/><path d="M4 12h3"/><path d="M11 12h9"/><circle cx="9" cy="12" r="2"/><path d="M4 18h11"/><path d="M19 18h1"/><circle cx="17" cy="18" r="2"/></svg>';

function minutesSince(fromDate) {
  const from = isoDate(fromDate);
  return sumMinutes(finishedEntries(state.entries).filter((e) => isoDate(new Date(e.start)) >= from), state.settings.rounding);
}

function noticeHtml() {
  const other = state.otherRunning[0];
  if (other) {
    return `<div class="notice danger" role="alert"><b>Another shift is running.</b>
      It started ${esc(shortDate(other.start))} at ${esc(formatTime(other.start, state.settings.timeFormat))}${other.device ? ` on ${esc(other.device)}` : ''}.
      <button type="button" class="link" data-discard-other="${esc(other.id)}">Discard it</button></div>`;
  }
  const r = state.running;
  if (r && Date.now() - Date.parse(r.start) > STALE_MS) {
    return `<div class="notice danger" role="alert"><b>Still running?</b>
      This shift started ${esc(shortDate(r.start))} at ${esc(formatTime(r.start, state.settings.timeFormat))}.
      Hold Finish, then tap the shift in History to fix the clock-out time.</div>`;
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

/** Ring geometry: iPhone 264 px ring (r 124), Mac 232 px ring (r 108). */
const ringGeom = () => (isWide() ? { size: 232, r: 108 } : { size: 264, r: 124 });

function ringState() {
  const r = state.running;
  if (!r) return { p: 0, color: 'var(--accent)' };
  if (state.hold > 0) return { p: state.hold, color: 'var(--text)' };
  const elapsed = Date.now() - Date.parse(r.start);
  return { p: (elapsed % 3_600_000) / 3_600_000, color: 'var(--accent)' };
}

function labelsChips() {
  if (!state.settings.showLabels) return '';
  const src = state.running || state.nextLabels;
  const chip = (name, value) => `<button type="button" class="chip${value ? ' set' : ''}" data-labels>
      <span class="chip-k">${name}</span><span class="chip-v">${esc(value || 'Add')}</span></button>`;
  return `<div class="chips" role="group" aria-label="Job and employee">${chip('Job', src.job)}${chip('Employee', src.employee)}</div>`;
}

function timerView() {
  const r = state.running;
  const now = new Date();
  const elapsed = r ? Date.now() - Date.parse(r.start) : 0;
  const { p, color } = ringState();
  const { size, r: radius } = ringGeom();
  const c = 2 * Math.PI * radius;
  const enter = state.animateButton ? ' enter' : '';
  state.animateButton = false;
  const card = isWide()
    ? `<span class="muted">This week</span><b>${formatHours(minutesSince(startOfWeek(now, state.settings.weekStartsOn)))} h</b>`
    : `<span class="muted">Logged today</span><b>${formatHours(minutesSince(now))} h</b>`;
  return `
    <div class="timer${state.settings.showLabels ? ' has-chips' : ''}">
      ${noticeHtml()}
      <div class="row-between"><div class="label">Today</div><div class="muted">${esc(shortDate(now))}</div></div>
      <div class="counter" id="counter" role="timer" aria-live="off">${clock(elapsed)}</div>
      <div class="subline muted">${r ? `Started ${esc(formatTime(r.start, state.settings.timeFormat))}` : 'Tap start to clock in'}</div>
      ${labelsChips()}
      <div class="btn-group">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
          <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${radius}"/>
          <circle class="ring${color === 'var(--text)' ? ' holding' : ''}" id="ring" data-c="${c.toFixed(2)}" cx="${size / 2}" cy="${size / 2}" r="${radius}"
            stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - p)).toFixed(2)}"/>
        </svg>
        ${r
          ? `<button type="button" class="big finish${enter}" id="finish" aria-label="Finish: press and hold for one second"><span>FINISH</span><small>HOLD 1 SEC</small></button>`
          : `<button type="button" class="big start${enter}" id="start" aria-label="Start timer">START</button>`}
      </div>
      <div class="card today">${card}</div>
    </div>`;
}

function historyView() {
  const opts = { ...view(), newId: state.newId };
  return `
    <div class="stack">
      ${noticeHtml()}
      <div class="row-between center"><h1>History</h1>
        <button type="button" class="export" id="export">${ICON_EXPORT}Export CSV</button></div>
      <div class="cols" aria-hidden="true"><div>Date</div><div>Clock in</div><div>Clock out</div><div class="r">Total</div></div>
      ${renderHistory(groupHistory(state.entries, opts), opts)}
      ${finishedEntries(state.entries).length ? '<p class="muted small hint">Tap a shift to edit it. Swipe left to delete.</p>' : ''}
    </div>`;
}

function macHistoryView() {
  const opts = { ...view(), newId: state.newId };
  const range = historyRange(state.filter, { weekStartsOn: state.settings.weekStartsOn });
  const list = filterEntries(state.entries, range);
  return `
    <div class="mac-head">
      <h1>History</h1>
      <div class="pills" role="group" aria-label="Show">
        ${HISTORY_FILTERS.map((f) => `<button type="button" class="pill" data-filter="${f.id}" aria-pressed="${f.id === state.filter}">${f.label}</button>`).join('')}
        <button type="button" class="export" id="export">${ICON_EXPORT}Export CSV</button>
        ${isOwner() ? '<button type="button" class="export" id="open-team">Team</button>' : ''}
        <button type="button" class="icon-btn gear" id="open-settings" aria-label="Settings">${ICON_GEAR}</button>
      </div>
    </div>
    ${renderHistoryTable(groupHistory(list, opts), opts)}`;
}

function segmented(key, options, label) {
  const current = String(state.settings[key]);
  return `<div class="seg" role="group" aria-label="${label}">${options.map(([value, text]) => `
    <button type="button" data-set="${key}" data-value="${value}" aria-pressed="${String(value) === current}">${text}</button>`).join('')}</div>`;
}

function syncStatusText() {
  if (!getSyncConfig()) return 'Off';
  const st = getSyncStatus();
  if (st.syncing) return 'Syncing…';
  if (st.lastError) return 'Problem';
  return `On · ${agoLabel(st.lastSyncedAt)}`;
}

function syncStatusHtml() {
  const config = getSyncConfig();
  const st = getSyncStatus();
  const dot = !config ? '' : st.lastError ? 'bad' : 'ok';
  return `${dot ? `<span class="dot ${dot}" aria-hidden="true"></span>` : ''}${esc(syncStatusText())} ›`;
}

function aboutText() {
  const me = getMe();
  if (!me) return '<p class="muted small">Your shifts are stored on this device only.</p>';
  if (me.role === 'owner') {
    return `<p class="muted small">Syncing as <b>${esc(me.name)}</b> (owner). You can see everyone’s hours in Team.</p>`;
  }
  return `<p class="muted small">Syncing as <b>${esc(me.name)}</b>. Your shift times, job labels and device name are stored on your employer’s server, where the owner can see and correct them. Weeks the owner has locked can’t be changed.</p>`;
}

function settingsView() {
  const s = state.settings;
  return `
    <div class="stack settings">
      <div class="row-between center"><h1>Settings</h1>
        ${isWide() ? '<button type="button" class="export" id="close-settings">Done</button>' : ''}</div>
      <div class="card list">
        <div class="set"><span>Time format</span>${segmented('timeFormat', [['12', '12-hour'], ['24', '24-hour']], 'Time format')}</div>
        <div class="set"><span>Week starts</span>${segmented('weekStartsOn', [[1, 'Monday'], [0, 'Sunday']], 'Week starts')}</div>
        <div class="set"><span>Rounding</span>${segmented('rounding', [[0, 'None'], [5, '5 min'], [15, '15 min']], 'Rounding')}</div>
        <div class="set"><span id="lbl-labels">Job &amp; employee labels</span>
          <button type="button" class="switch" role="switch" id="toggle-labels" aria-checked="${s.showLabels}" aria-labelledby="lbl-labels"><span></span></button></div>
        <label class="set"><span>Device name</span>
          <input type="text" class="set-input" id="device-name" value="${esc(s.deviceName)}" placeholder="${esc(detectDevice())}" maxlength="40" autocomplete="off" enterkeyhint="done"></label>
        <button type="button" class="set set-btn" id="open-sync"><span>Sync between devices</span>
          <span class="muted sync-status" id="sync-status">${syncStatusHtml()}</span></button>
        <button type="button" class="set set-btn" id="export-all"><span>Export all data</span><span class="muted">CSV ›</span></button>
      </div>
      <p class="muted small">Rounding changes the times and hours shown and exported. Your recorded times are never changed.</p>
      ${aboutText()}
      <p class="muted small center-text">Open source · MIT licence</p>
    </div>`;
}

function teamView() {
  const t = state.team;
  const key = `${isoDate(t.weekStart)}`;
  if (t.key !== key && !t.loading) loadTeam();
  const opts = { ...view(), thisWeekStart: startOfWeek(new Date(), state.settings.weekStartsOn), wide: isWide() };
  return t.person && t.data ? renderPerson(t, t.person, opts) : renderTeam(t, opts);
}

const teamVisible = () => isOwner() && (isWide() ? state.pane === 'team' : state.tab === 'team');

/** Load everyone's shifts for the Team week (live from the server). */
async function loadTeam() {
  const t = state.team;
  const { from, to } = weekRange(t.weekStart);
  t.loading = true;
  t.key = from;
  try {
    const data = await teamFetch(from, to);
    if (t.key !== from) return; // the week changed while loading
    t.data = data;
    t.error = null;
  } catch (err) {
    t.error = err.message;
  } finally {
    t.loading = false;
  }
  if (teamVisible() && !typingInView()) render();
}

function teamEdit(id) {
  const e = state.team.data?.entries.find((x) => x.id === id);
  if (!e) return;
  if (state.entries.some((x) => x.id === id)) { editShift(id); return; } // your own shift: edit it like any other
  if (!e.end) { toast('Still clocked in — it can be corrected after Finish'); return; }
  const name = state.team.data.users.find((u) => u.id === e.userId)?.name || 'They';
  const clean = ({ userId, clockSkewMs, original, ...rest }) => rest; // drop Team-only fields
  openEditSheet(clean(e), {
    entries: state.team.data.entries,
    onSave: async ({ start, end, job, employee }) => {
      const updated = {
        ...clean(e),
        start: start ? toLocalISO(start) : e.start,
        end: end ? toLocalISO(end) : e.end,
        job,
        employee,
        edited: e.edited || !!(start || end),
        updatedAt: toLocalISO(),
      };
      try { await teamSave([updated]); } catch (err) { toast(err.message); return; }
      toast(`Updated · ${name} sees it next sync`);
      loadTeam();
    },
    onDelete: async () => {
      const gone = { ...clean(e), deleted: true, updatedAt: toLocalISO() };
      try { await teamSave([gone]); } catch (err) { toast(err.message); return; }
      loadTeam();
      toast('Shift deleted', {
        action: 'Undo',
        onAction: async () => {
          try { await teamSave([{ ...gone, deleted: false, updatedAt: toLocalISO() }]); } catch (err) { toast(err.message); return; }
          loadTeam();
        },
      });
    },
  });
}

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
  swipe?.reset();
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

// ---------- Actions ----------

const replaceEntry = (updated) => {
  state.entries = state.entries.map((e) => (e.id === updated.id ? updated : e));
};

async function save(updated) {
  await putEntry(updated);
  replaceEntry(updated);
  scheduleSync();
}

// ---------- Sync ----------

let syncTimer = 0;
/** Sync shortly after a change (debounced), or right away. */
function scheduleSync(delay = 800) {
  if (!getSyncConfig()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, delay);
}

async function runSync() {
  const el = $('#sync-status');
  if (el) el.textContent = 'Syncing…';
  const res = await syncNow({ onChange: reloadFromDb });
  if (!res.pulled && !res.skipped && !res.error) await reconcileOpen();
  const after = $('#sync-status');
  if (after) after.innerHTML = syncStatusHtml();
  if (teamVisible() && !state.team.loading) loadTeam();
}

/** Safety net: if the open shifts in storage differ from what's on screen, reload. */
async function reconcileOpen() {
  const ids = (list) => list.map((e) => e.id).sort().join(',');
  const stored = (await getAllEntries()).filter((e) => !e.end && !e.deleted);
  const shown = [state.running, ...state.otherRunning].filter(Boolean);
  if (ids(stored) !== ids(shown)) await reloadFromDb();
}

const typingInView = () => document.activeElement?.matches?.('#view input');

/** Re-read everything after a sync brought in changes, and follow a shift started or ended elsewhere. */
async function reloadFromDb() {
  // Changes are already saved; show them once the user isn't mid-action or mid-typing.
  if (state.busy || holdRaf || typingInView()) { setTimeout(reloadFromDb, 1500); return; }
  state.entries = await getAllEntries();
  const open = state.entries
    .filter((e) => !e.end && !e.deleted)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const was = state.running;
  if (was) {
    const now = state.entries.find((e) => e.id === was.id);
    if (!now || now.end || now.deleted) {
      state.running = null;
      setRunningMirror(null);
      state.animateButton = true;
      toast(now && !now.deleted ? 'Shift finished on your other device' : 'Shift discarded on your other device');
    } else {
      state.running = now;
    }
  }
  if (!state.running && open.length) {
    state.running = open[0];
    setRunningMirror(open[0]);
    state.animateButton = true;
    if (!was) toast(`Shift running · started on ${open[0].device || 'another device'}`);
  }
  state.otherRunning = open.filter((e) => e.id !== state.running?.id);
  render();
}

function openSync() {
  const st = getSyncStatus();
  openSyncSheet({
    config: getSyncConfig(),
    statusText: `Last synced ${agoLabel(st.lastSyncedAt)}`,
    errorText: st.lastError,
    onConnect: async (url, token) => {
      const config = await testConnection(url, token);
      await connectSync(config);
      state.entries = await getAllEntries();
      await runSync();
      const after = getSyncStatus();
      toast(after.lastError ? `Sync problem: ${after.lastError}` : 'Sync is on');
      render();
    },
    onSyncNow: async () => {
      await runSync();
      const after = getSyncStatus();
      toast(after.lastError ? `Sync problem: ${after.lastError}` : 'Synced');
      render();
    },
    onDisconnect: () => {
      disconnectSync();
      toast('Sync is off · your shifts stay on this device');
      render();
    },
  });
}

async function onStart() {
  if (state.busy || state.running) return;
  state.busy = true;
  try {
    const labels = state.settings.showLabels ? { ...state.nextLabels } : {};
    if (!labels.employee && getMe()?.name) labels.employee = getMe().name; // staff name on every shift
    const entry = await startTimer(deviceName(), labels);
    state.entries.push(entry);
    state.running = entry;
    state.animateButton = true;
    scheduleSync(0);
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
    const running = state.running;
    const elapsed = Date.now() - Date.parse(running.start);
    if (elapsed < SHORT_MS) {
      const choice = await askKeepOrDiscard(Math.max(0, Math.floor(elapsed / 1000)));
      if (choice === 'cancel') return; // still running
      if (choice === 'discard') {
        replaceEntry(await discardTimer(running));
        state.running = null;
        scheduleSync(0);
        state.animateButton = true;
        haptic(10);
        render();
        toast('Shift discarded');
        return;
      }
    }
    const done = await finishTimer(running);
    replaceEntry(done);
    state.running = null;
    scheduleSync(0);
    state.animateButton = true;
    state.newId = done.id;
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

async function deleteShift(id) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return;
  const before = entry;
  try {
    await save({ ...entry, deleted: true, updatedAt: toLocalISO() });
  } catch (err) { console.error(err); toast('Could not delete — try again'); return; }
  haptic(10);
  render();
  toast('Shift deleted', {
    action: 'Undo',
    onAction: async () => {
      await save({ ...before, deleted: false, updatedAt: toLocalISO() });
      state.newId = before.id;
      render();
    },
  });
}

function editShift(id) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry || !entry.end) return;
  const lock = getLockBefore();
  if (lock && isoDate(new Date(entry.start)) < lock) { toast('This week is locked by the owner'); return; }
  openEditSheet(entry, {
    entries: state.entries,
    onSave: async ({ start, end, job, employee }) => {
      const timesChanged = !!(start || end);
      const updated = {
        ...entry,
        start: start ? toLocalISO(start) : entry.start,
        end: end ? toLocalISO(end) : entry.end,
        job,
        employee,
        edited: entry.edited || timesChanged,
        updatedAt: toLocalISO(),
      };
      try { await save(updated); } catch (err) { console.error(err); toast('Could not save — try again'); return; }
      state.newId = updated.id;
      render();
      toast('Shift updated');
    },
    onDelete: () => deleteShift(id),
  });
}

function editLabels() {
  openLabelsSheet({
    ...(state.running || state.nextLabels),
    running: !!state.running,
    entries: state.entries,
    onSave: async ({ job, employee }) => {
      state.nextLabels = { job, employee };
      ls.set(NEXT_LABELS, JSON.stringify(state.nextLabels));
      if (state.running) {
        const updated = { ...state.running, job, employee, updatedAt: toLocalISO() };
        try { await save(updated); state.running = updated; } catch (err) { console.error(err); toast('Could not save — try again'); }
      }
      render();
    },
  });
}

function updateSettings(patch) {
  state.settings = saveSettings({ ...state.settings, ...patch });
  if ('weekStartsOn' in patch) state.team = { ...state.team, weekStart: startOfWeek(state.team.weekStart, state.settings.weekStartsOn), data: null, key: '' };
  render();
}

function openExport(initialRange) {
  openExportSheet({
    getEntries: () => state.entries,
    initialRange,
    weekStartsOn: state.settings.weekStartsOn,
    rounding: state.settings.rounding,
    onExported: (n, how) => {
      ls.set(LAST_EXPORT, isoDate(new Date()));
      toast(`${how === 'shared' ? 'Shared' : 'Exported'} · ${n} shift${n === 1 ? '' : 's'}`);
    },
  });
}

// ---------- Press and hold ----------

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

// ---------- Events ----------

/** Per-render bindings for elements that are replaced on every render. */
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
  if (other) {
    const e = state.entries.find((x) => x.id === other.dataset.discardOther);
    if (e) {
      save({ ...e, end: toLocalISO(), deleted: true, updatedAt: toLocalISO() }).then(() => {
        state.otherRunning = state.otherRunning.filter((x) => x.id !== e.id);
        render();
        toast('Other shift discarded');
      });
    }
    return;
  }
  if (t.closest('#open-settings')) { state.pane = 'settings'; render(); return; }
  if (t.closest('#close-settings')) { state.pane = 'history'; render(); return; }
  if (t.closest('#dismiss-empty')) { ls.set(EMPTY_WARNED, ls.get(LAST_EXPORT) || ''); render(); }
}

/** Team view clicks (owner). Returns true if handled. */
function onTeamClick(t) {
  const team = state.team;
  const teamEditBtn = t.closest('[data-team-edit]');
  if (teamEditBtn) { teamEdit(teamEditBtn.dataset.teamEdit); return true; }
  const person = t.closest('[data-person]');
  if (person) { team.person = Number(person.dataset.person); render(); $('#view').scrollTop = 0; return true; }
  if (t.closest('[data-person-back]')) { team.person = null; render(); return true; }
  const week = t.closest('[data-week]');
  if (week) {
    team.weekStart = addDays(team.weekStart, 7 * Number(week.dataset.week));
    team.data = null;
    team.key = '';
    render();
    return true;
  }
  if (t.closest('#team-refresh')) { loadTeam(); toast('Refreshing…'); return true; }
  if (t.closest('#open-team')) { state.pane = 'team'; render(); return true; }
  if (t.closest('#close-team')) { state.pane = 'history'; render(); return true; }
  if (t.closest('#team-lock')) {
    openLockSheet({
      lockBefore: team.data?.lockBefore,
      defaultDate: isoDate(startOfWeek(new Date(), state.settings.weekStartsOn)),
      onLock: async (before) => {
        await teamLock(before);
        toast(before ? `Locked before ${shortDate(before)}` : 'All weeks unlocked');
        loadTeam();
      },
    });
    return true;
  }
  const exp = t.closest('#team-export');
  if (exp && team.data) {
    openTeamExportSheet({
      users: team.data.users,
      personId: exp.dataset.personExport ? Number(exp.dataset.personExport) : null,
      weekStartsOn: state.settings.weekStartsOn,
      rounding: state.settings.rounding,
      fetchRange: teamFetch,
    });
    return true;
  }
  return false;
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
  if (!holdRaf) render();
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
  return !holdRaf && !state.busy && !document.querySelector('dialog[open]') && !typingInView();
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
