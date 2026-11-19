import { entry } from './helpers.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openStore, createSyncServer, cleanEntry } from '../server/server.mjs';

const OWNER = 'owner-key-0123456789-abcdefghijklmn';
const ORIGIN = 'https://timetracker.jayframemedia.com.au';
let dir; let store; let server; let base; let SAM; let ALEX;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tt-sync-'));
  store = openStore(join(dir, 'sync.db'), { ownerToken: OWNER, ownerName: 'Jason' });
  SAM = store.addUser('Sam');
  ALEX = store.addUser('Alex');
  server = createSyncServer({ store, allowedOrigins: [ORIGIN] });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); store.close(); rmSync(dir, { recursive: true, force: true }); });

const api = async (path, { method = 'GET', body, key = OWNER, origin = ORIGIN, clientTime } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(clientTime ? { 'X-Client-Time': String(clientTime) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
};
const json = async (...args) => (await api(...args)).json();
const push = (key, entries, extra = {}) => json('/api/entries', { method: 'POST', body: { entries }, key, ...extra });
const pull = (key, since = 0) => json(`/api/entries?since=${since}`, { key });
const shift = (id, date, s, e, extra = {}) => entry(date, s, e, { id, updatedAt: `${date}T${e || s}:00+10:00`, ...extra });

test('health needs no key; every API call needs a valid personal key', async () => {
  assert.equal(await (await api('/health', { key: null })).text(), 'ok');
  assert.equal((await api('/api/ping', { key: null })).status, 401);
  assert.equal((await api('/api/ping', { key: 'not-a-real-key-not-a-real-key' })).status, 401);
  assert.deepEqual((await json('/api/ping')).user, { name: 'Jason', role: 'owner' });
  assert.deepEqual((await json('/api/ping', { key: SAM })).user, { name: 'Sam', role: 'staff' });
});

test('CORS allows only the app origin and the clock header', async () => {
  const pre = await api('/api/entries', { method: 'OPTIONS', key: null });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), ORIGIN);
  assert.match(pre.headers.get('access-control-allow-headers'), /Authorization.*X-Client-Time/);
  const other = await api('/api/ping', { origin: 'https://evil.example' });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
});

test('own shifts: upsert, pull by cursor, last write wins', async () => {
  const a = shift('o1', '2026-11-16', '08:00', '17:00');
  let r = await push(OWNER, [a]);
  assert.deepEqual([r.upserted, r.skipped], [1, 0]);
  const p1 = await pull(OWNER);
  assert.deepEqual(p1.entries.map((e) => e.id), ['o1']);
  r = await push(OWNER, [{ ...a, job: 'old', updatedAt: '2026-11-16T09:00:00+10:00' }]);
  assert.deepEqual([r.upserted, r.skipped], [0, 1]);
  r = await push(OWNER, [{ ...a, job: 'new', updatedAt: '2026-11-16T18:00:00+10:00' }]);
  assert.equal(r.upserted, 1);
  const p2 = await pull(OWNER, p1.cursor);
  assert.deepEqual(p2.entries.map((e) => e.job), ['new']);
});

test('staff only ever see and change their own shifts', async () => {
  await push(SAM, [shift('s1', '2026-11-17', '07:00', '15:00')]);
  await push(ALEX, [shift('x1', '2026-11-17', '09:00', '17:00')]);
  assert.deepEqual((await pull(SAM)).entries.map((e) => e.id), ['s1']);
  assert.deepEqual((await pull(ALEX)).entries.map((e) => e.id), ['x1']);
  assert.ok(!(await pull(OWNER)).entries.some((e) => e.id === 's1'), 'owner sync only carries owner shifts');

  // Sam tries to overwrite Alex's shift and the owner's shift by id: refused, nothing changes.
  const r = await push(SAM, [
    shift('x1', '2026-11-17', '09:00', '23:00', { updatedAt: '2026-11-18T00:00:00+10:00' }),
    shift('o1', '2026-11-16', '08:00', '23:00', { updatedAt: '2026-11-19T00:00:00+10:00' }),
  ]);
  assert.deepEqual(r.rejected.sort(), ['o1', 'x1']);
  assert.equal(r.upserted, 0);
  assert.equal((await pull(ALEX)).entries[0].end, '2026-11-17T17:00:00+10:00');
});

test('team endpoints are owner-only and show everyone, who is clocked in, and original times', async () => {
  assert.equal((await api('/api/team/entries?from=2026-11-16&to=2026-11-22', { key: SAM })).status, 403);
  assert.equal((await api('/api/team/lock', { method: 'POST', body: { before: '2026-11-16' }, key: SAM })).status, 403);

  // Sam edits his own shift's clock-out; Alex is clocked in now with a phone 10 min fast.
  await push(SAM, [shift('s1', '2026-11-17', '07:00', '16:00', { edited: true, updatedAt: '2026-11-17T20:00:00+10:00' })]);
  await push(ALEX, [entry('2026-11-18', '08:00', null, { id: 'x2', updatedAt: '2026-11-18T08:00:00+10:00' })], { clientTime: Date.now() + 600_000 });

  const t = await json('/api/team/entries?from=2026-11-16&to=2026-11-22');
  assert.deepEqual(t.users.map((u) => [u.name, u.role]), [['Jason', 'owner'], ['Alex', 'staff'], ['Sam', 'staff']]);
  const sam = t.users.find((u) => u.name === 'Sam');
  const s1 = t.entries.find((e) => e.id === 's1');
  assert.equal(s1.userId, sam.id);
  assert.deepEqual(s1.original, { start: '2026-11-17T07:00:00+10:00', end: '2026-11-17T15:00:00+10:00' });
  const x2 = t.entries.find((e) => e.id === 'x2');
  assert.ok(x2.clockSkewMs > 590_000, 'phone clock error recorded');
  assert.deepEqual(t.running.map((e) => e.id), ['x2']);
  assert.equal((await api('/api/team/entries?from=bad&to=2026-11-22')).status, 400);
});

test('owner can correct a staff shift; the staff device receives it', async () => {
  const { cursor } = await pull(SAM);
  const fixed = shift('s1', '2026-11-17', '07:00', '15:30', { edited: true, updatedAt: '2026-11-19T10:00:00+10:00' });
  const r = await json('/api/team/entries', { method: 'POST', body: { entries: [fixed] } });
  assert.equal(r.upserted, 1);
  const p = await pull(SAM, cursor);
  assert.deepEqual(p.entries.map((e) => e.end), ['2026-11-17T15:30:00+10:00']);
  // Still Sam's shift
  const t = await json('/api/team/entries?from=2026-11-17&to=2026-11-17');
  assert.equal(t.entries.find((e) => e.id === 's1').userId, t.users.find((u) => u.name === 'Sam').id);
  // The Team view can't create shifts out of thin air
  const r2 = await json('/api/team/entries', { method: 'POST', body: { entries: [shift('new1', '2026-11-17', '08:00', '09:00')] } });
  assert.deepEqual(r2.rejected, ['new1']);
});

test('locked weeks: staff edits are refused and the device gets the server copy back', async () => {
  let r = await json('/api/team/lock', { method: 'POST', body: { before: '2026-11-18' } });
  assert.equal(r.lockBefore, '2026-11-18');
  assert.equal((await json('/api/ping', { key: SAM })).lockBefore, '2026-11-18');

  // Sam edits a locked shift → rejected, server copy returned
  r = await push(SAM, [shift('s1', '2026-11-17', '07:00', '23:00', { updatedAt: '2026-11-20T00:00:00+10:00' })]);
  assert.deepEqual(r.rejected, ['s1']);
  assert.equal(r.restore[0].end, '2026-11-17T15:30:00+10:00');
  // Sam adds a new shift inside a locked week → rejected, a hidden tombstone comes back
  r = await push(SAM, [shift('s2', '2026-11-10', '08:00', '12:00')]);
  assert.deepEqual(r.rejected, ['s2']);
  assert.equal(r.restore[0].deleted, true);
  // Moving an unlocked shift into the locked period is refused too
  await push(SAM, [shift('s3', '2026-11-19', '08:00', '12:00')]);
  r = await push(SAM, [shift('s3', '2026-11-12', '08:00', '12:00', { updatedAt: '2026-11-20T01:00:00+10:00' })]);
  assert.deepEqual(r.rejected, ['s3']);
  // Unlocked days still work, and the owner is never locked
  r = await push(SAM, [shift('s4', '2026-11-19', '13:00', '14:00')]);
  assert.equal(r.upserted, 1);
  r = await push(OWNER, [shift('o2', '2026-11-10', '08:00', '12:00')]);
  assert.equal(r.upserted, 1);

  r = await json('/api/team/lock', { method: 'POST', body: { before: null } });
  assert.equal(r.lockBefore, null);
  assert.equal((await api('/api/team/lock', { method: 'POST', body: { before: '19/11/2026' } })).status, 400);
});

test('revoke, new key and rename', async () => {
  store.revokeUser('Alex');
  assert.equal((await api('/api/ping', { key: ALEX })).status, 401);
  const fresh = store.newUserKey('Alex');
  assert.equal((await api('/api/ping', { key: ALEX })).status, 401, 'old key stays dead');
  assert.equal((await json('/api/ping', { key: fresh })).user.name, 'Alex');
  ALEX = fresh;
  store.renameUser('Alex', 'Alex Brown');
  assert.equal((await json('/api/ping', { key: ALEX })).user.name, 'Alex Brown');
  assert.throws(() => store.revokeUser('Jason'), /owner/);
  assert.throws(() => store.addUser('sam'), /UNIQUE/); // names are case-insensitive
  assert.ok(store.listUsers().find((u) => u.name === 'Alex Brown').shifts >= 1, 'shifts kept');
});

test('admin command line', () => {
  const env = { ...process.env, DB_PATH: join(dir, 'sync.db') };
  const run = (...a) => execFileSync(process.execPath, ['server/admin.mjs', ...a], { env, encoding: 'utf8' });
  const added = run('add', 'Taylor');
  const key = /\n {2}([A-Za-z0-9_-]{43})\n/.exec(added)?.[1];
  assert.ok(key, 'prints a 43-character key');
  assert.equal(store.authenticate(key).name, 'Taylor');
  const list = run('list');
  assert.match(list, /Jason\s+owner\s+active/);
  assert.match(list, /Taylor\s+staff\s+active\s+0\s+/);
  run('revoke', 'Taylor');
  assert.equal(store.authenticate(key), null);
});

test('upgrading an existing single-user database keeps every shift for the owner', () => {
  const path = join(dir, 'old.db');
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE entries (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_ms INTEGER NOT NULL, seq INTEGER NOT NULL);
    CREATE INDEX entries_seq ON entries (seq); PRAGMA user_version = 1;`);
  const ins = old.prepare('INSERT INTO entries VALUES (?, ?, ?, ?)');
  const e1 = shift('m1', '2026-11-03', '08:00', '17:00');
  const e2 = shift('m2', '2026-11-04', '08:00', '16:00');
  ins.run('m1', JSON.stringify(e1), Date.parse(e1.updatedAt), 1);
  ins.run('m2', JSON.stringify(e2), Date.parse(e2.updatedAt), 2);
  old.close();

  assert.throws(() => openStore(path), /SYNC_TOKEN/);
  const up = openStore(path, { ownerToken: 'the-old-sync-token-0123456789', ownerName: 'Jason' });
  const me = up.authenticate('the-old-sync-token-0123456789');
  assert.deepEqual([me.name, me.role], ['Jason', 'owner']);
  assert.deepEqual(up.since(me, 0).entries.map((e) => e.id), ['m1', 'm2']);
  assert.equal(up.team('2026-11-01', '2026-11-30').entries.length, 2);
  up.close();
  // Opening again is a no-op
  const again = openStore(path, { ownerToken: 'the-old-sync-token-0123456789' });
  assert.equal(again.listUsers().length, 1);
  again.close();
});

test('bad input is rejected', async () => {
  assert.equal((await api('/api/entries', { method: 'POST', body: { nope: 1 } })).status, 400);
  const res = await api('/api/entries', { method: 'POST', body: { entries: [{ id: 'x y', start: 'nope' }] } });
  assert.equal((await res.json()).error, 'bad_entry');
  assert.equal((await api('/api/entries?since=-1')).status, 400);
  assert.equal((await api('/api/nothing')).status, 404);
});

test('cleanEntry keeps known fields only and refuses junk', () => {
  const e = entry('2026-11-16', '08:00', '17:00', { id: 'k', syncedAt: 'x', secret: 'y' });
  assert.deepEqual(Object.keys(cleanEntry(e)).sort(), ['createdAt', 'deleted', 'device', 'edited', 'employee', 'end', 'id', 'job', 'start', 'updatedAt']);
  assert.equal(cleanEntry({ ...e, job: 'x'.repeat(500) }), null);
  assert.equal(cleanEntry({ ...e, updatedAt: 'yesterday' }), null);
  assert.equal(cleanEntry(null), null);
});

test('pages large pulls', async () => {
  const many = Array.from({ length: 1205 }, (_, i) => shift(`p${i}`, '2026-10-01', '08:00', '09:00'));
  await push(OWNER, many);
  const first = await pull(OWNER);
  assert.equal(first.entries.length, 1000);
  assert.equal(first.more, true);
  assert.equal((await pull(OWNER, first.cursor)).more, false);
});

test('backup writes a usable copy', () => {
  const file = join(dir, 'backup.db');
  store.backup(file);
  assert.ok(existsSync(file));
  const copy = openStore(file);
  assert.ok(copy.listUsers().length >= 3);
  copy.close();
});
