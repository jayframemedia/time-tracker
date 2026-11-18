import { entry } from './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clock, toLocalISO, isoDate, parseIsoDate, shortDate, dayMonth, longDay, time12, time24,
  entryMinutes, sumMinutes, formatHours, durationLabel, startOfWeek, addDays,
} from '../js/format.js';

test('clock formats elapsed time as HH:MM:SS', () => {
  assert.equal(clock(0), '00:00:00');
  assert.equal(clock(999), '00:00:00');
  assert.equal(clock(61_000), '00:01:01');
  assert.equal(clock((2 * 3600 + 14 * 60 + 37) * 1000), '02:14:37');
  assert.equal(clock(125 * 3600 * 1000), '125:00:00');
  assert.equal(clock(-5000), '00:00:00');
});

test('toLocalISO writes local time with the +10:00 offset', () => {
  const d = new Date('2026-11-16T08:00:05+10:00');
  assert.equal(toLocalISO(d), '2026-11-16T08:00:05+10:00');
  assert.equal(toLocalISO(new Date('2026-11-15T22:30:00Z')), '2026-11-16T08:30:00+10:00');
  // Round trip
  assert.equal(Date.parse(toLocalISO(d)), d.getTime());
});

test('date labels', () => {
  const d = new Date('2026-11-16T08:00:00+10:00');
  assert.equal(isoDate(d), '2026-11-16');
  assert.equal(shortDate(d), 'Mon 16 Nov');
  assert.equal(dayMonth(d), '16 Nov');
  assert.equal(longDay(d), 'Monday');
  assert.equal(isoDate(parseIsoDate('2026-02-28')), '2026-02-28');
});

test('time12 and time24', () => {
  const t = (s) => new Date(`2026-11-16T${s}:00+10:00`);
  assert.equal(time12(t('08:00')), '8:00 am');
  assert.equal(time12(t('17:00')), '5:00 pm');
  assert.equal(time12(t('00:05')), '12:05 am');
  assert.equal(time12(t('12:30')), '12:30 pm');
  assert.equal(time24(t('08:00')), '08:00');
  assert.equal(time24(t('17:45')), '17:45');
  assert.equal(time24(t('00:05')), '00:05');
});

test('entryMinutes uses whole clock minutes, ignoring seconds', () => {
  assert.equal(entryMinutes(entry('2026-11-16', '08:00', '17:00')), 540);
  assert.equal(entryMinutes({ start: '2026-11-16T08:00:59+10:00', end: '2026-11-16T17:00:00+10:00' }), 540);
  assert.equal(entryMinutes({ start: '2026-11-16T08:00:00+10:00', end: '2026-11-16T16:59:59+10:00' }), 539);
  assert.equal(entryMinutes(entry('2026-11-16', '08:00', null)), 0);
});

test('a shift crossing midnight counts its full duration', () => {
  const e = entry('2026-11-16', '22:00', '06:30', { endDate: '2026-11-17' });
  assert.equal(entryMinutes(e), 510);
  assert.equal(formatHours(entryMinutes(e)), '8.50');
});

test('formatHours gives 2 dp decimal hours', () => {
  assert.equal(formatHours(0), '0.00');
  assert.equal(formatHours(540), '9.00');
  assert.equal(formatHours(525), '8.75');
  assert.equal(formatHours(270), '4.50');
  assert.equal(formatHours(1), '0.02');
  assert.equal(formatHours(7), '0.12'); // 0.1166…
  assert.equal(formatHours(1605), '26.75');
});

test('sumMinutes and durationLabel', () => {
  const list = [entry('2026-11-16', '08:00', '12:30'), entry('2026-11-16', '13:15', '17:45')];
  assert.equal(sumMinutes(list), 540);
  assert.equal(durationLabel(540), '9h 00m');
  assert.equal(durationLabel(65), '1h 05m');
  assert.equal(durationLabel(0), '0h 00m');
});

test('startOfWeek starts on Monday by default', () => {
  const thu = new Date('2026-11-19T15:00:00+10:00');
  assert.equal(isoDate(startOfWeek(thu)), '2026-11-16');
  assert.equal(isoDate(startOfWeek(new Date('2026-11-16T00:00:00+10:00'))), '2026-11-16');
  assert.equal(isoDate(startOfWeek(new Date('2026-11-22T23:59:00+10:00'))), '2026-11-16');
  assert.equal(isoDate(startOfWeek(thu, 0)), '2026-11-15');
  assert.equal(isoDate(addDays(parseIsoDate('2026-12-31'), 1)), '2027-01-01');
});
