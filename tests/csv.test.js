import { entry } from './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildCsv, csvField, csvFilename, rangeDates, entriesInRange, CSV_HEADER, safeText,
} from '../js/csv.js';

const sampleEntries = () => [
  entry('2026-11-13', '08:00', '15:30', { id: 'b15c7d66-9e2f-4a8b-c3d1-2e4f6a8b0c66' }),
  entry('2026-11-16', '08:00', '12:30', { id: 'e92a1f55-6c3b-4d7e-a8f2-1b9c4d6e3a55' }),
  entry('2026-11-16', '13:15', '17:45', { id: 'c47e9b31-2d8a-4f6e-b1c0-7a3d9e5f2b44' }),
  entry('2026-11-17', '08:00', '17:00', { id: 'a81d4c22-7e0f-4b9a-8c3d-5f1e2a9b6c33' }),
  entry('2026-11-18', '07:45', '16:30', { id: '3f9c2a10-1b7e-4c1d-9a55-0d2b7e4f8a11' }),
];

test('header is exactly as specified', () => {
  assert.equal(CSV_HEADER.join(','), 'Date,Day,Clock in,Clock out,Total hours,Employee,Job,ID');
});

test('output matches samples/sample-export.csv (plus BOM and CRLF)', () => {
  const csv = buildCsv(sampleEntries());
  assert.ok(csv.startsWith('﻿'), 'starts with a UTF-8 BOM');
  assert.ok(csv.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(csv), 'every line ends with CRLF');
  const sample = readFileSync(new URL('../samples/sample-export.csv', import.meta.url), 'utf8');
  const norm = (s) => s.replace(/^﻿/, '').replace(/\r\n/g, '\n').trimEnd();
  assert.equal(norm(csv), norm(sample));
});

test('running and deleted entries are not exported', () => {
  const csv = buildCsv([
    entry('2026-11-18', '07:45', '16:30', { id: 'keep' }),
    entry('2026-11-19', '08:00', null, { id: 'running' }),
    entry('2026-11-17', '08:00', '17:00', { id: 'gone', deleted: true }),
  ]);
  assert.match(csv, /keep/);
  assert.doesNotMatch(csv, /running|gone/);
});

test('RFC 4180 quoting for job and employee', () => {
  assert.equal(csvField(null), '');
  assert.equal(csvField('Plain'), 'Plain');
  assert.equal(csvField('Smith, J'), '"Smith, J"');
  assert.equal(csvField('The "big" job'), '"The ""big"" job"');
  assert.equal(csvField('two\nlines'), '"two\nlines"');
  const csv = buildCsv([entry('2026-11-18', '07:45', '16:30', { id: 'x', employee: 'Smith, J', job: 'Site "A"' })]);
  assert.match(csv, /,8\.75,"Smith, J","Site ""A""",x\r\n$/);
});

test('midnight-crossing shift exports on its start date with full hours', () => {
  const csv = buildCsv([entry('2026-11-16', '22:00', '06:30', { id: 'n', endDate: '2026-11-17' })]);
  assert.match(csv, /2026-11-16,Monday,22:00,06:30,8\.50,,,n/);
});

test('range presets (week starts Monday)', () => {
  const now = new Date('2026-11-19T15:00:00+10:00'); // Thursday
  assert.deepEqual(rangeDates('this-week', { now }), { from: '2026-11-16', to: '2026-11-22' });
  assert.deepEqual(rangeDates('last-week', { now }), { from: '2026-11-09', to: '2026-11-15' });
  assert.deepEqual(rangeDates('this-month', { now }), { from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(rangeDates('all', { now, entries: sampleEntries() }), { from: '2026-11-13', to: '2026-11-18' });
  assert.deepEqual(rangeDates('all', { now, entries: [] }), { from: '2026-11-19', to: '2026-11-19' });
  assert.deepEqual(rangeDates('custom', { now, from: '2026-11-20', to: '2026-11-01' }), { from: '2026-11-01', to: '2026-11-20' });
  assert.deepEqual(rangeDates('this-month', { now: new Date('2027-02-10T09:00:00+10:00') }), { from: '2027-02-01', to: '2027-02-28' });
});

test('entriesInRange is inclusive on both ends', () => {
  const list = entriesInRange(sampleEntries(), { from: '2026-11-16', to: '2026-11-17' });
  assert.equal(list.length, 3);
});

test('rounding applies to CSV times and hours; date stays the stored start date', () => {
  const csv = buildCsv([entry('2026-11-16', '08:07', '16:53', { id: 'r' })], { rounding: 15 });
  assert.match(csv, /2026-11-16,Monday,08:00,17:00,9\.00,,,r/);
  assert.match(buildCsv([entry('2026-11-16', '08:07', '16:53', { id: 'r' })]), /08:07,16:53,8\.77/);
});

test('formula-looking job/employee text is neutralised (CSV injection)', () => {
  assert.equal(safeText('=HYPERLINK("http://x","click")'), `'=HYPERLINK("http://x","click")`);
  assert.equal(safeText('+61 400'), "'+61 400");
  assert.equal(safeText('-5'), "'-5");
  assert.equal(safeText('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(safeText('Site A'), 'Site A');
  assert.equal(safeText(null), null);
  const csv = buildCsv([entry('2026-11-16', '08:00', '17:00', { id: 'z', job: '=1+1', employee: 'Sam' })]);
  assert.match(csv, /,9\.00,Sam,'=1\+1,z\r\n$/);
});

test('filename', () => {
  assert.equal(csvFilename({ from: '2026-11-16', to: '2026-11-22' }), 'timesheet_2026-11-16_to_2026-11-22.csv');
});
