// Run every test in Jason's time zone, whatever machine (or CI runner) runs them.
process.env.TZ = 'Australia/Brisbane';

let n = 0;
/** Minimal finished entry. Times are Brisbane local, e.g. entry('2026-11-16', '08:00', '17:00'). */
export function entry(date, start, end, extra = {}) {
  n += 1;
  return {
    id: extra.id || `id-${n}`,
    start: `${date}T${start}:00+10:00`,
    end: end == null ? null : `${extra.endDate || date}T${end}:00+10:00`,
    employee: null,
    job: null,
    device: 'iPhone',
    edited: false,
    deleted: false,
    createdAt: `${date}T${start}:00+10:00`,
    updatedAt: `${date}T${start}:00+10:00`,
    ...extra,
  };
}
