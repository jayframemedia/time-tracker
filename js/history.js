// History grouping (pure) and HTML rendering (string only, no DOM access).
import {
  isoDate, parseIsoDate, startOfWeek, entryMinutes, formatHours, shortDate, dayMonth, time12,
} from './format.js';

/** Finished, non-deleted entries only. */
export const finishedEntries = (entries) => entries.filter((e) => e.end && !e.deleted);

/**
 * Group entries by week (newest first), then by day (newest first), shifts within a day oldest first.
 * A shift that crosses midnight belongs to the day it started.
 * → [{ weekStart: Date, minutes, days: [{ key, date: Date, minutes, shifts: [entry] }] }]
 */
export function groupHistory(entries, { weekStartsOn = 1 } = {}) {
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
    const m = entryMinutes(e);
    day.shifts.unshift(e); // list is newest-first, so unshift keeps the day oldest-first
    day.minutes += m;
    week.minutes += m;
  }
  return weeks;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Rows: "Mon 16 Nov | 8:00 am | 5:00 pm | 9.00 h", plus a "Day total" row for multi-shift days. */
export function renderHistory(weeks) {
  if (!weeks.length) {
    return '<p class="empty muted">No shifts yet. Tap Start on the Timer tab.</p>';
  }
  return weeks.map((w) => {
    const rows = w.days.map((day) => {
      const shiftRows = day.shifts.map((e, i) => `
        <div class="hrow" data-id="${esc(e.id)}">
          <div class="d">${i ? '' : esc(shortDate(day.date))}</div>
          <div>${esc(time12(e.start))}</div>
          <div>${esc(time12(e.end))}</div>
          <div class="h">${formatHours(entryMinutes(e))} h</div>
        </div>`).join('');
      const total = day.shifts.length > 1 ? `
        <div class="hrow day-total">
          <div></div><div></div>
          <div class="muted">Day total</div>
          <div class="h accent">${formatHours(day.minutes)} h</div>
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
