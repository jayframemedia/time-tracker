// Nightly backup: copies the database to /data/backups/sync-YYYY-MM-DD.db and keeps the last 14.
// Run inside the container:  docker compose exec -T sync node backup.mjs
import { mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { openStore } from './server.mjs';

const dbPath = process.env.DB_PATH || '/data/sync.db';
const dir = process.env.BACKUP_DIR || '/data/backups';
const keep = Number(process.env.BACKUP_KEEP || 14);

mkdirSync(dir, { recursive: true });
const file = join(dir, `sync-${new Date().toISOString().slice(0, 10)}.db`);
if (existsSync(file)) rmSync(file); // VACUUM INTO won't overwrite
const store = openStore(dbPath);
store.backup(file);
store.close();

const old = readdirSync(dir).filter((f) => /^sync-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -keep);
for (const f of old) rmSync(join(dir, f));
console.log(`Backed up to ${file}${old.length ? `; removed ${old.length} old` : ''}`);
