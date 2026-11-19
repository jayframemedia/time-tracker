import { entry } from './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeServerUrl, toWire, needsPush, mergeDecision, agoLabel,
} from '../js/sync.js';

test('server address is normalised and must be https (except localhost)', () => {
  assert.equal(normalizeServerUrl('time.jayframemedia.com.au'), 'https://time.jayframemedia.com.au');
  assert.equal(normalizeServerUrl(' https://time.jayframemedia.com.au/ '), 'https://time.jayframemedia.com.au');
  assert.equal(normalizeServerUrl('http://time.jayframemedia.com.au'), null);
  assert.equal(normalizeServerUrl('http://localhost:8787'), 'http://localhost:8787');
  assert.equal(normalizeServerUrl('https://user:pw@time.example.com'), null);
  assert.equal(normalizeServerUrl('https://time.example.com/?token=x'), null);
  assert.equal(normalizeServerUrl(''), null);
  assert.equal(normalizeServerUrl('not a url at all'), null);
});

test('local-only fields never go over the wire', () => {
  const e = { ...entry('2026-11-16', '08:00', '17:00'), syncedAt: 'x' };
  assert.equal('syncedAt' in toWire(e), false);
  assert.equal(toWire(e).id, e.id);
});

test('needsPush: anything changed since it was last synced', () => {
  const e = entry('2026-11-16', '08:00', '17:00');
  assert.equal(needsPush(e), true);
  assert.equal(needsPush({ ...e, syncedAt: e.updatedAt }), false);
  assert.equal(needsPush({ ...e, syncedAt: '2026-01-01T00:00:00+10:00' }), true);
});

test('mergeDecision: newest updatedAt wins, offsets respected', () => {
  const base = entry('2026-11-16', '08:00', '17:00', { updatedAt: '2026-11-16T17:00:00+10:00' });
  assert.equal(mergeDecision(undefined, base), 'take');
  assert.equal(mergeDecision(base, { ...base, updatedAt: '2026-11-16T17:00:01+10:00' }), 'take');
  assert.equal(mergeDecision(base, { ...base, updatedAt: '2026-11-16T16:59:59+10:00' }), 'keep');
  assert.equal(mergeDecision(base, { ...base }), 'same');
  // Same instant written with a different offset is still "same"
  assert.equal(mergeDecision(base, { ...base, updatedAt: '2026-11-16T07:00:00Z' }), 'same');
});

test('agoLabel', () => {
  const now = Date.parse('2026-11-19T12:00:00+10:00');
  assert.equal(agoLabel(null, now), 'never');
  assert.equal(agoLabel(now - 10_000, now), 'just now');
  assert.equal(agoLabel(now - 120_000, now), '2 min ago');
  assert.equal(agoLabel(now - 3 * 3600_000, now), '3 h ago');
  assert.equal(agoLabel(Date.parse('2026-11-16T09:00:00+10:00'), now), 'Mon 16 Nov');
});
