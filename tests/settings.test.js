import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, DEFAULTS } from '../js/settings.js';

test('defaults match docs/SPEC.md', () => {
  assert.deepEqual(normalizeSettings(null), { ...DEFAULTS });
  assert.deepEqual(normalizeSettings(undefined), {
    timeFormat: '12', weekStartsOn: 1, rounding: 0, showLabels: false, deviceName: '',
  });
});

test('valid values are kept, invalid ones fall back to defaults', () => {
  assert.deepEqual(
    normalizeSettings({ timeFormat: '24', weekStartsOn: 0, rounding: 15, showLabels: true, deviceName: '  Work Mac  ' }),
    { timeFormat: '24', weekStartsOn: 0, rounding: 15, showLabels: true, deviceName: 'Work Mac' },
  );
  assert.deepEqual(
    normalizeSettings({ timeFormat: 12, weekStartsOn: '0', rounding: '5' }),
    { timeFormat: '12', weekStartsOn: 0, rounding: 5, showLabels: false, deviceName: '' },
  );
  assert.deepEqual(
    normalizeSettings({ timeFormat: '13', weekStartsOn: 3, rounding: 7, showLabels: 'yes', deviceName: 42 }),
    { ...DEFAULTS },
  );
  assert.equal(normalizeSettings({ deviceName: 'x'.repeat(100) }).deviceName.length, 40);
});
