// Nightly backup: copies the database to /data/backups/sync-YYYY-MM-DD.db and keeps the last 14,
// plus one copy per month in /data/backups/monthly/sync-YYYY-MM.db, kept indefinitely (record keeping).
// Run inside the container:  docker compose exec -T sync node backup.mjs
import { mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { openStore } from './store.mjs';

const dbPath = process.env.DB_PATH || '/data/sync.db';
const dir = process.env.BACKUP_DIR || '/data/backups';
const keep = Number(process.env.BACKUP_KEEP || 14);

mkdirSync(dir, { recursive: true });
const file = join(dir, `sync-${new Date().toISOString().slice(0, 10)}.db`);
if (existsSync(file)) rmSync(file); // VACUUM INTO won't overwrite
const opts = { ownerToken: process.env.SYNC_TOKEN, ownerName: process.env.OWNER_NAME || 'Owner' };
const store = openStore(dbPath, opts);
store.backup(file);
store.close();

// First backup of each month is also kept for good.
const monthlyDir = join(dir, 'monthly');
mkdirSync(monthlyDir, { recursive: true });
const monthly = join(monthlyDir, `sync-${new Date().toISOString().slice(0, 7)}.db`);
if (!existsSync(monthly)) {
  const s2 = openStore(dbPath, opts);
  s2.backup(monthly);
  s2.close();
  console.log(`Monthly copy: ${monthly}`);
}

const old = readdirSync(dir).filter((f) => /^sync-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -keep);
for (const f of old) rmSync(join(dir, f));
console.log(`Backed up to ${file}${old.length ? `; removed ${old.length} old` : ''}`);
