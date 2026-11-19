import { entry } from './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupHistory, renderHistory, renderHistoryTable, historyRange, filterEntries,
} from '../js/history.js';
import { isoDate, formatHours } from '../js/format.js';

// Same data as design/mockup.html
const sample = () => [
  entry('2026-11-18', '07:45', '16:30'),
  entry('2026-11-17', '08:00', '17:00'),
  entry('2026-11-16', '13:15', '17:45'),
  entry('2026-11-16', '08:00', '12:30'),
  entry('2026-11-13', '08:00', '15:30'),
  entry('2026-11-12', '07:30', '16:00'),
  entry('2026-11-11', '08:00', '17:00'),
  entry('2026-11-10', '08:15', '17:15'),
  entry('2026-11-09', '08:00', '16:45'),
];

test('groups by Monday-start week, newest first, with correct totals', () => {
  const weeks = groupHistory(sample());
  assert.equal(weeks.length, 2);
  assert.equal(isoDate(weeks[0].weekStart), '2026-11-16');
  assert.equal(formatHours(weeks[0].minutes), '26.75');
  assert.equal(isoDate(weeks[1].weekStart), '2026-11-09');
  assert.equal(formatHours(weeks[1].minutes), '42.75');
  assert.deepEqual(weeks[0].days.map((d) => d.key), ['2026-11-18', '2026-11-17', '2026-11-16']);
});

test('a multi-shift day lists shifts oldest first with a day total', () => {
  const monday = groupHistory(sample())[0].days[2];
  assert.equal(monday.shifts.length, 2);
  assert.ok(monday.shifts[0].start < monday.shifts[1].start);
  assert.equal(formatHours(monday.minutes), '9.00');
});

test('running and deleted entries are left out', () => {
  const weeks = groupHistory([
    entry('2026-11-18', '07:45', '16:30'),
    entry('2026-11-19', '08:00', null),
    entry('2026-11-17', '08:00', '17:00', { deleted: true }),
  ]);
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0].days.length, 1);
  assert.equal(formatHours(weeks[0].minutes), '8.75');
});

test('a shift crossing midnight belongs to its start day (and week)', () => {
  const weeks = groupHistory([entry('2026-11-15', '22:00', '06:00', { endDate: '2026-11-16' })]);
  assert.equal(weeks[0].days[0].key, '2026-11-15');
  assert.equal(isoDate(weeks[0].weekStart), '2026-11-09');
});

test('renders rows in the mockup format', () => {
  const html = renderHistory(groupHistory(sample())).replace(/\s+/g, ' ');
  assert.match(html, /<span class="d">Mon 16 Nov<\/span> <span>8:00 am<\/span> <span>12:30 pm<\/span> <span class="h">4\.50 h/);
  assert.match(html, /Day total<\/span> <span class="h accent">9\.00 h/);
  assert.match(html, /Week of 16 Nov<\/div> <div class="week-total">26\.75 h/);
  // Second shift on the same day has a blank date cell
  assert.match(html, /<span class="d"><\/span> <span>1:15 pm<\/span>/);
});

test('24-hour times, rounding and labels change the display only', () => {
  const e = entry('2026-11-16', '08:07', '16:53', { job: 'Site <A>', employee: 'Sam' });
  const plain = renderHistory(groupHistory([e]), { timeFormat: '24' }).replace(/\s+/g, ' ');
  assert.match(plain, /<span>08:07<\/span> <span>16:53<\/span> <span class="h">8\.77 h/);
  assert.doesNotMatch(plain, /Site/);
  const rounded = renderHistory(groupHistory([e], { rounding: 15 }), { rounding: 15, showLabels: true }).replace(/\s+/g, ' ');
  assert.match(rounded, /<span>8:00 am<\/span> <span>5:00 pm<\/span> <span class="h">9\.00 h/);
  assert.match(rounded, /<span class="sub">Site &lt;A&gt; · Sam<\/span>/);
  assert.equal(e.start, '2026-11-16T08:07:00+10:00', 'stored times are untouched');
});

test('week can start on Sunday', () => {
  const weeks = groupHistory([entry('2026-11-15', '08:00', '17:00'), entry('2026-11-16', '08:00', '17:00')], { weekStartsOn: 0 });
  assert.equal(weeks.length, 1);
  assert.equal(isoDate(weeks[0].weekStart), '2026-11-15');
});

test('Mac table rows', () => {
  const html = renderHistoryTable(groupHistory(sample())).replace(/\s+/g, ' ');
  assert.match(html, /<td>16 Nov 2026<\/td> <td>Monday<\/td> <td>8:00 am<\/td> <td>12:30 pm<\/td> <td>4\.50<\/td>/);
  assert.match(html, /<tr class="wk"><td colspan="4">Week of 9 Nov<\/td><td>42\.75 h<\/td>/);
  assert.match(html, /data-delete=/);
});

test('Mac history filters', () => {
  const now = new Date('2026-11-19T10:00:00+10:00');
  assert.deepEqual(historyRange('two-weeks', { now }), { from: '2026-11-09', to: '2026-11-22' });
  assert.deepEqual(historyRange('month', { now }), { from: '2026-11-01', to: '2026-11-30' });
  assert.equal(historyRange('all', { now }), null);
  const list = [entry('2026-11-08', '08:00', '17:00'), entry('2026-11-09', '08:00', '17:00')];
  assert.equal(filterEntries(list, historyRange('two-weeks', { now })).length, 1);
  assert.equal(filterEntries(list, null).length, 2);
});

test('empty state', () => {
  assert.match(renderHistory([]), /No shifts yet\. Tap Start on the Timer tab\./);
});
