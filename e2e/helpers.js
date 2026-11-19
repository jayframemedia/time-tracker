// Shared helpers for the browser tests.
import { expect } from '@playwright/test';

/** Open the app with empty storage and fail the test on any CSP violation or page error. */
export async function openApp(page) {
  const problems = [];
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  page.on('console', (msg) => { if (/Content Security Policy|Refused to/i.test(msg.text())) problems.push(`csp: ${msg.text()}`); });
  await page.goto('/');
  await expect(page.locator('#start, #finish').first()).toBeVisible();
  return problems;
}

/**
 * Put shifts straight into the app's storage, then reload. Each shift is
 * [daysFromThisWeeksMonday, 'HH:MM', 'HH:MM' | null, extra?]. Returns the stored entries.
 */
export async function seed(page, shifts, { running = null } = {}) {
  const entries = await page.evaluate(async ({ list, run }) => {
    const { putEntry } = await import('/js/store.js');
    const { startOfWeek, addDays, isoDate, toLocalISO } = await import('/js/format.js');
    const monday = startOfWeek(new Date(), 1);
    const at = (d, hm) => `${isoDate(addDays(monday, d))}T${hm}:00${toLocalISO(new Date()).slice(19)}`;
    const out = [];
    for (const [d, s, e, extra] of list) {
      const entry = {
        id: crypto.randomUUID(), start: at(d, s), end: e ? at(d, e) : null, employee: null, job: null,
        device: 'Test', edited: false, deleted: false, createdAt: at(d, s), updatedAt: at(d, e || s), ...(extra || {}),
      };
      await putEntry(entry);
      out.push(entry);
    }
    if (run) {
      const start = toLocalISO(new Date(Date.now() - run * 60_000));
      const entry = { id: crypto.randomUUID(), start, end: null, employee: null, job: null, device: 'Test', edited: false, deleted: false, createdAt: start, updatedAt: start };
      await putEntry(entry);
      localStorage.setItem('tt.running', JSON.stringify({ id: entry.id, start, device: 'Test' }));
      out.push(entry);
    }
    return out;
  }, { list: shifts, run: running });
  await page.reload();
  await expect(page.locator('#start, #finish').first()).toBeVisible();
  return entries;
}

export const isWide = (page) => (page.viewportSize()?.width || 0) >= 900;

/** Show History (tab on iPhone; always visible on Mac). */
export async function showHistory(page) {
  if (!isWide(page)) await page.locator('.tabbar [data-tab="history"]').click();
}

/** Show Settings (tab on iPhone; gear on Mac). */
export async function showSettings(page) {
  if (isWide(page)) await page.locator('#open-settings').click();
  else await page.locator('.tabbar [data-tab="settings"]').click();
}

/** Press and hold FINISH for `ms`. */
export async function holdFinish(page, ms = 1300) {
  const box = await page.locator('#finish').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

/** A shift row: phone list button or Mac table row containing `text`. */
export const shiftRow = (page, text) => page.locator('.swipe .hrow, tr.shift').filter({ hasText: text }).first();
