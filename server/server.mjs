// Time Tracker sync server. Node 24+, no dependencies (built-in node:sqlite via store.mjs).
//
// Everyone has a personal key (owner or staff), sent as "Authorization: Bearer <key>".
//   GET  /health                        → "ok" (no auth; Docker health check)
//   GET  /api/ping                      → { ok, user: { name, role }, lockBefore }
//   POST /api/entries   { entries }     → { ok, upserted, skipped, rejected, restore, lockBefore }
//   GET  /api/entries?since=<cursor>    → { ok, entries, cursor, more, user, lockBefore }   (own shifts only)
// Owner only:
//   GET  /api/team/entries?from&to      → { ok, users, entries, running, lockBefore }
//   POST /api/team/entries { entries }  → correct anyone's existing shift
//   POST /api/team/lock { before }      → lock staff edits to shifts before a date (null unlocks)
//
// Last write wins on `updatedAt`; clients pull by server sequence number (see docs/SYNC.md).
// Optional "X-Client-Time: <ms>" lets the server flag phones whose clock is wrong.
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { openStore, cleanEntry, isDate } from './store.mjs';

export { openStore, cleanEntry } from './store.mjs';

const MAX_BODY = 2 * 1024 * 1024;

// Sent with every response. HSTS is set here (not zone-wide in Cloudflare) so it only covers
// the sync hostname, never your main website.
export const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'cross-origin',
};
const MAX_BATCH = 5000;

export function createSyncServer({ store, allowedOrigins = [], log = () => {} }) {
  const send = (res, status, body, headers = {}) => {
    const text = typeof body === 'string';
    res.writeHead(status, {
      'Content-Type': text ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
      ...headers,
    });
    res.end(text ? body : JSON.stringify(body));
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

  const cleanAll = (body) => {
    if (!body || !Array.isArray(body.entries) || body.entries.length > MAX_BATCH) return { error: 'bad_request' };
    const clean = body.entries.map(cleanEntry);
    const bad = clean.findIndex((e) => !e);
    return bad === -1 ? { clean } : { error: 'bad_entry', index: bad };
  };

  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    const origin = req.headers.origin;
    const cors = origin && allowedOrigins.includes(origin)
      ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Client-Time',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      }
      : { Vary: 'Origin' };
    const done = (status, body) => { send(res, status, body, cors); log(`${req.method} ${url.pathname} ${status}`); };

    try {
      if (req.method === 'OPTIONS') { res.writeHead(204, { ...SECURITY_HEADERS, ...cors }); res.end(); return; }
      if (url.pathname === '/health' && req.method === 'GET') { done(200, 'ok'); return; }
      if (!url.pathname.startsWith('/api/')) { done(404, { ok: false, error: 'not_found' }); return; }

      const key = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
      const user = store.authenticate(key);
      if (!user) { done(401, { ok: false, error: 'bad_token' }); return; }

      const me = { name: user.name, role: user.role };
      const base = { ok: true, user: me, lockBefore: store.getLock(), serverTime: new Date().toISOString() };
      const clientMs = Number(req.headers['x-client-time']);
      const skewMs = Number.isFinite(clientMs) && clientMs > 0 ? clientMs - Date.now() : null;
      const path = url.pathname;

      if (path === '/api/ping' && req.method === 'GET') { done(200, base); return; }

      if (path === '/api/entries' && req.method === 'POST') {
        const { clean, error, index } = cleanAll(await readJson(req));
        if (error) { done(400, { ok: false, error, index }); return; }
        done(200, { ...base, ...store.upsert(user, clean, { skewMs }) });
        return;
      }

      if (path === '/api/entries' && req.method === 'GET') {
        const since = Number(url.searchParams.get('since') || 0);
        if (!Number.isInteger(since) || since < 0) { done(400, { ok: false, error: 'bad_request' }); return; }
        done(200, { ...base, ...store.since(user, since) });
        return;
      }

      if (path.startsWith('/api/team/')) {
        if (user.role !== 'owner') { done(403, { ok: false, error: 'owner_only' }); return; }

        if (path === '/api/team/entries' && req.method === 'GET') {
          const from = url.searchParams.get('from');
          const to = url.searchParams.get('to');
          if (!isDate(from) || !isDate(to) || from > to) { done(400, { ok: false, error: 'bad_request' }); return; }
          done(200, { ...base, ...store.team(from, to) });
          return;
        }
        if (path === '/api/team/entries' && req.method === 'POST') {
          const { clean, error, index } = cleanAll(await readJson(req));
          if (error) { done(400, { ok: false, error, index }); return; }
          done(200, { ...base, ...store.upsert(user, clean, { asOwner: true }) });
          return;
        }
        if (path === '/api/team/lock' && req.method === 'POST') {
          const body = await readJson(req);
          const before = body?.before ?? null;
          if (before !== null && !isDate(before)) { done(400, { ok: false, error: 'bad_request' }); return; }
          done(200, { ...base, lockBefore: store.setLock(before) });
          return;
        }
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
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://timetracker.jayframemedia.com.au')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const token = process.env.SYNC_TOKEN;
  if (token && token.length < 24) throw new Error('SYNC_TOKEN must be at least 24 characters');
  // SYNC_TOKEN is only used to create the owner the first time (or to upgrade an older database).
  const store = openStore(dbPath, { ownerToken: token, ownerName: process.env.OWNER_NAME || 'Owner' });
  const server = createSyncServer({ store, allowedOrigins, log: (line) => console.log(`${new Date().toISOString()} ${line}`) });
  server.listen(port, process.env.HOST || '0.0.0.0', () => {
    console.log(`Time Tracker sync listening on :${port} (db ${dbPath}; origins ${allowedOrigins.join(', ')})`);
  });
  const stop = () => server.close(() => { store.close(); process.exit(0); });
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
