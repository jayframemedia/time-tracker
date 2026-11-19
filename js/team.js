// Owner Team view: everyone's hours by week, one person's shifts with edits and clock flags,
// week locking and team CSV export. Pure helpers are tested in tests/team.test.js.
import {
  isoDate, parseIsoDate, addDays, dayMonth, shortDate, formatTime, entryMinutes, formatHours,
  DAYS_SHORT, shiftTimes,
} from './format.js';
import { esc } from './history.js';
import { RANGES, rangeDates, buildCsv } from './csv.js';
import { openSheet, header } from './sheets.js';
import { saveFile } from './ui.js';

const SKEW_FLAG_MS = 5 * 60 * 1000;

// ---------- Pure helpers ----------

export const weekRange = (weekStart) => ({ from: isoDate(weekStart), to: isoDate(addDays(weekStart, 6)) });

/** Finished, non-deleted shifts only (what counts towards hours). */
const counts = (e) => e.end && !e.deleted;

/**
 * One row per person for the week: minutes per day (7 columns) and total.
 * People are listed if they're active, or if they have shifts that week. Owner first, then by name.
 */
export function summarize(data, weekStart, { rounding = 0 } = {}) {
  const days = Array.from({ length: 7 }, (_, i) => isoDate(addDays(weekStart, i)));
  const runningBy = new Map((data.running || []).map((e) => [e.userId, e]));
  return data.users
    .map((u) => {
      const mine = data.entries.filter((e) => e.userId === u.id && counts(e));
      const perDay = days.map((d) => mine.filter((e) => isoDate(new Date(e.start)) === d).reduce((t, e) => t + entryMinutes(e, rounding), 0));
      return { user: u, perDay, total: perDay.reduce((a, b) => a + b, 0), running: runningBy.get(u.id) || null };
    })
    .filter((r) => !r.user.revoked || r.total > 0);
}

/** "Phone clock was 7 min fast" (or slow), or '' when within 5 minutes. */
export function clockNote(skewMs) {
  if (!skewMs || Math.abs(skewMs) < SKEW_FLAG_MS) return '';
  const m = Math.round(Math.abs(skewMs) / 60000);
  const amount = m >= 120 ? `${Math.round(m / 60)} h` : `${m} min`;
  return `Phone clock was ${amount} ${skewMs > 0 ? 'fast' : 'slow'}`;
}

/** Team CSV rows: Employee is always the person's name from the server. */
export function teamCsvEntries(entries, users, userId = null) {
  const names = new Map(users.map((u) => [u.id, u.name]));
  return entries
    .filter((e) => (userId === null || e.userId === userId) && counts(e))
    .map((e) => ({ ...e, employee: names.get(e.userId) || e.employee || '' }));
}

const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'person';
export const teamFilename = ({ from, to }, name = null) => `timesheet_${name ? slug(name) : 'team'}_${from}_to_${to}.csv`;

// ---------- Rendering ----------

const ICON_EXPORT = '<svg class="ico" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/></svg>';
const ICON_REFRESH = '<svg class="ico" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';

function weekNav(t, thisWeekStart) {
  const atNow = t.weekStart.getTime() >= thisWeekStart.getTime();
  return `
    <div class="weeknav">
      <button type="button" class="icon-btn" data-week="-1" aria-label="Previous week">‹</button>
      <div class="weeklabel">${atNow ? 'This week' : `Week of ${esc(dayMonth(t.weekStart))}`}</div>
      <button type="button" class="icon-btn" data-week="1" aria-label="Next week" ${atNow ? 'disabled' : ''}>›</button>
      <button type="button" class="icon-btn" id="team-refresh" aria-label="Refresh">${ICON_REFRESH}</button>
    </div>`;
}

function statusLine(t) {
  if (t.error) return `<div class="notice danger" role="alert"><b>Couldn’t load the team.</b> ${esc(t.error)}</div>`;
  if (t.loading && !t.data) return '<p class="muted">Loading…</p>';
  return '';
}

function lockLine(lockBefore) {
  return lockBefore
    ? `<p class="muted small lockline">Staff can’t change shifts before ${esc(shortDate(parseIsoDate(lockBefore)))}.
        <button type="button" class="link" id="team-lock">Change</button></p>`
    : '<p class="muted small lockline">No weeks are locked. <button type="button" class="link" id="team-lock">Lock weeks…</button></p>';
}

/** Team overview: who's clocked in, and hours per person per day for the week. */
export function renderTeam(t, { thisWeekStart, timeFormat = '12', rounding = 0, wide = false }) {
  const head = `
    <div class="row-between center"><h1>Team</h1>
      <div class="team-actions">
        <button type="button" class="export" id="team-export">${ICON_EXPORT}Export CSV</button>
        ${wide ? '<button type="button" class="export" id="close-team">My history</button>' : ''}
      </div></div>
    ${weekNav(t, thisWeekStart)}`;
  if (!t.data) return `<div class="stack team">${head}${statusLine(t)}</div>`;

  const rows = summarize(t.data, t.weekStart, { rounding });
  const days = Array.from({ length: 7 }, (_, i) => addDays(t.weekStart, i));
  const names = new Map(t.data.users.map((u) => [u.id, u.name]));
  const running = (t.data.running || []).slice().sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const now = running.length ? `
    <section class="card now" aria-label="Clocked in now">
      <div class="label now-label"><span class="dot ok" aria-hidden="true"></span>Clocked in now</div>
      ${running.map((e) => `
        <button type="button" class="now-row" data-person="${e.userId}">
          <span class="now-name">${esc(names.get(e.userId) || 'Unknown')}</span>
          <span class="muted">since ${esc(isoDate(new Date(e.start)) === isoDate(new Date()) ? formatTime(e.start, timeFormat) : `${shortDate(e.start)} ${formatTime(e.start, timeFormat)}`)}${e.device ? ` · ${esc(e.device)}` : ''}</span>
        </button>`).join('')}
    </section>` : '';
  const totalAll = rows.reduce((t2, r) => t2 + r.total, 0);
  const table = rows.length ? `
    <div class="card team-wrap">
      <table class="team-table">
        <thead><tr><th class="name">Name</th><th class="tot">Total</th>${days.map((d) => `<th>${DAYS_SHORT[d.getDay()]}<span>${d.getDate()}</span></th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) => `
          <tr data-person="${r.user.id}" tabindex="0" aria-label="${esc(r.user.name)}: ${formatHours(r.total)} hours this week">
            <td class="name">${esc(r.user.name)}${r.running ? ' <span class="dot ok" title="Clocked in"></span>' : ''}${r.user.revoked ? ' <span class="muted small">(left)</span>' : ''}</td>
            <td class="tot">${formatHours(r.total)}</td>
            ${r.perDay.map((m) => `<td>${m ? formatHours(m) : '<span class="muted">–</span>'}</td>`).join('')}
          </tr>`).join('')}</tbody>
        <tfoot><tr><td class="name">Everyone</td><td class="tot">${formatHours(totalAll)}</td>${days.map((d, i) => {
          const m = rows.reduce((t2, r) => t2 + r.perDay[i], 0);
          return `<td>${m ? formatHours(m) : ''}</td>`;
        }).join('')}</tr></tfoot>
      </table>
    </div>` : '<p class="muted">No one yet. Add staff on the server with admin.mjs.</p>';
  return `<div class="stack team">${head}${statusLine(t)}${now}${table}
    <p class="muted small hint">Tap a person to see their shifts and any changes.</p>
    ${lockLine(t.data.lockBefore)}</div>`;
}

/** One person's shifts for the week, with edits, clock flags and deletions shown. */
export function renderPerson(t, userId, { thisWeekStart, timeFormat = '12', rounding = 0 }) {
  const user = t.data?.users.find((u) => u.id === userId);
  if (!user) return renderTeam({ ...t, person: null }, { thisWeekStart, timeFormat, rounding });
  const list = t.data.entries.filter((e) => e.userId === userId).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const total = list.filter(counts).reduce((m, e) => m + entryMinutes(e, rounding), 0);
  const rows = list.map((e) => {
    const times = shiftTimes(e, rounding);
    const notes = [];
    if (!e.end) notes.push('<span class="badge ok">Clocked in</span>');
    if (e.deleted) notes.push('<span class="badge bad">Deleted</span>');
    if (e.original) {
      const was = `${formatTime(e.original.start, timeFormat)} – ${e.original.end ? formatTime(e.original.end, timeFormat) : '…'}`;
      notes.push(`<span class="badge warn">Changed</span> <span class="muted">was ${esc(was)}${isoDate(new Date(e.original.start)) !== isoDate(new Date(e.start)) ? ` on ${esc(shortDate(e.original.start))}` : ''}</span>`);
    } else if (e.edited) {
      notes.push('<span class="badge warn">Changed</span>');
    }
    const clock = clockNote(e.clockSkewMs);
    if (clock) notes.push(`<span class="badge warn">Clock</span> <span class="muted">${esc(clock)}</span>`);
    if (e.job) notes.push(`<span class="muted">${esc(e.job)}</span>`);
    return `
      <button type="button" class="hrow${e.deleted ? ' is-deleted' : ''}" data-team-edit="${esc(e.id)}"
        aria-label="${esc(shortDate(e.start))}, ${esc(formatTime(times.start, timeFormat))} to ${e.end ? esc(formatTime(times.end, timeFormat)) : 'now'}">
        <span class="d">${esc(shortDate(e.start))}</span>
        <span>${esc(formatTime(times.start, timeFormat))}</span>
        <span>${e.end ? esc(formatTime(times.end, timeFormat)) : '<span class="muted">now</span>'}</span>
        <span class="h">${e.end ? `${formatHours(entryMinutes(e, rounding))} h` : ''}</span>
        ${notes.length ? `<span class="sub notes">${notes.join(' ')}</span>` : ''}
      </button>`;
  }).join('');
  return `
    <div class="stack team">
      <div class="row-between center">
        <button type="button" class="link back" data-person-back>‹ Team</button>
        <button type="button" class="export" id="team-export" data-person-export="${userId}">${ICON_EXPORT}Export CSV</button>
      </div>
      <div><h1>${esc(user.name)}</h1>
        <p class="muted person-sub">${user.role === 'owner' ? 'Owner' : 'Staff'}${user.revoked ? ' · no longer syncing' : ''} · ${formatHours(total)} h ${t.weekStart.getTime() >= thisWeekStart.getTime() ? 'this week' : `week of ${esc(dayMonth(t.weekStart))}`}</p></div>
      ${weekNav(t, thisWeekStart)}
      ${statusLine(t)}
      <div class="cols" aria-hidden="true"><div>Date</div><div>Clock in</div><div>Clock out</div><div class="r">Total</div></div>
      ${rows ? `<div class="card list">${rows}</div>` : '<p class="empty muted">No shifts this week.</p>'}
      <p class="muted small hint">Tap a shift to correct it. ${esc(user.name)} sees the change next time their app syncs.</p>
    </div>`;
}

// ---------- Sheets ----------

/** Lock staff edits before a date, or unlock. onLock(dateOrNull) may throw. */
export function openLockSheet({ lockBefore, defaultDate, onLock }) {
  const dlg = openSheet('lock-sheet', `
    ${header('lock-sheet', 'Lock weeks')}
    <p class="sheet-text">Staff can’t add, change or delete shifts that start before this date. You can still correct them in Team.</p>
    <div class="fields"><label>Lock everything before<input type="date" name="before" value="${esc(lockBefore || defaultDate)}" required></label></div>
    <div class="error small" id="lock-error" role="alert"></div>
    <button type="submit" class="primary">Lock</button>
    ${lockBefore ? '<button type="button" class="secondary" id="lock-clear">Unlock all weeks</button>' : ''}`);
  const form = dlg.querySelector('form');
  const run = async (value) => {
    try { await onLock(value); dlg.close('done'); } catch (e) { dlg.querySelector('#lock-error').textContent = e.message; }
  };
  form.addEventListener('submit', (ev) => { ev.preventDefault(); if (form.elements.before.value) run(form.elements.before.value); });
  dlg.querySelector('#lock-clear')?.addEventListener('click', () => run(null));
}

/**
 * Team CSV export. Data for the chosen range is fetched while the sheet is open, so pressing
 * Export builds the file straight away (iOS needs the tap for the share sheet).
 */
export function openTeamExportSheet({ users, personId = null, weekStartsOn = 1, rounding = 0, fetchRange }) {
  let range = 'this-week';
  let loaded = null; // { key, entries, users }
  let seq = 0;
  const today = isoDate(new Date());
  const dlg = openSheet('team-export-sheet', `
    ${header('team-export-sheet', 'Export team CSV')}
    <div class="pills" role="group" aria-label="Date range">${RANGES.map((r) => `
      <button type="button" class="pill" data-range="${r.id}" aria-pressed="${r.id === range}">${esc(r.label)}</button>`).join('')}</div>
    <div class="custom-dates" id="tx-custom" hidden>
      <label>From<input type="date" id="tx-from" value="${today}"></label>
      <label>To<input type="date" id="tx-to" value="${today}"></label>
    </div>
    <div class="fields"><label>Who<select id="tx-person" class="select">
      <option value="">Everyone</option>
      ${users.map((u) => `<option value="${u.id}" ${u.id === personId ? 'selected' : ''}>${esc(u.name)}${u.revoked ? ' (left)' : ''}</option>`).join('')}
    </select></label></div>
    <div class="card summary"><div class="summary-main" id="tx-summary">Loading…</div><div class="muted small" id="tx-file"></div>
      <div class="error small" id="tx-error" role="alert"></div></div>
    <button type="button" class="primary" id="tx-go" disabled>Export</button>`);
  const $d = (s) => dlg.querySelector(s);

  const dates = () => (range === 'all' ? { from: '2000-01-01', to: today } : rangeDates(range, { weekStartsOn, from: $d('#tx-from').value, to: $d('#tx-to').value }));
  const current = () => {
    if (!loaded) return null;
    const pid = $d('#tx-person').value ? Number($d('#tx-person').value) : null;
    const list = teamCsvEntries(loaded.entries, loaded.users, pid);
    let d = loaded.dates;
    if (range === 'all' && list.length) {
      const ds = list.map((e) => isoDate(new Date(e.start))).sort();
      d = { from: ds[0], to: ds[ds.length - 1] };
    }
    const name = pid ? loaded.users.find((u) => u.id === pid)?.name : null;
    return { list, file: teamFilename(d, name) };
  };
  const show = () => {
    const c = current();
    if (!c) return;
    const people = new Set(c.list.map((e) => e.userId)).size;
    $d('#tx-summary').textContent = `${c.list.length} shift${c.list.length === 1 ? '' : 's'} · ${people} ${people === 1 ? 'person' : 'people'} · ${formatHours(c.list.reduce((m, e) => m + entryMinutes(e, rounding), 0))} h`;
    $d('#tx-file').textContent = c.file;
    $d('#tx-go').disabled = !c.list.length;
  };
  const load = async () => {
    const d = dates();
    const key = `${d.from}|${d.to}`;
    if (loaded?.key === key) { show(); return; }
    const mine = ++seq;
    $d('#tx-go').disabled = true;
    $d('#tx-summary').textContent = 'Loading…';
    $d('#tx-error').textContent = '';
    try {
      const reply = await fetchRange(d.from, d.to);
      if (mine !== seq) return;
      loaded = { key, dates: d, entries: reply.entries, users: reply.users };
      show();
    } catch (e) {
      if (mine === seq) { $d('#tx-summary').textContent = ''; $d('#tx-error').textContent = e.message; }
    }
  };

  dlg.addEventListener('click', (ev) => {
    const pill = ev.target.closest('[data-range]');
    if (!pill) return;
    range = pill.dataset.range;
    dlg.querySelectorAll('[data-range]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === range)));
    $d('#tx-custom').hidden = range !== 'custom';
    load();
  });
  $d('#tx-from').addEventListener('input', load);
  $d('#tx-to').addEventListener('input', load);
  $d('#tx-person').addEventListener('change', show);
  $d('#tx-go').addEventListener('click', async () => {
    const c = current();
    if (!c?.list.length) return;
    const how = await saveFile(buildCsv(c.list, { rounding }), c.file);
    if (how !== 'cancelled') dlg.close('exported');
  });
  load();
}
