// Small DOM helpers: toast, haptics, HTML escaping, file export, export sheet.
import { RANGES, rangeDates, entriesInRange, buildCsv, csvFilename } from './csv.js';
import { sumMinutes, formatHours, isoDate } from './format.js';

export const $ = (sel, root = document) => root.querySelector(sel);

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** navigator.vibrate where supported; silently nothing on iOS Safari. */
export function haptic(pattern = 10) {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

let toastTimer;
/**
 * Pill toast at the top. With `action` it shows a button (e.g. "Undo") and stays for `ms`.
 * toast('Logged · 9h 00m') or toast('Shift deleted', { action: 'Undo', onAction, ms: 5000 })
 */
export function toast(text, opts = {}) {
  const { action, onAction, ms = action ? 5000 : 2600 } = typeof opts === 'number' ? { ms: opts } : opts;
  const el = $('#toast');
  el.replaceChildren(Object.assign(document.createElement('span'), { textContent: text }));
  el.classList.toggle('has-action', !!action);
  if (action) {
    const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'toast-action', textContent: action });
    btn.addEventListener('click', () => { hideToast(); onAction?.(); }, { once: true });
    el.append(btn);
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}
export function hideToast() {
  const el = $('#toast');
  el.classList.remove('show', 'has-action');
  el.querySelector('.toast-action')?.remove();
}

export const isTouchDevice = () => matchMedia('(pointer: coarse)').matches;

/** iPhone: share sheet when it can take files, else download. Mac: download. */
export async function saveFile(text, filename, type = 'text/csv') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  if (isTouchDevice() && navigator.canShare) {
    const file = new File([blob], filename, { type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return 'shared';
      } catch (err) {
        if (err.name === 'AbortError') return 'cancelled';
        // Anything else (e.g. lost user activation) — fall back to a download.
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

/**
 * Export sheet: range pills, optional custom dates, a live summary and the Export button.
 * getEntries() is synchronous (entries are kept in memory) so the share sheet still has
 * the user's tap as its activation on iOS.
 */
export function openExportSheet({ getEntries, initialRange = 'this-week', weekStartsOn = 1, rounding = 0, onExported }) {
  const dlg = $('#export-sheet');
  let range = initialRange;
  const today = isoDate(new Date());
  const fromEl = $('#csv-from', dlg);
  const toEl = $('#csv-to', dlg);
  if (!fromEl.value) fromEl.value = today;
  if (!toEl.value) toEl.value = today;

  $('#range-pills', dlg).innerHTML = RANGES.map((r) => `
    <button type="button" class="pill" data-range="${r.id}" aria-pressed="${r.id === range}">${esc(r.label)}</button>`).join('');

  const current = () => {
    const dates = rangeDates(range, { entries: getEntries(), weekStartsOn, from: fromEl.value, to: toEl.value });
    return { dates, list: entriesInRange(getEntries(), dates) };
  };

  const update = () => {
    dlg.querySelectorAll('[data-range]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === range)));
    $('#custom-dates', dlg).hidden = range !== 'custom';
    const { dates, list } = current();
    const n = list.length;
    $('#csv-summary', dlg).textContent = `${n} shift${n === 1 ? '' : 's'} · ${formatHours(sumMinutes(list, rounding))} h`;
    $('#csv-filename', dlg).textContent = csvFilename(dates);
    $('#csv-go', dlg).disabled = n === 0;
  };

  dlg.onclick = (ev) => {
    const pill = ev.target.closest('[data-range]');
    if (pill) { range = pill.dataset.range; update(); return; }
    if (ev.target === dlg || ev.target.closest('[data-close]')) dlg.close();
  };
  fromEl.oninput = update;
  toEl.oninput = update;

  $('#csv-go', dlg).onclick = async () => {
    const { dates, list } = current();
    if (!list.length) return;
    const result = await saveFile(buildCsv(list, { rounding }), csvFilename(dates));
    if (result === 'cancelled') return;
    dlg.close();
    onExported?.(list.length, result);
  };

  update();
  dlg.showModal();
}
