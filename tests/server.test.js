import { entry } from './helpers.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, createSyncServer, cleanEntry } from '../server/server.mjs';

const TOKEN = 'test-token-0123456789-abcdefghij';
const ORIGIN = 'https://jayframemedia.github.io';
let dir; let store; let server; let base;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tt-sync-'));
  store = openStore(join(dir, 'sync.db'));
  server = createSyncServer({ store, token: TOKEN, allowedOrigins: [ORIGIN] });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); store.close(); rmSync(dir, { recursive: true, force: true }); });

const api = (path, { method = 'GET', body, token = TOKEN, origin = ORIGIN } = {}) => fetch(base + path, {
  method,
  headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(origin ? { Origin: origin } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  },
  body: body ? JSON.stringify(body) : undefined,
});

test('health needs no key; the API does', async () => {
  assert.equal(await (await api('/health', { token: null })).text(), 'ok');
  assert.equal((await api('/api/ping', { token: null })).status, 401);
  assert.equal((await api('/api/ping', { token: 'wrong-token-wrong-token-wrong' })).status, 401);
  const ok = await api('/api/ping');
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).ok, true);
});

test('CORS allows only the app origin', async () => {
  const pre = await api('/api/entries', { method: 'OPTIONS', token: null });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), ORIGIN);
  assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/);
  const other = await api('/api/ping', { origin: 'https://evil.example' });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
});

test('upsert then pull by cursor; last write wins on updatedAt', async () => {
  const a = entry('2026-11-16', '08:00', '17:00', { id: 'a', updatedAt: '2026-11-16T17:00:00+10:00' });
  const b = entry('2026-11-17', '08:00', null, { id: 'b', updatedAt: '2026-11-17T08:00:00+10:00' });
  let r = await (await api('/api/entries', { method: 'POST', body: { entries: [a, b] } })).json();
  assert.deepEqual([r.ok, r.upserted, r.skipped], [true, 2, 0]);

  let pull = await (await api('/api/entries?since=0')).json();
  assert.deepEqual(pull.entries.map((e) => e.id), ['a', 'b']);
  const cursor = pull.cursor;

  // Older edit is ignored; newer edit wins and shows up after the cursor.
  r = await (await api('/api/entries', { method: 'POST', body: { entries: [{ ...a, job: 'old', updatedAt: '2026-11-16T09:00:00+10:00' }] } })).json();
  assert.deepEqual([r.upserted, r.skipped], [0, 1]);
  r = await (await api('/api/entries', { method: 'POST', body: { entries: [{ ...b, end: '2026-11-17T16:00:00+10:00', updatedAt: '2026-11-17T16:00:00+10:00' }] } })).json();
  assert.equal(r.upserted, 1);

  pull = await (await api(`/api/entries?since=${cursor}`)).json();
  assert.deepEqual(pull.entries.map((e) => [e.id, e.end]), [['b', '2026-11-17T16:00:00+10:00']]);
  assert.equal(pull.more, false);
  assert.equal((await (await api(`/api/entries?since=${pull.cursor}`)).json()).entries.length, 0);
});

test('a slow-clock edit still reaches other devices (cursor, not timestamps)', async () => {
  const c = entry('2026-11-10', '08:00', '17:00', { id: 'c', updatedAt: '2026-11-10T17:00:00+10:00' });
  await api('/api/entries', { method: 'POST', body: { entries: [c] } });
  const { cursor } = await (await api('/api/entries?since=0')).json();
  // A device whose clock is days behind edits a brand-new shift: still pulled after the cursor.
  const d = entry('2026-11-09', '08:00', '12:00', { id: 'd', updatedAt: '2026-11-09T12:00:00+10:00' });
  await api('/api/entries', { method: 'POST', body: { entries: [d] } });
  const pull = await (await api(`/api/entries?since=${cursor}`)).json();
  assert.deepEqual(pull.entries.map((e) => e.id), ['d']);
});

test('soft deletes travel like any other change', async () => {
  const e = entry('2026-11-11', '08:00', '17:00', { id: 'del', updatedAt: '2026-11-11T17:00:00+10:00' });
  await api('/api/entries', { method: 'POST', body: { entries: [e] } });
  await api('/api/entries', { method: 'POST', body: { entries: [{ ...e, deleted: true, updatedAt: '2026-11-11T18:00:00+10:00' }] } });
  const all = (await (await api('/api/entries?since=0')).json()).entries;
  assert.equal(all.find((x) => x.id === 'del').deleted, true);
});

test('bad input is rejected', async () => {
  assert.equal((await api('/api/entries', { method: 'POST', body: { nope: 1 } })).status, 400);
  const res = await api('/api/entries', { method: 'POST', body: { entries: [{ id: 'x y', start: 'nope' }] } });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'bad_entry');
  assert.equal((await api('/api/entries?since=-1')).status, 400);
  assert.equal((await api('/api/nothing')).status, 404);
});

test('cleanEntry keeps known fields only and refuses junk', () => {
  const e = entry('2026-11-16', '08:00', '17:00', { id: 'k', syncedAt: 'x', secret: 'y' });
  const c = cleanEntry(e);
  assert.deepEqual(Object.keys(c).sort(), ['createdAt', 'deleted', 'device', 'edited', 'employee', 'end', 'id', 'job', 'start', 'updatedAt']);
  assert.equal(cleanEntry({ ...e, job: 'x'.repeat(500) }), null);
  assert.equal(cleanEntry({ ...e, updatedAt: 'yesterday' }), null);
  assert.equal(cleanEntry(null), null);
});

test('pages large pulls and refuses short tokens', async () => {
  const many = Array.from({ length: 1205 }, (_, i) => entry('2026-10-01', '08:00', '09:00', { id: `p${i}`, updatedAt: '2026-10-01T09:00:00+10:00' }));
  await api('/api/entries', { method: 'POST', body: { entries: many } });
  const first = await (await api('/api/entries?since=0')).json();
  assert.equal(first.entries.length, 1000);
  assert.equal(first.more, true);
  const second = await (await api(`/api/entries?since=${first.cursor}`)).json();
  assert.equal(second.more, false);
  assert.throws(() => createSyncServer({ store, token: 'short' }), /at least 24/);
});

test('backup writes a copy of the database', () => {
  const file = join(dir, 'backup.db');
  store.backup(file);
  assert.ok(existsSync(file));
  const copy = openStore(file);
  assert.ok(copy.since(0, 5000).entries.length > 1000);
  copy.close();
});
