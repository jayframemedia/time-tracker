import { entry } from './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, clockNote, teamCsvEntries, teamFilename, weekRange, renderTeam, renderPerson } from '../js/team.js';
import { parseIsoDate } from '../js/format.js';
import { buildCsv } from '../js/csv.js';

const weekStart = parseIsoDate('2026-11-16');
const users = [
  { id: 1, name: 'Jason', role: 'owner', revoked: false },
  { id: 2, name: 'Sam', role: 'staff', revoked: false },
  { id: 3, name: 'Old Hand', role: 'staff', revoked: true },
];
const e = (id, userId, date, s, en, extra = {}) => ({ ...entry(date, s, en, { id }), userId, clockSkewMs: null, original: null, ...extra });
const data = {
  users,
  entries: [
    e('a', 2, '2026-11-16', '08:00', '16:00'),
    e('b', 2, '2026-11-17', '08:00', '12:30', { original: { start: '2026-11-17T08:00:00+10:00', end: '2026-11-17T12:00:00+10:00' } }),
    e('c', 2, '2026-11-18', '08:00', '09:00', { deleted: true }),
    e('d', 1, '2026-11-16', '07:00', '15:00'),
    e('r', 2, '2026-11-19', '08:00', null),
  ],
  running: [e('r', 2, '2026-11-19', '08:00', null)],
  lockBefore: '2026-11-16',
};

test('weekRange', () => {
  assert.deepEqual(weekRange(weekStart), { from: '2026-11-16', to: '2026-11-22' });
});

test('summarize: per-day minutes, deleted and running shifts excluded, revoked hidden when idle', () => {
  const rows = summarize(data, weekStart);
  assert.deepEqual(rows.map((r) => r.user.name), ['Jason', 'Sam']);
  const sam = rows.find((r) => r.user.name === 'Sam');
  assert.deepEqual(sam.perDay, [480, 270, 0, 0, 0, 0, 0]);
  assert.equal(sam.total, 750);
  assert.equal(sam.running.id, 'r');
  assert.equal(summarize(data, weekStart, { rounding: 15 }).find((r) => r.user.name === 'Sam').total, 750);
});

test('clock notes only past 5 minutes', () => {
  assert.equal(clockNote(null), '');
  assert.equal(clockNote(4 * 60000), '');
  assert.equal(clockNote(7 * 60000), 'Phone clock was 7 min fast');
  assert.equal(clockNote(-10 * 60000), 'Phone clock was 10 min slow');
  assert.equal(clockNote(3 * 3600000), 'Phone clock was 3 h fast');
});

test('team CSV uses the person’s name as Employee and skips deleted/running', () => {
  const list = teamCsvEntries(data.entries, users);
  assert.deepEqual(list.map((x) => x.id).sort(), ['a', 'b', 'd']);
  const csv = buildCsv(list);
  assert.match(csv, /2026-11-16,Monday,08:00,16:00,8\.00,Sam,,a/);
  assert.match(csv, /2026-11-16,Monday,07:00,15:00,8\.00,Jason,,d/);
  assert.deepEqual(teamCsvEntries(data.entries, users, 1).map((x) => x.id), ['d']);
  assert.equal(teamFilename({ from: '2026-11-16', to: '2026-11-22' }), 'timesheet_team_2026-11-16_to_2026-11-22.csv');
  assert.equal(teamFilename({ from: '2026-11-16', to: '2026-11-22' }, 'Sam O’Neil'), 'timesheet_sam-o-neil_2026-11-16_to_2026-11-22.csv');
});

test('renderTeam and renderPerson', () => {
  const t = { weekStart, data, loading: false, error: null };
  const html = renderTeam(t, { thisWeekStart: weekStart }).replace(/\s+/g, ' ');
  assert.match(html, /Clocked in now/);
  assert.match(html, /<td class="name">Sam <span class="dot ok"/);
  assert.match(html, /<td class="tot">12\.50<\/td>/);
  assert.match(html, /Staff can’t change shifts before Mon 16 Nov/);
  assert.doesNotMatch(html, /Old Hand/);
  const p = renderPerson(t, 2, { thisWeekStart: weekStart }).replace(/\s+/g, ' ');
  assert.match(p, /<h1>Sam<\/h1>/);
  assert.match(p, /12\.50 h this week/);
  assert.match(p, /Changed<\/span> <span class="muted">was 8:00 am – 12:00 pm/);
  assert.match(p, /Deleted/);
  assert.match(p, /Clocked in/);
});
