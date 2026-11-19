// Pure date / time / hours helpers. No DOM, no storage — tested with `node --test`.
// All display uses the device's local time zone (Brisbane, +10:00, for Jason).

export const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const pad2 = (n) => String(n).padStart(2, '0');

const toDate = (v) => (v instanceof Date ? v : new Date(v));

/** Elapsed milliseconds → "HH:MM:SS" (hours keep counting past 99). */
export function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`;
}

/** Date → ISO 8601 in local time with offset, e.g. "2026-11-16T08:00:00+10:00". */
export function toLocalISO(date = new Date()) {
  const d = toDate(date);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return `${isoDate(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
    + `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** "2026-11-16" (local date). */
export function isoDate(date) {
  const d = toDate(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** "YYYY-MM-DD" → local midnight Date. */
export function parseIsoDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** "Mon 16 Nov" */
export const shortDate = (date) => { const d = toDate(date); return `${DAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
/** "16 Nov" */
export const dayMonth = (date) => { const d = toDate(date); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
/** "Monday" */
export const longDay = (date) => DAYS_LONG[toDate(date).getDay()];

/** "8:00 am" */
export function time12(date) {
  const d = toDate(date);
  const h = d.getHours();
  return `${h % 12 || 12}:${pad2(d.getMinutes())} ${h >= 12 ? 'pm' : 'am'}`;
}

/** "08:00" */
export const time24 = (date) => { const d = toDate(date); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

/** "8:00 am" (12-hour) or "08:00" (24-hour). */
export const formatTime = (date, timeFormat = '12') => (timeFormat === '24' ? time24(date) : time12(date));

/** Drop seconds: the start of the clock minute. */
const floorMinute = (d) => new Date(Math.floor(toDate(d).getTime() / 60000) * 60000);

/**
 * Round a time to the nearest `step` minutes in local time (step 0 = just drop seconds).
 * Whole minutes never tie, so there is no half-way case: 8:07 → 8:00, 8:08 → 8:15 at step 15.
 */
export function roundTime(date, step = 0) {
  const d = floorMinute(date);
  if (!step) return d;
  const mins = d.getHours() * 60 + d.getMinutes();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, Math.round(mins / step) * step);
}

/** Clock-in / clock-out as shown and exported, after rounding. Stored times are never changed. */
export function shiftTimes(entry, step = 0) {
  return { start: roundTime(entry.start, step), end: entry.end ? roundTime(entry.end, step) : null };
}

/**
 * Whole minutes worked, from the (rounded) clock-in minute to the (rounded) clock-out minute.
 * Seconds are ignored so the hours always match the HH:MM times shown and exported
 * (08:00 → 17:00 is exactly 9.00 h). See docs/DECISIONS.md.
 */
export function entryMinutes(entry, step = 0) {
  if (!entry.end) return 0;
  const { start, end } = shiftTimes(entry, step);
  return Math.max(0, Math.round((end - start) / 60000));
}

export const sumMinutes = (entries, step = 0) => entries.reduce((t, e) => t + entryMinutes(e, step), 0);

/** ISO string → value for <input type="datetime-local">, e.g. "2026-11-16T08:00". */
export const toInputValue = (iso) => { const d = toDate(iso); return `${isoDate(d)}T${time24(d)}`; };

/** <input type="datetime-local"> value (local time) → Date, or null if empty/invalid. */
export function fromInputValue(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '');
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

/** Minutes → decimal hours, 2 dp: 525 → "8.75". Integer maths, so no float drift. */
export const formatHours = (minutes) => (Math.round((minutes * 5) / 3) / 100).toFixed(2);

/** Minutes → "9h 00m" */
export const durationLabel = (minutes) => `${Math.floor(minutes / 60)}h ${pad2(minutes % 60)}m`;

/** Local midnight of the given day. */
export function startOfDay(date) {
  const d = toDate(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(date, n) {
  const d = toDate(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Local midnight of the first day of the week. weekStartsOn: 1 = Monday, 0 = Sunday. */
export function startOfWeek(date, weekStartsOn = 1) {
  const d = startOfDay(date);
  return addDays(d, -((d.getDay() - weekStartsOn + 7) % 7));
}

export const sameDay = (a, b) => isoDate(a) === isoDate(b);
