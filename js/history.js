// History grouping and filtering (pure) and HTML rendering (strings only, no DOM access).
import {
  isoDate, parseIsoDate, startOfWeek, addDays, entryMinutes, formatHours, shortDate, dayMonth,
  longDay, formatTime, shiftTimes, MONTHS,
} from './format.js';

/** Finished, non-deleted entries only. */
export const finishedEntries = (entries) => entries.filter((e) => e.end && !e.deleted);

/**
 * Group entries by week (newest first), then by day (newest first), shifts within a day oldest first.
 * A shift that crosses midnight belongs to the day it started.
 * → [{ weekStart: Date, minutes, days: [{ key, date: Date, minutes, shifts: [entry] }] }]
 */
export function groupHistory(entries, { weekStartsOn = 1, rounding = 0 } = {}) {
  const list = finishedEntries(entries).slice().sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  const weeks = [];
  for (const e of list) {
    const start = new Date(e.start);
    const key = isoDate(start);
    const ws = startOfWeek(start, weekStartsOn);
    let week = weeks[weeks.length - 1];
    if (!week || week.weekStart.getTime() !== ws.getTime()) {
      week = { weekStart: ws, minutes: 0, days: [] };
      weeks.push(week);
    }
    let day = week.days[week.days.length - 1];
    if (!day || day.key !== key) {
      day = { key, date: parseIsoDate(key), minutes: 0, shifts: [] };
      week.days.push(day);
    }
    const m = entryMinutes(e, rounding);
    day.shifts.unshift(e); // list is newest-first, so unshift keeps the day oldest-first
    day.minutes += m;
    week.minutes += m;
  }
  return weeks;
}

export const HISTORY_FILTERS = [
  { id: 'two-weeks', label: 'Last 2 weeks' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All' },
];

/** Inclusive "YYYY-MM-DD" range for a Mac history filter, or null for "all". */
export function historyRange(kind, { now = new Date(), weekStartsOn = 1 } = {}) {
  if (kind === 'two-weeks') {
    const ws = startOfWeek(now, weekStartsOn);
    return { from: isoDate(addDays(ws, -7)), to: isoDate(addDays(ws, 6)) };
  }
  if (kind === 'month') {
    return {
      from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
      to: isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    };
  }
  return null;
}

export function filterEntries(entries, range) {
  if (!range) return entries;
  return entries.filter((e) => {
    const d = isoDate(new Date(e.start));
    return d >= range.from && d <= range.to;
  });
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const labelsOf = (e) => [e.job, e.employee].filter(Boolean).join(' · ');

const LOCK = '<svg class="lock-ico" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
/** Staff: shifts that start before the owner's lock date can't be changed. */
const isLocked = (dayKey, lockedBefore) => !!lockedBefore && dayKey < lockedBefore;

/** "16 Nov 2026" */
const fullDate = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

/**
 * iPhone list. Rows: "Mon 16 Nov | 8:00 am | 5:00 pm | 9.00 h", plus a "Day total" row for
 * multi-shift days. Each row is a button (tap → edit) inside a swipe container (swipe left → delete).
 */
export function renderHistory(weeks, { timeFormat = '12', rounding = 0, showLabels = false, newId = null, lockedBefore = null } = {}) {
  if (!weeks.length) {
    return '<p class="empty muted">No shifts yet. Tap Start on the Timer tab.</p>';
  }
  return weeks.map((w) => {
    const rows = w.days.map((day) => {
      const shiftRows = day.shifts.map((e, i) => {
        const t = shiftTimes(e, rounding);
        const hours = formatHours(entryMinutes(e, rounding));
        const tin = formatTime(t.start, timeFormat);
        const tout = formatTime(t.end, timeFormat);
        const labels = showLabels ? labelsOf(e) : '';
        const locked = isLocked(day.key, lockedBefore);
        return `
        <div class="swipe${e.id === newId ? ' new' : ''}${locked ? ' locked' : ''}" data-id="${esc(e.id)}">
          ${locked ? '' : `<button type="button" class="swipe-del" data-delete="${esc(e.id)}" tabindex="-1" aria-hidden="true">Delete</button>`}
          <button type="button" class="hrow" ${locked ? 'data-locked' : `data-edit="${esc(e.id)}"`}
            aria-label="${locked ? 'Locked shift' : 'Edit shift'}: ${esc(shortDate(day.date))}, ${esc(tin)} to ${esc(tout)}, ${hours} hours${labels ? `, ${esc(labels)}` : ''}">
            <span class="d">${i ? '' : esc(shortDate(day.date))}</span>
            <span>${esc(tin)}</span>
            <span>${esc(tout)}</span>
            <span class="h">${locked ? LOCK : ''}${hours} h</span>
            ${labels ? `<span class="sub">${esc(labels)}</span>` : ''}
          </button>
        </div>`;
      }).join('');
      const total = day.shifts.length > 1 ? `
        <div class="hrow day-total" aria-label="Day total ${formatHours(day.minutes)} hours">
          <span></span><span></span>
          <span class="muted">Day total</span>
          <span class="h accent">${formatHours(day.minutes)} h</span>
        </div>` : '';
      return shiftRows + total;
    }).join('');
    return `
      <section class="week" aria-label="Week of ${esc(dayMonth(w.weekStart))}">
        <div class="row-between week-head">
          <div class="label week-label">Week of ${esc(dayMonth(w.weekStart))}</div>
          <div class="week-total">${formatHours(w.minutes)} h</div>
        </div>
        <div class="card list">${rows}</div>
      </section>`;
  }).join('');
}

const TRASH = '<svg class="ico" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/></svg>';

/** Mac table: "16 Nov 2026 | Monday | 8:00 am | 5:00 pm | 9.00", week header rows, delete button on hover. */
export function renderHistoryTable(weeks, { timeFormat = '12', rounding = 0, showLabels = false, newId = null, lockedBefore = null } = {}) {
  if (!weeks.length) {
    return '<p class="empty muted">No shifts in this range. Press Start to clock in.</p>';
  }
  const body = weeks.map((w) => {
    const head = `<tr class="wk"><td colspan="4">Week of ${esc(dayMonth(w.weekStart))}</td><td>${formatHours(w.minutes)} h</td><td></td></tr>`;
    const rows = w.days.map((day) => {
      const shiftRows = day.shifts.map((e) => {
        const t = shiftTimes(e, rounding);
        const labels = showLabels ? labelsOf(e) : '';
        const locked = isLocked(day.key, lockedBefore);
        return `
          <tr class="shift${e.id === newId ? ' new' : ''}${locked ? ' locked' : ''}" ${locked ? 'data-locked' : `data-edit="${esc(e.id)}"`} tabindex="0"
            aria-label="${locked ? 'Locked shift' : 'Edit shift'}: ${esc(fullDate(day.date))}, ${esc(formatTime(t.start, timeFormat))} to ${esc(formatTime(t.end, timeFormat))}">
            <td>${esc(fullDate(day.date))}</td>
            <td>${esc(longDay(day.date))}${labels ? `<span class="sub">${esc(labels)}</span>` : ''}</td>
            <td>${esc(formatTime(t.start, timeFormat))}</td>
            <td>${esc(formatTime(t.end, timeFormat))}</td>
            <td>${locked ? LOCK : ''}${formatHours(entryMinutes(e, rounding))}</td>
            <td class="act">${locked ? '' : `<button type="button" class="row-del" data-delete="${esc(e.id)}" aria-label="Delete shift ${esc(fullDate(day.date))} ${esc(formatTime(t.start, timeFormat))}">${TRASH}</button>`}</td>
          </tr>`;
      }).join('');
      const total = day.shifts.length > 1
        ? `<tr class="day-total"><td></td><td></td><td></td><td class="muted">Day total</td><td class="accent">${formatHours(day.minutes)}</td><td></td></tr>`
        : '';
      return shiftRows + total;
    }).join('');
    return head + rows;
  }).join('');
  return `
    <div class="card tablecard">
      <table>
        <thead><tr><th>Date</th><th>Day</th><th>Clock in</th><th>Clock out</th><th>Total hours</th><th class="act"><span class="sr">Actions</span></th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}
