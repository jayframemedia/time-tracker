// Storage for the sync server: users (owner/staff) with personal keys, shifts tied to a user,
// every version of every shift, and the week lock. Built-in node:sqlite, no dependencies.
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';

export const hashKey = (key) => createHash('sha256').update(String(key)).digest('hex');
export const newKey = () => randomBytes(32).toString('base64url'); // 43 characters
const nowIso = () => new Date().toISOString();
const dateOf = (iso) => String(iso).slice(0, 10); // local date as written by the device

// ---------- Validation (pure) ----------

const isIso = (v) => typeof v === 'string' && v.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));
const optText = (v, max = 200) => v === null || v === undefined || (typeof v === 'string' && v.length <= max);

/** Returns a clean entry with only known fields, or null if it isn't valid. */
export function cleanEntry(e) {
  if (!e || typeof e !== 'object') return null;
  if (typeof e.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(e.id)) return null;
  if (!isIso(e.start) || !(e.end === null || e.end === undefined || isIso(e.end))) return null;
  if (!isIso(e.updatedAt) || !(e.createdAt === undefined || isIso(e.createdAt))) return null;
  if (!optText(e.job) || !optText(e.employee) || !optText(e.device, 80)) return null;
  return {
    id: e.id,
    start: e.start,
    end: e.end ?? null,
    employee: e.employee ?? null,
    job: e.job ?? null,
    device: e.device ?? null,
    edited: e.edited === true,
    deleted: e.deleted === true,
    createdAt: e.createdAt ?? e.updatedAt,
    updatedAt: e.updatedAt,
  };
}

export const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// ---------- Schema + migrations ----------

function migrate(db, { ownerToken, ownerName }) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_ms INTEGER NOT NULL, seq INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS entries_seq ON entries (seq);
      PRAGMA user_version = 1;`);
  }
  if (version < 2) {
    // v2: users + per-user shifts, edit history, settings (week lock). Existing shifts go to the owner.
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          role TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
          key_hash TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          revoked_at TEXT,
          last_seen_at TEXT);
        ALTER TABLE entries ADD COLUMN user_id INTEGER REFERENCES users (id);
        ALTER TABLE entries ADD COLUMN start_date TEXT;
        ALTER TABLE entries ADD COLUMN clock_skew_ms INTEGER;
        CREATE INDEX entries_user_seq ON entries (user_id, seq);
        CREATE INDEX entries_start_date ON entries (start_date);
        CREATE TABLE versions (
          vid INTEGER PRIMARY KEY,
          entry_id TEXT NOT NULL,
          data TEXT NOT NULL,
          by_user INTEGER,
          received_at TEXT NOT NULL,
          skew_ms INTEGER);
        CREATE INDEX versions_entry ON versions (entry_id, vid);
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);`);
      const existing = db.prepare('SELECT COUNT(*) AS n FROM entries').get().n;
      if (existing && !ownerToken) throw new Error('SYNC_TOKEN is needed once to upgrade the database (it becomes the owner key)');
      if (ownerToken) {
        const { lastInsertRowid: owner } = db.prepare(
          'INSERT INTO users (name, role, key_hash, created_at) VALUES (?, \'owner\', ?, ?)',
        ).run(ownerName, hashKey(ownerToken), nowIso());
        db.prepare(`UPDATE entries SET user_id = ?, start_date = substr(json_extract(data, '$.start'), 1, 10)`).run(owner);
        db.prepare('INSERT INTO versions (entry_id, data, by_user, received_at) SELECT id, data, ?, ? FROM entries').run(owner, nowIso());
      }
      db.exec('PRAGMA user_version = 2');
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  // A brand-new database: the first SYNC_TOKEN becomes the owner key.
  const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (!users && ownerToken) {
    db.prepare('INSERT INTO users (name, role, key_hash, created_at) VALUES (?, \'owner\', ?, ?)').run(ownerName, hashKey(ownerToken), nowIso());
  }
}

// ---------- Store ----------

export function openStore(dbPath, { ownerToken = null, ownerName = 'Owner' } = {}) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  migrate(db, { ownerToken, ownerName });

  const q = {
    userByHash: db.prepare('SELECT id, name, role FROM users WHERE key_hash = ? AND revoked_at IS NULL'),
    seen: db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?'),
    entry: db.prepare('SELECT user_id, updated_ms, data, clock_skew_ms FROM entries WHERE id = ?'),
    maxSeq: db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM entries'),
    write: db.prepare(`INSERT INTO entries (id, data, updated_ms, seq, user_id, start_date, clock_skew_ms) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_ms = excluded.updated_ms, seq = excluded.seq,
        start_date = excluded.start_date, clock_skew_ms = excluded.clock_skew_ms`),
    version: db.prepare('INSERT INTO versions (entry_id, data, by_user, received_at, skew_ms) VALUES (?, ?, ?, ?, ?)'),
    page: db.prepare('SELECT data, seq FROM entries WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?'),
    range: db.prepare('SELECT data, user_id, clock_skew_ms FROM entries WHERE start_date BETWEEN ? AND ? ORDER BY start_date, id'),
    open: db.prepare(`SELECT data, user_id FROM entries
      WHERE json_extract(data, '$.end') IS NULL AND json_extract(data, '$.deleted') = 0`),
    firstVersion: db.prepare('SELECT data FROM versions WHERE entry_id = ? ORDER BY vid LIMIT 1'),
    versionCount: db.prepare('SELECT COUNT(*) AS n FROM versions WHERE entry_id = ?'),
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'),
    users: db.prepare(`SELECT u.id, u.name, u.role, u.created_at, u.revoked_at, u.last_seen_at,
      (SELECT COUNT(*) FROM entries e WHERE e.user_id = u.id AND json_extract(e.data, '$.deleted') = 0) AS shifts
      FROM users u ORDER BY u.role = 'owner' DESC, u.name`),
    userByName: db.prepare('SELECT id, name, role, revoked_at FROM users WHERE name = ?'),
  };

  const getLock = () => q.getSetting.get('lock_before')?.value || null;

  /**
   * Last write wins on updatedAt. `user` is who is writing; `asOwner` lets the owner correct
   * anyone's shift (Team view). Staff can only touch their own shifts and nothing before the lock.
   * Returns { upserted, skipped, rejected: [ids], restore: [entries the device should take back] }.
   */
  function upsert(user, entries, { skewMs = null, asOwner = false } = {}) {
    const lock = getLock();
    const out = { upserted: 0, skipped: 0, rejected: [], restore: [] };
    const now = nowIso();
    db.exec('BEGIN IMMEDIATE');
    try {
      let seq = q.maxSeq.get().s;
      for (const e of entries) {
        const ex = q.entry.get(e.id);
        const prev = ex ? JSON.parse(ex.data) : null;
        if (ex && ex.user_id !== user.id && !(asOwner && user.role === 'owner')) {
          out.rejected.push(e.id); // someone else's shift
          continue;
        }
        if (!ex && asOwner) { out.rejected.push(e.id); continue; } // Team view edits existing shifts only
        if (user.role === 'staff' && lock && (dateOf(e.start) < lock || (prev && dateOf(prev.start) < lock))) {
          out.rejected.push(e.id);
          // Hand the device back the server's copy (or a hidden tombstone for a shift it can't create).
          out.restore.push(prev || { ...e, deleted: true });
          continue;
        }
        const ms = Date.parse(e.updatedAt);
        if (ex && ex.updated_ms >= ms) { out.skipped += 1; continue; }
        // Remember the largest phone-clock error seen when the shift was started or finished.
        let skew = ex ? ex.clock_skew_ms : null;
        const startingOrFinishing = !ex || (!prev.end && e.end);
        if (!asOwner && skewMs !== null && startingOrFinishing && Math.abs(skewMs) > Math.abs(skew ?? 0)) skew = skewMs;
        seq += 1;
        const json = JSON.stringify(e);
        q.write.run(e.id, json, ms, seq, ex ? ex.user_id : user.id, dateOf(e.start), skew);
        q.version.run(e.id, json, user.id, now, asOwner ? null : skewMs);
        out.upserted += 1;
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return out;
  }

  return {
    /** The active user for a key, or null. */
    authenticate(key) {
      if (!key) return null;
      const user = q.userByHash.get(hashKey(key));
      if (user) q.seen.run(nowIso(), user.id);
      return user || null;
    },
    upsert,
    /** A user's own shifts changed after `cursor` (server sequence number). */
    since(user, cursor, limit = 1000) {
      const rows = q.page.all(user.id, cursor, limit + 1);
      const more = rows.length > limit;
      const list = rows.slice(0, limit);
      return { entries: list.map((r) => JSON.parse(r.data)), cursor: list.length ? list[list.length - 1].seq : cursor, more };
    },
    /** Owner view: everyone's shifts that start in [from, to], who's clocked in, and all users. */
    team(from, to) {
      const users = q.users.all().map((u) => ({
        id: u.id, name: u.name, role: u.role, revoked: !!u.revoked_at, lastSeenAt: u.last_seen_at, shifts: u.shifts,
      }));
      const entries = q.range.all(from, to).map((r) => {
        const e = JSON.parse(r.data);
        const versions = q.versionCount.get(e.id).n;
        let original = null;
        if (versions > 1) {
          const first = JSON.parse(q.firstVersion.get(e.id).data);
          if (first.start !== e.start || first.end !== e.end) original = { start: first.start, end: first.end };
        }
        return { ...e, userId: r.user_id, clockSkewMs: r.clock_skew_ms, original };
      });
      const running = q.open.all().map((r) => ({ ...JSON.parse(r.data), userId: r.user_id }));
      return { users, entries, running, lockBefore: getLock() };
    },
    getLock,
    setLock(before) { q.setSetting.run('lock_before', before || null); return getLock(); },

    // ---------- Admin (server/admin.mjs) ----------
    listUsers: () => q.users.all(),
    addUser(name, role = 'staff') {
      const key = newKey();
      db.prepare('INSERT INTO users (name, role, key_hash, created_at) VALUES (?, ?, ?, ?)').run(name, role, hashKey(key), nowIso());
      return key;
    },
    newUserKey(name) {
      const u = q.userByName.get(name);
      if (!u) throw new Error(`No one called "${name}"`);
      const key = newKey();
      db.prepare('UPDATE users SET key_hash = ?, revoked_at = NULL WHERE id = ?').run(hashKey(key), u.id);
      return key;
    },
    revokeUser(name) {
      const u = q.userByName.get(name);
      if (!u) throw new Error(`No one called "${name}"`);
      if (u.role === 'owner') throw new Error('The owner can’t be revoked (use new-key to replace a lost owner key)');
      db.prepare('UPDATE users SET revoked_at = ? WHERE id = ?').run(nowIso(), u.id);
    },
    /**
     * Permanently remove a former staff member's shifts (and their edit history) that start
     * before `before` (YYYY-MM-DD), or all of them if `before` is null. Only for revoked staff.
     * With dryRun, nothing changes and the count is returned.
     */
    purgeUser(name, { before = null, dryRun = true } = {}) {
      const u = q.userByName.get(name);
      if (!u) throw new Error(`No one called "${name}"`);
      if (u.role === 'owner') throw new Error('The owner’s records can’t be purged');
      if (!u.revoked_at) throw new Error(`${u.name} can still sync. Revoke them first: node admin.mjs revoke "${u.name}"`);
      if (before !== null && !isDate(before)) throw new Error('Use a date like 2019-07-01 for --before');
      const where = before === null ? 'user_id = ?' : 'user_id = ? AND start_date < ?';
      const args = before === null ? [u.id] : [u.id, before];
      const ids = db.prepare(`SELECT id FROM entries WHERE ${where}`).all(...args).map((r) => r.id);
      if (!dryRun && ids.length) {
        db.exec('BEGIN IMMEDIATE');
        try {
          const delVersions = db.prepare('DELETE FROM versions WHERE entry_id = ?');
          for (const id of ids) delVersions.run(id);
          db.prepare(`DELETE FROM entries WHERE ${where}`).run(...args);
          db.exec('COMMIT');
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
      }
      return { name: u.name, shifts: ids.length, before, done: !dryRun };
    },
    renameUser(from, to) {
      const u = q.userByName.get(from);
      if (!u) throw new Error(`No one called "${from}"`);
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(to, u.id);
    },

    backup(path) { db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`); },
    close() { db.close(); },
  };
}
