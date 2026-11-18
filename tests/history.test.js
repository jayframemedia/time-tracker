import { entry } from './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupHistory, renderHistory } from '../js/history.js';
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
  assert.match(html, /Mon 16 Nov<\/div> <div>8:00 am<\/div> <div>12:30 pm<\/div> <div class="h">4\.50 h/);
  assert.match(html, /Day total<\/div> <div class="h accent">9\.00 h/);
  assert.match(html, /Week of 16 Nov<\/div> <div class="week-total">26\.75 h/);
  // Second shift on the same day has a blank date cell
  assert.match(html, /<div class="d"><\/div> <div>1:15 pm<\/div>/);
});

test('empty state', () => {
  assert.match(renderHistory([]), /No shifts yet\. Tap Start on the Timer tab\./);
});
