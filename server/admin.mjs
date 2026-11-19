// Manage who can sync. Run on the server:
//   docker compose exec sync node admin.mjs list
//   docker compose exec sync node admin.mjs add "Sam Smith"      → prints Sam's personal key (once)
//   docker compose exec sync node admin.mjs revoke "Sam Smith"   → key stops working; shifts are kept
//   docker compose exec sync node admin.mjs new-key "Sam Smith"  → replaces a lost key (also un-revokes)
//   docker compose exec sync node admin.mjs rename "Owner" "Jason"
import { openStore } from './store.mjs';

const [cmd, ...args] = process.argv.slice(2);
const usage = `Usage:
  node admin.mjs list
  node admin.mjs add "Full Name"
  node admin.mjs revoke "Full Name"
  node admin.mjs new-key "Full Name"
  node admin.mjs rename "Old Name" "New Name"`;

const store = openStore(process.env.DB_PATH || '/data/sync.db', {
  ownerToken: process.env.SYNC_TOKEN,
  ownerName: process.env.OWNER_NAME || 'Owner',
});

const showKey = (name, key) => {
  console.log(`\nPersonal key for ${name} (shown once, so copy it now):\n\n  ${key}\n`);
  console.log('In the app: Settings → Sync between devices');
  console.log('  Server address: time.jayframemedia.com.au');
  console.log('  Sync key:       the key above\n');
};

try {
  const name = (args[0] || '').trim();
  switch (cmd) {
    case 'list': {
      const rows = store.listUsers();
      const w = Math.max(4, ...rows.map((r) => r.name.length));
      console.log(`${'Name'.padEnd(w)}  Role   Status   Shifts  Last sync`);
      for (const r of rows) {
        console.log(`${r.name.padEnd(w)}  ${r.role.padEnd(5)}  ${(r.revoked_at ? 'revoked' : 'active').padEnd(7)}  ${String(r.shifts).padStart(6)}  ${r.last_seen_at ? r.last_seen_at.slice(0, 16).replace('T', ' ') + ' UTC' : 'never'}`);
      }
      break;
    }
    case 'add':
      if (!name || name.length > 60) throw new Error('Give a name (up to 60 characters), e.g. add "Sam Smith"');
      showKey(name, store.addUser(name));
      break;
    case 'revoke':
      store.revokeUser(name);
      console.log(`${name} can no longer sync. Their shifts are kept.`);
      break;
    case 'new-key':
      showKey(name, store.newUserKey(name));
      console.log('The old key no longer works.');
      break;
    case 'rename': {
      const to = (args[1] || '').trim();
      if (!name || !to) throw new Error('rename "Old Name" "New Name"');
      store.renameUser(name, to);
      console.log(`Renamed ${name} → ${to}.`);
      break;
    }
    default:
      console.log(usage);
      process.exitCode = cmd ? 1 : 0;
  }
} catch (err) {
  console.error(/UNIQUE/.test(err.message) ? 'That name is already used.' : err.message);
  process.exitCode = 1;
} finally {
  store.close();
}
