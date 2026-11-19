// Time Tracker sync server. Node 24+, no dependencies (uses the built-in node:sqlite).
//
//   GET  /health                      → "ok" (no auth; for Docker health checks)
//   GET  /api/ping                    → { ok: true } (checks the key)
//   POST /api/entries  { entries }    → { ok, upserted, skipped, serverTime }
//   GET  /api/entries?since=<cursor>  → { ok, entries, cursor, more, serverTime }
//
// Every /api request needs "Authorization: Bearer <SYNC_TOKEN>".
// Conflicts: last write wins on `updatedAt`. Each accepted write gets a new server sequence
// number, and clients pull "everything after the last sequence I saw", so a device with a
// slow clock can never cause another device to miss a change.
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const MAX_BODY = 2 * 1024 * 1024;
const MAX_BATCH = 5000;
const PAGE = 1000;

// ---------- Validation (pure) ----------

const isIso = (v) => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
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

// ---------- Storage ----------

export function openStore(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_ms INTEGER NOT NULL,
      seq INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS entries_seq ON entries (seq);
  `);
  const getOne = db.prepare('SELECT updated_ms FROM entries WHERE id = ?');
  const maxSeq = db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM entries');
  const write = db.prepare(`INSERT INTO entries (id, data, updated_ms, seq) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_ms = excluded.updated_ms, seq = excluded.seq`);
  const page = db.prepare('SELECT data, seq FROM entries WHERE seq > ? ORDER BY seq LIMIT ?');

  return {
    /** Last write wins: replace only if the incoming updatedAt is newer (ties keep the stored copy). */
    upsert(entries) {
      let upserted = 0;
      let skipped = 0;
      db.exec('BEGIN IMMEDIATE');
      try {
        let seq = maxSeq.get().s;
        for (const e of entries) {
          const ms = Date.parse(e.updatedAt);
          const existing = getOne.get(e.id);
          if (existing && existing.updated_ms >= ms) { skipped += 1; continue; }
          seq += 1;
          write.run(e.id, JSON.stringify(e), ms, seq);
          upserted += 1;
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return { upserted, skipped };
    },
    since(cursor, limit = PAGE) {
      const rows = page.all(cursor, limit + 1);
      const more = rows.length > limit;
      const list = rows.slice(0, limit);
      return {
        entries: list.map((r) => JSON.parse(r.data)),
        cursor: list.length ? list[list.length - 1].seq : cursor,
        more,
      };
    },
    backup(path) { db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`); },
    close() { db.close(); },
  };
}

// ---------- HTTP ----------

const digest = (s) => createHash('sha256').update(String(s)).digest();

export function createSyncServer({ store, token, allowedOrigins = [], log = () => {} }) {
  if (!token || token.length < 24) throw new Error('SYNC_TOKEN must be at least 24 characters');
  const tokenDigest = digest(token);
  const authorised = (req) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    return !!m && timingSafeEqual(digest(m[1]), tokenDigest);
  };

  const send = (res, status, body, headers = {}) => {
    const json = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    });
    res.end(json);
  };

  const readJson = (req) => new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('too_large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Object.assign(new Error('bad_json'), { status: 400 })); }
    });
    req.on('error', reject);
  });

  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    const origin = req.headers.origin;
    const cors = origin && allowedOrigins.includes(origin)
      ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      }
      : { Vary: 'Origin' };
    const done = (status, body) => { send(res, status, body, cors); log(`${req.method} ${url.pathname} ${status}`); };

    try {
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
      if (url.pathname === '/health' && req.method === 'GET') { done(200, 'ok'); return; }
      if (!url.pathname.startsWith('/api/')) { done(404, { ok: false, error: 'not_found' }); return; }
      if (!authorised(req)) { done(401, { ok: false, error: 'bad_token' }); return; }

      const serverTime = new Date().toISOString();
      if (url.pathname === '/api/ping' && req.method === 'GET') { done(200, { ok: true, serverTime }); return; }

      if (url.pathname === '/api/entries' && req.method === 'POST') {
        const body = await readJson(req);
        if (!body || !Array.isArray(body.entries) || body.entries.length > MAX_BATCH) { done(400, { ok: false, error: 'bad_request' }); return; }
        const clean = body.entries.map(cleanEntry);
        const bad = clean.findIndex((e) => !e);
        if (bad !== -1) { done(400, { ok: false, error: 'bad_entry', index: bad }); return; }
        done(200, { ok: true, ...store.upsert(clean), serverTime });
        return;
      }

      if (url.pathname === '/api/entries' && req.method === 'GET') {
        const since = Number(url.searchParams.get('since') || 0);
        if (!Number.isInteger(since) || since < 0) { done(400, { ok: false, error: 'bad_request' }); return; }
        done(200, { ok: true, ...store.since(since), serverTime });
        return;
      }

      done(404, { ok: false, error: 'not_found' });
    } catch (err) {
      if (err.status) { done(err.status, { ok: false, error: err.message }); return; }
      console.error(err);
      done(500, { ok: false, error: 'server_error' });
    }
  });
}

// ---------- Run (node server.mjs) ----------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8787);
  const dbPath = process.env.DB_PATH || '/data/sync.db';
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://jayframemedia.github.io')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const store = openStore(dbPath);
  const server = createSyncServer({
    store,
    token: process.env.SYNC_TOKEN,
    allowedOrigins,
    log: (line) => console.log(`${new Date().toISOString()} ${line}`),
  });
  server.listen(port, process.env.HOST || '0.0.0.0', () => {
    console.log(`Time Tracker sync listening on :${port} (db ${dbPath}; origins ${allowedOrigins.join(', ')})`);
  });
  const stop = () => server.close(() => { store.close(); process.exit(0); });
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
