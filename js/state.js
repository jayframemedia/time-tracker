// Shared app state and small helpers used across the app's modules.
import { detectDevice } from './timer.js';
import { startOfWeek } from './format.js';
import { loadSettings } from './settings.js';
import { getLockBefore, isOwner } from './sync.js';

export const STALE_MS = 12 * 3600 * 1000; // "Still running?" after 12 h
export const SHORT_MS = 60 * 1000; // "Keep or discard?" under 60 s
export const LAST_EXPORT = 'tt.lastExport';
export const EMPTY_WARNED = 'tt.emptyWarned';
export const NEXT_LABELS = 'tt.nextLabels';
export const wideQuery = matchMedia('(min-width: 900px)');

export const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const readJSON = (k) => { try { return JSON.parse(ls.get(k)) || null; } catch { return null; } };

export const state = {
  tab: 'timer', // iPhone tabs: timer | history | settings | team (owner)
  pane: 'history', // Mac right pane: history | settings | team (owner)
  team: { weekStart: startOfWeek(new Date(), loadSettings().weekStartsOn), data: null, loading: false, error: null, person: null, key: '' },
  filter: 'two-weeks', // Mac history filter
  entries: [],
  running: null, // open entry
  hold: 0, // 0..1 while FINISH is held
  busy: false,
  animateButton: false, // fade/scale the big button in only when it changes
  newId: null, // fade in this History row once
  settings: loadSettings(),
  nextLabels: readJSON(NEXT_LABELS) || { job: null, employee: null },
  renderedDay: '',
  otherRunning: [], // open shifts started on another device while this one also runs
};

export const deviceName = () => state.settings.deviceName || detectDevice();
export const isWide = () => wideQuery.matches;
/** Display options shared by History and Team. */
export const view = () => ({
  timeFormat: state.settings.timeFormat,
  rounding: state.settings.rounding,
  weekStartsOn: state.settings.weekStartsOn,
  showLabels: state.settings.showLabels,
  lockedBefore: getLockBefore(),
});
export const typingInView = () => document.activeElement?.matches?.('#view input');
export const teamVisible = () => isOwner() && (isWide() ? state.pane === 'team' : state.tab === 'team');

// app.js registers the real render/tick; other modules call these.
let renderFn = () => {};
let tickFn = () => {};
export const setRenderers = ({ render, tick }) => { renderFn = render; tickFn = tick; };
export const render = () => renderFn();
export const tick = () => tickFn();
