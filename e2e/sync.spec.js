// Owner + staff on two separate devices (browser contexts) syncing through a real sync server.
// Runs once, in the Mac project (see playwright.config.js). The server listens on localhost:8787, which the app's CSP allows for testing.
import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, createSyncServer } from '../server/server.mjs';
import { openApp, seed, showHistory, shiftRow } from './helpers.js';

const OWNER_KEY = 'e2e-owner-key-0123456789-abcdefghij';
let dir; let store; let server; let staffKey;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tt-e2e-'));
  store = openStore(join(dir, 'sync.db'), { ownerToken: OWNER_KEY, ownerName: 'Jason' });
  staffKey = store.addUser('Sam Test');
  server = createSyncServer({ store, allowedOrigins: ['http://localhost:4173'] });
  await new Promise((resolve) => server.listen(8787, '127.0.0.1', resolve));
});
test.afterAll(async () => {
  server?.closeAllConnections();
  await new Promise((resolve) => server?.close(resolve));
  store?.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Connect through Settings → Sync between devices, like a person would. */
async function connect(page, key, wide) {
  if (wide) await page.locator('#open-settings').click();
  else await page.locator('.tabbar [data-tab="settings"]').click();
  await page.locator('#open-sync').click();
  await page.locator('#sync-sheet input[name="url"]').fill('http://localhost:8787');
  await page.locator('#sync-sheet input[name="token"]').fill(key);
  await page.locator('#sync-connect').click();
  await expect(page.locator('#toast')).toContainText('Sync is on');
}

test('staff sync, owner sees and corrects them, week lock reaches the staff phone', async ({ browser }) => {
  // Sam on an iPhone-sized screen
  const samCtx = await browser.newContext({ viewport: { width: 402, height: 874 }, timezoneId: 'Australia/Brisbane', locale: 'en-AU', hasTouch: true });
  const sam = await samCtx.newPage();
  await openApp(sam);
  await seed(sam, [[-7, '08:00', '16:00'], [0, '07:30', '15:30'], [1, '08:00', '12:00']]);
  await connect(sam, staffKey, false);
  await expect(sam.locator('.tabbar [data-tab="team"]')).toBeHidden();
  await expect(sam.locator('.settings')).toContainText('Syncing as Sam Test');

  // Jason on a Mac-sized screen
  const jasonCtx = await browser.newContext({ viewport: { width: 1180, height: 760 }, timezoneId: 'Australia/Brisbane', locale: 'en-AU' });
  const jason = await jasonCtx.newPage();
  await openApp(jason);
  await connect(jason, OWNER_KEY, true);
  await jason.locator('#close-settings').click();
  await jason.locator('#open-team').click();
  const samRow = jason.locator('.team-table tbody tr').filter({ hasText: 'Sam Test' });
  await expect(samRow.locator('.tot')).toHaveText('12.00'); // this week: 8 + 4
  await expect(jason.locator('.team-table')).not.toContainText('16.00');

  // Jason corrects Sam's Tuesday: 12:00 → 13:00
  await samRow.click();
  await jason.locator('[data-team-edit]').filter({ hasText: '12:00 pm' }).click();
  const end = jason.locator('#edit-sheet input[name="end"]');
  await end.fill((await end.inputValue()).replace('T12:00', 'T13:00'));
  await jason.locator('#edit-save').click();
  await expect(jason.locator('#toast')).toContainText('sees it next sync');
  await expect(jason.locator('[data-team-edit]').filter({ hasText: '1:00 pm' })).toContainText('Changed');

  // Jason locks everything before this week
  await jason.locator('[data-person-back]').click();
  await jason.locator('#team-lock').click();
  await jason.locator('#lock-sheet .primary').click();
  await expect(jason.locator('.lockline')).toContainText('Staff can’t change shifts before');

  // Sam's phone picks up the correction and the lock on its next sync
  await sam.reload();
  await expect(sam.locator('#start')).toBeVisible();
  await expect.poll(async () => sam.evaluate(() => localStorage.getItem('tt.sync.lock')), { timeout: 10_000 }).not.toBeNull();
  await sam.reload();
  await showHistory(sam);
  await expect(shiftRow(sam, '1:00 pm')).toBeVisible();
  const lastWeek = sam.locator('.swipe.locked');
  await expect(lastWeek).toHaveCount(1);
  await lastWeek.locator('.hrow').click();
  await expect(sam.locator('#toast')).toContainText('locked by the owner');
  await expect(sam.locator('#edit-sheet')).toHaveCount(0);

  await samCtx.close();
  await jasonCtx.close();
});
