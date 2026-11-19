// Things the user does to their own shifts: start, finish, edit, delete, labels, settings, export.
import { putEntry } from './store.js';
import { startTimer, finishTimer, discardTimer } from './timer.js';
import { isoDate, toLocalISO, startOfWeek, durationLabel, entryMinutes } from './format.js';
import { saveSettings } from './settings.js';
import { $, toast, haptic, openExportSheet } from './ui.js';
import { openEditSheet, openLabelsSheet, askKeepOrDiscard } from './sheets.js';
import { getMe, getLockBefore } from './sync.js';
import {
  state, ls, render, deviceName, SHORT_MS, LAST_EXPORT, NEXT_LABELS,
} from './state.js';
import { cancelHold } from './hold.js';
import { scheduleSync } from './syncing.js';

export const replaceEntry = (updated) => {
  state.entries = state.entries.map((e) => (e.id === updated.id ? updated : e));
};

/** Save one of this device's entries and sync it shortly. */
export async function save(updated) {
  await putEntry(updated);
  replaceEntry(updated);
  scheduleSync();
}

export async function onStart() {
  if (state.busy || state.running) return;
  state.busy = true;
  try {
    const labels = state.settings.showLabels ? { ...state.nextLabels } : {};
    if (!labels.employee && getMe()?.name) labels.employee = getMe().name; // staff name on every shift
    const entry = await startTimer(deviceName(), labels);
    state.entries.push(entry);
    state.running = entry;
    state.animateButton = true;
    scheduleSync(0);
    haptic(15);
    render();
    $('#finish')?.focus({ preventScroll: true });
  } catch (err) {
    console.error(err);
    toast('Could not start — storage unavailable');
  } finally {
    state.busy = false;
  }
}

export async function onFinish() {
  if (state.busy || !state.running) return;
  state.busy = true;
  cancelHold(false);
  try {
    const running = state.running;
    const elapsed = Date.now() - Date.parse(running.start);
    if (elapsed < SHORT_MS) {
      const choice = await askKeepOrDiscard(Math.max(0, Math.floor(elapsed / 1000)));
      if (choice === 'cancel') return; // still running
      if (choice === 'discard') {
        replaceEntry(await discardTimer(running));
        state.running = null;
        scheduleSync(0);
        state.animateButton = true;
        haptic(10);
        render();
        toast('Shift discarded');
        return;
      }
    }
    const done = await finishTimer(running);
    replaceEntry(done);
    state.running = null;
    scheduleSync(0);
    state.animateButton = true;
    state.newId = done.id;
    haptic([20, 60, 30]);
    render();
    toast(`Logged · ${durationLabel(entryMinutes(done))}`);
  } catch (err) {
    console.error(err);
    toast('Could not save — try again');
  } finally {
    state.busy = false;
  }
}

export async function deleteShift(id) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return;
  const before = entry;
  try {
    await save({ ...entry, deleted: true, updatedAt: toLocalISO() });
  } catch (err) { console.error(err); toast('Could not delete — try again'); return; }
  haptic(10);
  render();
  toast('Shift deleted', {
    action: 'Undo',
    onAction: async () => {
      await save({ ...before, deleted: false, updatedAt: toLocalISO() });
      state.newId = before.id;
      render();
    },
  });
}

export function editShift(id) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry || !entry.end) return;
  const lock = getLockBefore();
  if (lock && isoDate(new Date(entry.start)) < lock) { toast('This week is locked by the owner'); return; }
  openEditSheet(entry, {
    entries: state.entries,
    onSave: async ({ start, end, job, employee }) => {
      const timesChanged = !!(start || end);
      const updated = {
        ...entry,
        start: start ? toLocalISO(start) : entry.start,
        end: end ? toLocalISO(end) : entry.end,
        job,
        employee,
        edited: entry.edited || timesChanged,
        updatedAt: toLocalISO(),
      };
      try { await save(updated); } catch (err) { console.error(err); toast('Could not save — try again'); return; }
      state.newId = updated.id;
      render();
      toast('Shift updated');
    },
    onDelete: () => deleteShift(id),
  });
}

export function editLabels() {
  openLabelsSheet({
    ...(state.running || state.nextLabels),
    running: !!state.running,
    entries: state.entries,
    onSave: async ({ job, employee }) => {
      state.nextLabels = { job, employee };
      ls.set(NEXT_LABELS, JSON.stringify(state.nextLabels));
      if (state.running) {
        const updated = { ...state.running, job, employee, updatedAt: toLocalISO() };
        try { await save(updated); state.running = updated; } catch (err) { console.error(err); toast('Could not save — try again'); }
      }
      render();
    },
  });
}

export function updateSettings(patch) {
  state.settings = saveSettings({ ...state.settings, ...patch });
  if ('weekStartsOn' in patch) state.team = { ...state.team, weekStart: startOfWeek(state.team.weekStart, state.settings.weekStartsOn), data: null, key: '' };
  render();
}

export function openExport(initialRange) {
  openExportSheet({
    getEntries: () => state.entries,
    initialRange,
    weekStartsOn: state.settings.weekStartsOn,
    rounding: state.settings.rounding,
    onExported: (n, how) => {
      ls.set(LAST_EXPORT, isoDate(new Date()));
      toast(`${how === 'shared' ? 'Shared' : 'Exported'} · ${n} shift${n === 1 ? '' : 's'}`);
    },
  });
}

/** "Another shift is running" → Discard it. */
export function discardOther(id) {
  const e = state.entries.find((x) => x.id === id);
  if (!e) return;
  save({ ...e, end: toLocalISO(), deleted: true, updatedAt: toLocalISO() }).then(() => {
    state.otherRunning = state.otherRunning.filter((x) => x.id !== e.id);
    render();
    toast('Other shift discarded');
  });
}
