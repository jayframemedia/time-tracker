// CSV export (pure). Format is fixed — see CLAUDE.md and samples/sample-export.csv.
import {
  isoDate, longDay, time24, entryMinutes, formatHours, startOfWeek, addDays, shiftTimes,
} from './format.js';
import { finishedEntries } from './history.js';

export const CSV_HEADER = ['Date', 'Day', 'Clock in', 'Clock out', 'Total hours', 'Employee', 'Job', 'ID'];
export const RANGES = [
  { id: 'this-week', label: 'This week' },
  { id: 'last-week', label: 'Last week' },
  { id: 'this-month', label: 'This month' },
  { id: 'all', label: 'All' },
  { id: 'custom', label: 'Custom' },
];

/** RFC 4180 field quoting. */
export function csvField(value) {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One shift. Date and Day come from the stored start; times and hours use the rounding setting. */
/**
 * Free text typed by people (job, employee) could start with =, +, - or @ and be run as a
 * formula when the CSV is opened in Excel/Sheets/Numbers. Prefix those with ' so they stay text.
 * (OWASP "CSV injection" guidance.)
 */
export function safeText(value) {
  if (value == null) return value;
  const s = String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function csvRow(entry, { rounding = 0 } = {}) {
  const day = new Date(entry.start);
  const t = shiftTimes(entry, rounding);
  return [
    isoDate(day),
    longDay(day),
    time24(t.start),
    time24(t.end),
    formatHours(entryMinutes(entry, rounding)),
    safeText(entry.employee),
    safeText(entry.job),
    entry.id,
  ].map(csvField).join(',');
}

/** Full file text: UTF-8 BOM (so Excel reads it), CRLF line endings, newest shift first. */
export function buildCsv(entries, { rounding = 0 } = {}) {
  const rows = finishedEntries(entries)
    .slice()
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start))
    .map((e) => csvRow(e, { rounding }));
  return `﻿${[CSV_HEADER.join(','), ...rows].join('\r\n')}\r\n`;
}

/**
 * Inclusive date range for a preset, as "YYYY-MM-DD" strings.
 * "all" spans the first to the last finished shift (today if there are none).
 */
export function rangeDates(kind, { now = new Date(), entries = [], weekStartsOn = 1, from, to } = {}) {
  const ws = startOfWeek(now, weekStartsOn);
  switch (kind) {
    case 'this-week': return { from: isoDate(ws), to: isoDate(addDays(ws, 6)) };
    case 'last-week': return { from: isoDate(addDays(ws, -7)), to: isoDate(addDays(ws, -1)) };
    case 'this-month': {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { from: isoDate(first), to: isoDate(last) };
    }
    case 'all': {
      const days = finishedEntries(entries).map((e) => isoDate(new Date(e.start))).sort();
      return days.length ? { from: days[0], to: days[days.length - 1] } : { from: isoDate(now), to: isoDate(now) };
    }
    case 'custom': {
      const a = from || isoDate(now);
      const b = to || a;
      return a <= b ? { from: a, to: b } : { from: b, to: a };
    }
    default: throw new Error(`Unknown range: ${kind}`);
  }
}

/** Finished, non-deleted entries whose start date falls inside the inclusive range. */
export function entriesInRange(entries, { from, to }) {
  return finishedEntries(entries).filter((e) => {
    const d = isoDate(new Date(e.start));
    return d >= from && d <= to;
  });
}

export const csvFilename = ({ from, to }) => `timesheet_${from}_to_${to}.csv`;
