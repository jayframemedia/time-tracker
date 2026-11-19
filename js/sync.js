// Cross-device sync with the Time Tracker sync server (server/server.mjs).
// Push: every entry whose `syncedAt` (local only) differs from its `updatedAt`.
// Pull: everything after the server cursor we last saw. Newest `updatedAt` wins.
// Offline or unreachable: nothing is lost — changes stay marked unsynced and go next time.
import { getAllEntries, putEntry } from './store.js';

const CONFIG = 'tt.sync';
const CURSOR = 'tt.sync.cursor';
const STATUS = 'tt.sync.status';
const ME = 'tt.sync.me'; // { name, role } from the server
const LOCK = 'tt.sync.lock'; // staff can't change shifts before this date (YYYY-MM-DD)
const TIMEOUT_MS = 15_000;
const BATCH = 500;

// ---------- Pure helpers (tested) ----------

/**
 * "time.example.com" → "https://time.example.com". Plain http is allowed only for
 * localhost (testing). Returns null if it isn't a usable address.
 */
export function normalizeServerUrl(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^[a-z]+:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch { return null; }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null;
  if (u.username || u.password || u.search || u.hash) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

/** What goes over the wire: the entry without local-only fields. */
export function toWire(entry) {
  const { syncedAt, ...rest } = entry;
  return rest;
}

export const needsPush = (entry) => entry.syncedAt !== entry.updatedAt;

/** 'take' the remote copy, 'keep' the local one, or 'same' (already in step). */
export function mergeDecision(local, remote) {
  if (!local) return 'take';
  const l = Date.parse(local.updatedAt);
  const r = Date.parse(remote.updatedAt);
  if (r > l) return 'take';
  if (r < l) return 'keep';
  return 'same';
}

/** "just now", "2 min ago", "3 h ago", "Mon 16 Nov". */
export function agoLabel(ms, now = Date.now()) {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = new Date(ms);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`;
}

// ---------- Config and status (localStorage) ----------

const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

export function getSyncConfig() {
  const c = read(CONFIG);
  return c && c.url && c.token ? c : null;
}

export function getSyncStatus() {
  return { lastSyncedAt: null, lastError: null, ...(read(STATUS) || {}), syncing: !!inflight };
}

const setStatus = (patch) => write(STATUS, { ...(read(STATUS) || {}), ...patch });

/** Who this device syncs as: { name, role: 'owner' | 'staff' }, or null when sync is off. */
export const getMe = () => (getSyncConfig() ? read(ME) : null);
export const isOwner = () => getMe()?.role === 'owner';
/** Staff only: shifts that start before this date are locked. */
export const getLockBefore = () => (getMe()?.role === 'staff' ? read(LOCK) : null);

/** Remember who we are and the lock date from any server reply; true if either changed. */
function remember(reply) {
  let changed = false;
  if (reply?.user) {
    const prev = read(ME);
    if (prev?.name !== reply.user.name || prev?.role !== reply.user.role) { write(ME, reply.user); changed = true; }
  }
  if (reply && 'lockBefore' in reply && read(LOCK) !== (reply.lockBefore || null)) { write(LOCK, reply.lockBefore || null); changed = true; }
  return changed;
}

// ---------- Network ----------

async function api(config, method, path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(config.url + path, {
      method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        'X-Client-Time': String(Date.now()), // lets the server flag a phone whose clock is wrong
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      cache: 'no-store',
    });
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? 'The server took too long to answer' : 'Can’t reach the server', { cause: err });
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (res.status === 401) throw new Error('The sync key is wrong');
  if (res.status === 403) throw new Error('Only the owner can do this');
  if (!res.ok || !data?.ok) throw new Error(`Server error (${data?.error || res.status})`);
  return data;
}

/** Check an address + key before saving them. Throws with a readable message. */
export async function testConnection(url, token) {
  const normal = normalizeServerUrl(url);
  if (!normal) throw new Error('Enter the server address, e.g. https://time.example.com');
  if (!token || token.trim().length < 24) throw new Error('The sync key looks too short');
  const reply = await api({ url: normal, token: token.trim() }, 'GET', '/api/ping');
  return { url: normal, token: token.trim(), user: reply.user, lockBefore: reply.lockBefore };
}

/** Save a tested config. Everything local is re-sent and everything remote re-read. */
export async function connectSync({ url, token, user, lockBefore }) {
  write(CONFIG, { url, token });
  write(ME, user || null);
  write(LOCK, lockBefore || null);
  write(CURSOR, 0);
  setStatus({ lastError: null });
  for (const e of await getAllEntries()) {
    if (e.syncedAt) await putEntry({ ...e, syncedAt: null });
  }
}

export function disconnectSync() {
  write(CONFIG, null);
  write(ME, null);
  write(LOCK, null);
  write(CURSOR, null);
  write(STATUS, null);
}

// ---------- Sync ----------

let inflight = null;

/**
 * Push local changes, then pull remote ones. Resolves to { pushed, pulled } or { skipped } and
 * never rejects (errors go into the status). onChange() runs if anything local changed.
 */
export function syncNow({ onChange } = {}) {
  if (inflight) return inflight;
  inflight = run(onChange).finally(() => { inflight = null; });
  return inflight;
}

async function run(onChange) {
  const config = getSyncConfig();
  if (!config) return { skipped: 'off' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setStatus({ lastError: 'Offline — will sync when you’re back online' });
    return { skipped: 'offline' };
  }
  try {
    // Push
    let pulled = 0;
    let changed = false;
    const dirty = (await getAllEntries()).filter(needsPush);
    const rejected = new Set();
    for (let i = 0; i < dirty.length; i += BATCH) {
      const reply = await api(config, 'POST', '/api/entries', { entries: dirty.slice(i, i + BATCH).map(toWire) });
      changed = remember(reply) || changed;
      for (const id of reply.rejected || []) rejected.add(id);
      // Refused (e.g. a locked week): take the server's copy back so this device matches.
      for (const r of reply.restore || []) { await putEntry({ ...r, syncedAt: r.updatedAt }); pulled += 1; }
    }
    if (dirty.length) {
      const now = new Map((await getAllEntries()).map((e) => [e.id, e]));
      for (const sent of dirty) {
        const cur = now.get(sent.id);
        if (rejected.has(sent.id)) {
          if (cur && cur.syncedAt !== cur.updatedAt) await putEntry({ ...cur, syncedAt: cur.updatedAt }); // don't retry forever
        } else if (cur && cur.updatedAt === sent.updatedAt) {
          await putEntry({ ...cur, syncedAt: cur.updatedAt });
        }
      }
    }

    // Pull
    let cursor = Number(read(CURSOR)) || 0;
    let more = true;
    while (more) {
      const page = await api(config, 'GET', `/api/entries?since=${cursor}`);
      changed = remember(page) || changed;
      const local = new Map((await getAllEntries()).map((e) => [e.id, e]));
      for (const remote of page.entries) {
        const mine = local.get(remote.id);
        const decision = mergeDecision(mine, remote);
        if (decision === 'take') {
          await putEntry({ ...remote, syncedAt: remote.updatedAt });
          pulled += 1;
        } else if (decision === 'same' && mine.syncedAt !== mine.updatedAt) {
          await putEntry({ ...mine, syncedAt: mine.updatedAt });
        }
      }
      cursor = page.cursor;
      write(CURSOR, cursor);
      more = page.more;
    }

    setStatus({ lastSyncedAt: Date.now(), lastError: null });
    if (pulled || changed) await onChange?.();
    return { pushed: dirty.length, pulled, rejected: rejected.size };
  } catch (err) {
    setStatus({ lastError: err.message || 'Sync failed' });
    return { error: err.message };
  }
}

// ---------- Owner: Team view (always live; other people's shifts aren't stored on this device) ----------

/** Everyone's shifts starting in [from, to] (YYYY-MM-DD), users, who's clocked in, lock date. */
export async function teamFetch(from, to) {
  const config = getSyncConfig();
  if (!config) throw new Error('Sync is off');
  const reply = await api(config, 'GET', `/api/team/entries?from=${from}&to=${to}`);
  remember(reply);
  return reply;
}

/** Save corrections to existing shifts (anyone's). */
export async function teamSave(entries) {
  const config = getSyncConfig();
  const reply = await api(config, 'POST', '/api/team/entries', { entries: entries.map(toWire) });
  if (reply.rejected?.length) throw new Error('The server refused that change');
  return reply;
}

/** Lock staff edits to shifts before `before` (YYYY-MM-DD), or null to unlock. */
export async function teamLock(before) {
  const config = getSyncConfig();
  return (await api(config, 'POST', '/api/team/lock', { before })).lockBefore;
}
