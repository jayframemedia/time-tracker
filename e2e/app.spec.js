// Core flows on one device, run as iPhone (WebKit) and Mac (Chromium).
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, seed, isWide, showHistory, showSettings, holdFinish, shiftRow } from './helpers.js';

let problems;
test.beforeEach(async ({ page }) => { problems = await openApp(page); });
test.afterEach(() => { expect(problems, 'no page errors or CSP violations').toEqual([]); });

test('start, survive a reload (force-quit), hold to finish', async ({ page }) => {
  await seed(page, [], { running: 125 }); // started 2 h 05 min ago
  await expect(page.locator('#counter')).toHaveText(/^02:0[4-6]:\d\d$/);
  await expect(page.locator('.subline')).toContainText('Started');
  await page.reload(); // like reopening after a force-quit
  await expect(page.locator('#counter')).toHaveText(/^02:0[4-6]:\d\d$/);

  // Releasing early cancels
  const box = await page.locator('#finish').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(300);
  await page.mouse.up();
  await expect(page.locator('#finish')).toBeVisible();

  await holdFinish(page);
  // Whole clock minutes, so it can read one minute either side.
  await expect(page.locator('#toast')).toContainText(/Logged · 2h 0[4-6]m/);
  await expect(page.locator('#start')).toBeVisible();
});

test('a shift under a minute asks Keep or discard', async ({ page }) => {
  await page.locator('#start').click();
  await expect(page.locator('#finish')).toBeVisible();
  await holdFinish(page);
  await expect(page.locator('#short-sheet')).toBeVisible();
  await page.locator('#short-sheet [data-choice="discard"]').click();
  await expect(page.locator('#toast')).toContainText('Shift discarded');
  await showHistory(page);
  await expect(page.locator('.swipe, tr.shift')).toHaveCount(0);
});

test('history groups by week with day and week totals', async ({ page }) => {
  await seed(page, [[0, '08:00', '12:30'], [0, '13:15', '17:45'], [1, '08:00', '17:00'], [-3, '08:00', '15:30']]);
  await showHistory(page);
  if (isWide(page)) {
    await page.locator('[data-filter="all"]').click();
    await expect(page.locator('tr.wk').first()).toContainText('18.00 h');
    await expect(page.locator('tr.day-total')).toContainText('9.00');
  } else {
    await expect(page.locator('.week-total').first()).toHaveText('18.00 h');
    await expect(page.locator('.day-total')).toContainText('9.00 h');
    await expect(page.locator('.week-total').nth(1)).toHaveText('7.50 h');
  }
});

test('edit a shift: validation, save, totals update', async ({ page }) => {
  await seed(page, [[1, '08:00', '17:00']]);
  await showHistory(page);
  await shiftRow(page, '8:00 am').click();
  const sheet = page.locator('#edit-sheet');
  await expect(sheet).toBeVisible();
  const endValue = await sheet.locator('input[name="end"]').inputValue();
  await sheet.locator('input[name="end"]').fill(endValue.replace('T17:00', 'T07:00'));
  await expect(sheet.locator('#edit-error')).toHaveText('Clock out must be after clock in.');
  await sheet.locator('input[name="end"]').fill(endValue.replace('T17:00', 'T15:30'));
  await sheet.locator('input[name="job"]').fill('Site A');
  await sheet.locator('#edit-save').click();
  await expect(page.locator('#toast')).toContainText('Shift updated');
  await expect(shiftRow(page, '3:30 pm')).toContainText('7.50');
  const stored = await page.evaluate(async () => (await (await import('/js/store.js')).getAllEntries())[0]);
  expect(stored.edited).toBe(true);
  expect(stored.job).toBe('Site A');
});

test('delete with Undo', async ({ page }) => {
  await seed(page, [[1, '08:00', '17:00'], [2, '09:00', '17:00']]);
  await showHistory(page);
  const row = shiftRow(page, '9:00 am');
  if (isWide(page)) {
    await row.hover();
    await row.locator('.row-del').click();
  } else {
    // Swipe left (touch)
    await row.evaluate(async (el) => {
      const r = el.getBoundingClientRect();
      const ev = (type, x) => new PointerEvent(type, { bubbles: true, pointerType: 'touch', isPrimary: true, clientX: x, clientY: r.top + 20 });
      el.dispatchEvent(ev('pointerdown', r.right - 20));
      for (let x = r.right - 30; x > r.right - 160; x -= 15) { el.dispatchEvent(ev('pointermove', x)); await new Promise((f) => setTimeout(f, 16)); }
      el.dispatchEvent(ev('pointerup', r.right - 160));
    });
    await page.locator('.swipe.is-open .swipe-del').click();
  }
  await expect(page.locator('#toast')).toContainText('Shift deleted');
  await expect(shiftRow(page, '9:00 am')).toHaveCount(0);
  await page.locator('.toast-action').click();
  await expect(shiftRow(page, '9:00 am')).toBeVisible();
});

test('CSV export downloads the exact format', async ({ page }) => {
  await seed(page, [[1, '08:00', '17:00', { job: '=1+1', employee: 'Sam, J' }]]);
  await page.evaluate(() => Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }));
  await showHistory(page);
  await page.locator('#export').click();
  await page.locator('#export-sheet [data-range="this-week"]').click();
  await expect(page.locator('#csv-summary')).toHaveText('1 shift · 9.00 h');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#csv-go').click()]);
  expect(download.suggestedFilename()).toMatch(/^timesheet_\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}\.csv$/);
  const bytes = readFileSync(await download.path());
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM
  const lines = bytes.toString('utf8').slice(1).split('\r\n');
  expect(lines[0]).toBe('Date,Day,Clock in,Clock out,Total hours,Employee,Job,ID');
  expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2},Tuesday,08:00,17:00,9\.00,"Sam, J",'=1\+1,[0-9a-f-]{36}$/);
});

test('settings change the display', async ({ page }) => {
  await seed(page, [[1, '08:07', '16:53']]);
  await showSettings(page);
  await page.locator('[data-set="timeFormat"][data-value="24"]').click();
  await page.locator('[data-set="rounding"][data-value="15"]').click();
  if (isWide(page)) await page.locator('#close-settings').click();
  await showHistory(page);
  await expect(shiftRow(page, '08:00')).toContainText('17:00');
  await expect(shiftRow(page, '08:00')).toContainText('9.00');
});

test('Mac layout vs iPhone layout', async ({ page }) => {
  if (isWide(page)) {
    await expect(page.locator('.split .left #start')).toBeVisible();
    await expect(page.locator('.split .right h1')).toHaveText('History');
    await expect(page.locator('.tabbar')).toBeHidden();
  } else {
    await expect(page.locator('.tabbar')).toBeVisible();
    await expect(page.locator('.tabbar [data-tab="team"]')).toBeHidden(); // owners only
  }
});

test('works offline after the first load', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Service worker offline check runs in Chromium');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); // now served by the service worker
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#start')).toBeVisible();
  await page.locator('#start').click();
  await expect(page.locator('#finish')).toBeVisible();
  await context.setOffline(false);
});
