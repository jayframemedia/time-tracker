// Screen HTML: Timer, History (iPhone list / Mac table), Settings, Team.
import { detectDevice } from './timer.js';
import {
  groupHistory, renderHistory, renderHistoryTable, finishedEntries, HISTORY_FILTERS, historyRange,
  filterEntries, esc,
} from './history.js';
import {
  clock, shortDate, formatTime, isoDate, sumMinutes, formatHours, startOfWeek,
} from './format.js';
import { getSyncConfig, getSyncStatus, agoLabel, getMe, isOwner } from './sync.js';
import { renderTeam, renderPerson } from './team.js';
import {
  state, ls, isWide, view, STALE_MS, LAST_EXPORT, EMPTY_WARNED,
} from './state.js';
import { loadTeam } from './teamActions.js';

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

/** Ring progress (0..1) and colour: hour progress while running, white hold progress while held. */
export function ringState() {
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

export function timerView() {
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

export function historyView() {
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

export function macHistoryView() {
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

export function syncStatusHtml() {
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

export function settingsView() {
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

export function teamView() {
  const t = state.team;
  const key = `${isoDate(t.weekStart)}`;
  if (t.key !== key && !t.loading) loadTeam();
  const opts = { ...view(), thisWeekStart: startOfWeek(new Date(), state.settings.weekStartsOn), wide: isWide() };
  return t.person && t.data ? renderPerson(t, t.person, opts) : renderTeam(t, opts);
}
