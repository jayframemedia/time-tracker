// Bottom sheets (dialogs): edit a shift, job/employee labels, "Keep or discard?".
import {
  toInputValue, fromInputValue, formatHours, durationLabel, shortDate,
} from './format.js';
import { esc } from './history.js';

const CLOSE_ICON = '<svg class="ico" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>';
const DAY_MS = 24 * 3600 * 1000;

/** Create a modal sheet, show it, and remove it from the page when it closes. */
function openSheet(id, innerHtml, { onClose } = {}) {
  document.getElementById(id)?.remove();
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet';
  dlg.id = id;
  dlg.setAttribute('aria-labelledby', `${id}-title`);
  dlg.innerHTML = `<form class="sheet-body" method="dialog" novalidate>${innerHtml}</form>`;
  document.body.append(dlg);
  dlg.addEventListener('click', (ev) => {
    if (ev.target === dlg || ev.target.closest('[data-close]')) dlg.close();
  });
  dlg.addEventListener('close', () => { onClose?.(dlg.returnValue); dlg.remove(); });
  dlg.showModal();
  return dlg;
}

const header = (id, title) => `
  <div class="row-between center">
    <h2 id="${id}-title">${esc(title)}</h2>
    <button type="button" class="icon-btn" data-close aria-label="Close">${CLOSE_ICON}</button>
  </div>`;

const datalist = (id, values) => `<datalist id="${id}">${values.map((v) => `<option value="${esc(v)}"></option>`).join('')}</datalist>`;

/** Distinct non-empty values of a field, most recently used first. */
export function recentValues(entries, field, limit = 12) {
  const seen = new Set();
  return entries
    .filter((e) => e[field] && !e.deleted)
    .sort((a, b) => Date.parse(b.updatedAt || b.start) - Date.parse(a.updatedAt || a.start))
    .map((e) => e[field].trim())
    .filter((v) => v && !seen.has(v) && seen.add(v))
    .slice(0, limit);
}

/**
 * Edit a finished shift. onSave({ start: Date|null, end: Date|null, job, employee }) gets null
 * for a time the user didn't change, so the stored seconds (and `edited`) stay untouched.
 */
export function openEditSheet(entry, { entries, onSave, onDelete }) {
  const startVal = toInputValue(entry.start);
  const endVal = toInputValue(entry.end);
  const dlg = openSheet('edit-sheet', `
    ${header('edit-sheet', `Edit shift · ${shortDate(entry.start)}`)}
    <div class="fields">
      <label>Clock in<input type="datetime-local" name="start" value="${startVal}" required></label>
      <label>Clock out<input type="datetime-local" name="end" value="${endVal}" required></label>
      <label>Job<input type="text" name="job" value="${esc(entry.job || '')}" list="dl-job" autocomplete="off" maxlength="80" placeholder="Optional"></label>
      <label>Employee<input type="text" name="employee" value="${esc(entry.employee || '')}" list="dl-employee" autocomplete="off" maxlength="80" placeholder="Optional"></label>
    </div>
    ${datalist('dl-job', recentValues(entries, 'job'))}
    ${datalist('dl-employee', recentValues(entries, 'employee'))}
    <div class="card summary"><div class="summary-main" id="edit-total"></div>
      <div class="error small" id="edit-error" role="alert"></div></div>
    <button type="submit" class="primary" id="edit-save">Save</button>
    <button type="button" class="danger-btn" id="edit-delete">Delete shift</button>`);

  const form = dlg.querySelector('form');
  const f = (name) => form.elements[name];

  const read = () => {
    const start = fromInputValue(f('start').value);
    const end = fromInputValue(f('end').value);
    let error = '';
    if (!start || !end) error = 'Enter both a clock-in and a clock-out time.';
    else if (end <= start) error = 'Clock out must be after clock in.';
    else if (end - start > DAY_MS) error = 'A shift can’t be longer than 24 hours.';
    else if (end - Date.now() > 60_000) error = 'Clock out can’t be in the future.';
    return { start, end, error };
  };

  const update = () => {
    const { start, end, error } = read();
    const mins = start && end && end > start ? Math.round((end - start) / 60000) : 0;
    dlg.querySelector('#edit-total').textContent = `${formatHours(mins)} h · ${durationLabel(mins)}`;
    dlg.querySelector('#edit-error').textContent = error;
    dlg.querySelector('#edit-save').disabled = !!error;
  };
  form.addEventListener('input', update);

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const { start, end, error } = read();
    if (error) return;
    onSave({
      start: f('start').value === startVal ? null : start,
      end: f('end').value === endVal ? null : end,
      job: f('job').value.trim() || null,
      employee: f('employee').value.trim() || null,
    });
    dlg.close('saved');
  });
  dlg.querySelector('#edit-delete').addEventListener('click', () => { dlg.close('deleted'); onDelete(); });
  update();
}

/** Job & employee for the current (or next) shift. */
export function openLabelsSheet({ job, employee, running, entries, onSave }) {
  const dlg = openSheet('labels-sheet', `
    ${header('labels-sheet', running ? 'This shift' : 'Next shift')}
    <div class="fields">
      <label>Job<input type="text" name="job" value="${esc(job || '')}" list="dl-job2" autocomplete="off" maxlength="80" placeholder="e.g. Site A"></label>
      <label>Employee<input type="text" name="employee" value="${esc(employee || '')}" list="dl-employee2" autocomplete="off" maxlength="80" placeholder="e.g. your name"></label>
    </div>
    ${datalist('dl-job2', recentValues(entries, 'job'))}
    ${datalist('dl-employee2', recentValues(entries, 'employee'))}
    <p class="muted small">${running ? 'Saved to the running shift and kept for your next one.' : 'Applied when you press Start.'}</p>
    <button type="submit" class="primary">Done</button>
    <button type="button" class="secondary" id="labels-clear">Clear both</button>`);
  const form = dlg.querySelector('form');
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    onSave({ job: form.elements.job.value.trim() || null, employee: form.elements.employee.value.trim() || null });
    dlg.close('saved');
  });
  dlg.querySelector('#labels-clear').addEventListener('click', () => {
    onSave({ job: null, employee: null });
    dlg.close('cleared');
  });
}

/** Shift under a minute: resolve 'keep' | 'discard' | 'cancel' (closed without choosing). */
export function askKeepOrDiscard(seconds) {
  return new Promise((resolve) => {
    let choice = 'cancel';
    const dlg = openSheet('short-sheet', `
      ${header('short-sheet', 'Keep or discard?')}
      <p class="sheet-text">This shift is only ${seconds} second${seconds === 1 ? '' : 's'} long. Keep it in your history, or discard it?</p>
      <button type="button" class="primary" data-choice="keep">Keep</button>
      <button type="button" class="secondary" data-choice="discard">Discard</button>`, { onClose: () => resolve(choice) });
    dlg.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-choice]');
      if (b) { choice = b.dataset.choice; dlg.close(choice); }
    });
    dlg.querySelector('[data-choice="keep"]').focus();
  });
}
