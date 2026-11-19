// Running timer. Only the start timestamp is stored; the display is always now − start.
// The open entry lives in IndexedDB (end: null) and its id + start are mirrored in
// localStorage so a running shift survives force-quit, sleep and reboot.
import { putEntry } from './store.js';
import { toLocalISO } from './format.js';

const KEY = 'tt.running';

function readMirror() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    return v && v.id && v.start ? v : null;
  } catch { return null; }
}
function writeMirror(v) {
  try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch { /* private mode */ }
}

export function detectDevice() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent) && matchMedia('(pointer: coarse)').matches)
    ? 'iPhone' : 'Mac';
}

/**
 * Reconcile localStorage and IndexedDB on launch and return the open entry (or null).
 * Mutates `entries` if an open entry has to be recreated from the mirror.
 */
export async function restoreRunning(entries) {
  const open = entries
    .filter((e) => !e.end && !e.deleted)
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  const mirror = readMirror();

  if (mirror) {
    const match = open.find((e) => e.id === mirror.id);
    if (match) return match;
    // The DB write was lost (e.g. quit mid-save) — recreate the entry from the mirror.
    const existing = entries.find((e) => e.id === mirror.id);
    if (existing) { writeMirror(null); return open[0] || null; } // already finished or deleted
    const now = toLocalISO();
    const rebuilt = {
      id: mirror.id, start: mirror.start, end: null, employee: null, job: null,
      device: mirror.device || detectDevice(), edited: false, deleted: false, createdAt: now, updatedAt: now,
    };
    await putEntry(rebuilt);
    entries.push(rebuilt);
    return rebuilt;
  }
  if (open[0]) {
    writeMirror({ id: open[0].id, start: open[0].start, device: open[0].device });
    return open[0];
  }
  return null;
}

export async function startTimer(device, { job = null, employee = null } = {}) {
  const now = toLocalISO();
  const entry = {
    id: crypto.randomUUID(), start: now, end: null, employee: employee || null, job: job || null,
    device, edited: false, deleted: false, createdAt: now, updatedAt: now,
  };
  writeMirror({ id: entry.id, start: entry.start, device }); // synchronous, so it's durable first
  await putEntry(entry);
  return entry;
}

export async function finishTimer(entry) {
  const now = toLocalISO();
  const done = { ...entry, end: now, updatedAt: now };
  await putEntry(done);
  writeMirror(null);
  return done;
}

/** Throw away a running shift (e.g. under a minute). Soft delete, so sync can see it. */
export async function discardTimer(entry) {
  const now = toLocalISO();
  const gone = { ...entry, end: now, deleted: true, updatedAt: now };
  await putEntry(gone);
  writeMirror(null);
  return gone;
}
