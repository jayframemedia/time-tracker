// Check a backup file without changing it: integrity, people, shift counts and date range.
//   docker compose exec sync node verify-backup.mjs /data/backups/sync-2026-11-19.db
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';

export function verifyBackup(path) {
  if (!existsSync(path)) throw new Error(`No file at ${path}`);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
    const version = db.prepare('PRAGMA user_version').get().user_version;
    const hasUsers = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
    const totals = db.prepare(`SELECT COUNT(*) AS shifts, MIN(json_extract(data, '$.start')) AS first, MAX(json_extract(data, '$.start')) AS last
      FROM entries WHERE json_extract(data, '$.deleted') = 0`).get();
    const people = hasUsers
      ? db.prepare(`SELECT u.name, u.role, u.revoked_at,
          (SELECT COUNT(*) FROM entries e WHERE e.user_id = u.id AND json_extract(e.data, '$.deleted') = 0) AS shifts
          FROM users u ORDER BY u.role = 'owner' DESC, u.name`).all()
      : [];
    return { ok: integrity === 'ok', integrity, version, shifts: totals.shifts, first: totals.first, last: totals.last, people };
  } finally {
    db.close();
  }
}

if (process.argv[1]?.endsWith('verify-backup.mjs')) {
  const path = process.argv[2];
  if (!path) { console.log('Usage: node verify-backup.mjs /data/backups/sync-YYYY-MM-DD.db'); process.exit(1); }
  try {
    const r = verifyBackup(path);
    console.log(`${r.ok ? 'OK' : 'PROBLEM'}  ${path}`);
    console.log(`  Integrity: ${r.integrity}   Schema version: ${r.version}`);
    console.log(`  Shifts: ${r.shifts}${r.shifts ? `   from ${String(r.first).slice(0, 10)} to ${String(r.last).slice(0, 10)}` : ''}`);
    for (const p of r.people) console.log(`  ${p.name.padEnd(20)} ${p.role.padEnd(5)} ${p.revoked_at ? 'revoked' : 'active '} ${String(p.shifts).padStart(5)} shifts`);
    process.exitCode = r.ok ? 0 : 1;
  } catch (err) {
    console.error(`PROBLEM  ${err.message}`);
    process.exitCode = 1;
  }
}
