// Settings, kept in localStorage. `normalizeSettings` is pure and tested.
const KEY = 'tt.settings';

export const DEFAULTS = Object.freeze({
  timeFormat: '12', // '12' | '24'  (CSV is always 24-hour)
  weekStartsOn: 1, // 1 = Monday, 0 = Sunday
  rounding: 0, // 0 | 5 | 15 minutes — display and CSV only
  showLabels: false, // job & employee
  deviceName: '', // '' = detected ("iPhone" / "Mac")
});

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/** Fill in defaults and drop anything invalid. */
export function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    timeFormat: pick(String(s.timeFormat), ['12', '24'], DEFAULTS.timeFormat),
    weekStartsOn: pick(Number(s.weekStartsOn), [0, 1], DEFAULTS.weekStartsOn),
    rounding: pick(Number(s.rounding), [0, 5, 15], DEFAULTS.rounding),
    showLabels: s.showLabels === true,
    deviceName: typeof s.deviceName === 'string' ? s.deviceName.trim().slice(0, 40) : '',
  };
}

export function loadSettings() {
  try { return normalizeSettings(JSON.parse(localStorage.getItem(KEY))); } catch { return normalizeSettings(null); }
}

export function saveSettings(settings) {
  const s = normalizeSettings(settings);
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
  return s;
}
