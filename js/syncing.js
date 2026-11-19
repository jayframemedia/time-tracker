// When to sync, and following changes made on other devices (see js/sync.js for the protocol).
import { getAllEntries } from './store.js';
import { setRunningMirror } from './timer.js';
import { $, toast } from './ui.js';
import { openSyncSheet } from './sheets.js';
import {
  getSyncConfig, getSyncStatus, syncNow, testConnection, connectSync, disconnectSync, agoLabel,
} from './sync.js';
import { state, render, typingInView, teamVisible } from './state.js';
import { syncStatusHtml } from './views.js';
import { isHolding } from './hold.js';
import { loadTeam } from './teamActions.js';

let syncTimer = 0;
/** Sync shortly after a change (debounced), or right away with delay 0. */
export function scheduleSync(delay = 800) {
  if (!getSyncConfig()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, delay);
}

export async function runSync() {
  const el = $('#sync-status');
  if (el) el.textContent = 'Syncing…';
  const res = await syncNow({ onChange: reloadFromDb });
  if (!res.pulled && !res.skipped && !res.error) await reconcileOpen();
  const after = $('#sync-status');
  if (after) after.innerHTML = syncStatusHtml();
  if (teamVisible() && !state.team.loading) loadTeam();
}

/** Safety net: if the open shifts in storage differ from what's on screen, reload. */
async function reconcileOpen() {
  const ids = (list) => list.map((e) => e.id).sort().join(',');
  const stored = (await getAllEntries()).filter((e) => !e.end && !e.deleted);
  const shown = [state.running, ...state.otherRunning].filter(Boolean);
  if (ids(stored) !== ids(shown)) await reloadFromDb();
}

/** Re-read everything after a sync brought in changes, and follow a shift started or ended elsewhere. */
export async function reloadFromDb() {
  // Changes are already saved; show them once the user isn't mid-action or mid-typing.
  if (state.busy || isHolding() || typingInView()) { setTimeout(reloadFromDb, 1500); return; }
  state.entries = await getAllEntries();
  const open = state.entries
    .filter((e) => !e.end && !e.deleted)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const was = state.running;
  if (was) {
    const now = state.entries.find((e) => e.id === was.id);
    if (!now || now.end || now.deleted) {
      state.running = null;
      setRunningMirror(null);
      state.animateButton = true;
      toast(now && !now.deleted ? 'Shift finished on your other device' : 'Shift discarded on your other device');
    } else {
      state.running = now;
    }
  }
  if (!state.running && open.length) {
    state.running = open[0];
    setRunningMirror(open[0]);
    state.animateButton = true;
    if (!was) toast(`Shift running · started on ${open[0].device || 'another device'}`);
  }
  state.otherRunning = open.filter((e) => e.id !== state.running?.id);
  render();
}

/** Settings → Sync between devices. */
export function openSync() {
  const st = getSyncStatus();
  openSyncSheet({
    config: getSyncConfig(),
    statusText: `Last synced ${agoLabel(st.lastSyncedAt)}`,
    errorText: st.lastError,
    onConnect: async (url, token) => {
      const config = await testConnection(url, token);
      await connectSync(config);
      state.entries = await getAllEntries();
      await runSync();
      const after = getSyncStatus();
      toast(after.lastError ? `Sync problem: ${after.lastError}` : 'Sync is on');
      render();
    },
    onSyncNow: async () => {
      await runSync();
      const after = getSyncStatus();
      toast(after.lastError ? `Sync problem: ${after.lastError}` : 'Synced');
      render();
    },
    onDisconnect: () => {
      disconnectSync();
      toast('Sync is off · your shifts stay on this device');
      render();
    },
  });
}
