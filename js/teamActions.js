// Owner Team view: loading the week, correcting staff shifts, locking weeks, exporting.
import { isoDate, toLocalISO, startOfWeek, addDays, shortDate } from './format.js';
import { $, toast } from './ui.js';
import { openEditSheet } from './sheets.js';
import { teamFetch, teamSave, teamLock } from './sync.js';
import { weekRange, openLockSheet, openTeamExportSheet } from './team.js';
import { state, render, typingInView, teamVisible } from './state.js';
import { editShift } from './actions.js';

/** Load everyone's shifts for the Team week (live from the server). */
export async function loadTeam() {
  const t = state.team;
  const { from, to } = weekRange(t.weekStart);
  t.loading = true;
  t.key = from;
  try {
    const data = await teamFetch(from, to);
    if (t.key !== from) return; // the week changed while loading
    t.data = data;
    t.error = null;
  } catch (err) {
    t.error = err.message;
  } finally {
    t.loading = false;
  }
  if (teamVisible() && !typingInView()) render();
}

function teamEdit(id) {
  const e = state.team.data?.entries.find((x) => x.id === id);
  if (!e) return;
  if (state.entries.some((x) => x.id === id)) { editShift(id); return; } // your own shift: edit it like any other
  if (!e.end) { toast('Still clocked in — it can be corrected after Finish'); return; }
  const name = state.team.data.users.find((u) => u.id === e.userId)?.name || 'They';
  const clean = ({ userId, clockSkewMs, original, ...rest }) => rest; // drop Team-only fields
  openEditSheet(clean(e), {
    entries: state.team.data.entries,
    onSave: async ({ start, end, job, employee }) => {
      const updated = {
        ...clean(e),
        start: start ? toLocalISO(start) : e.start,
        end: end ? toLocalISO(end) : e.end,
        job,
        employee,
        edited: e.edited || !!(start || end),
        updatedAt: toLocalISO(),
      };
      try { await teamSave([updated]); } catch (err) { toast(err.message); return; }
      toast(`Updated · ${name} sees it next sync`);
      loadTeam();
    },
    onDelete: async () => {
      const gone = { ...clean(e), deleted: true, updatedAt: toLocalISO() };
      try { await teamSave([gone]); } catch (err) { toast(err.message); return; }
      loadTeam();
      toast('Shift deleted', {
        action: 'Undo',
        onAction: async () => {
          try { await teamSave([{ ...gone, deleted: false, updatedAt: toLocalISO() }]); } catch (err) { toast(err.message); return; }
          loadTeam();
        },
      });
    },
  });
}

/** Team view clicks (owner). Returns true if handled. */
export function onTeamClick(t) {
  const team = state.team;
  const teamEditBtn = t.closest('[data-team-edit]');
  if (teamEditBtn) { teamEdit(teamEditBtn.dataset.teamEdit); return true; }
  const person = t.closest('[data-person]');
  if (person) { team.person = Number(person.dataset.person); render(); $('#view').scrollTop = 0; return true; }
  if (t.closest('[data-person-back]')) { team.person = null; render(); return true; }
  const week = t.closest('[data-week]');
  if (week) {
    team.weekStart = addDays(team.weekStart, 7 * Number(week.dataset.week));
    team.data = null;
    team.key = '';
    render();
    return true;
  }
  if (t.closest('#team-refresh')) { loadTeam(); toast('Refreshing…'); return true; }
  if (t.closest('#open-team')) { state.pane = 'team'; render(); return true; }
  if (t.closest('#close-team')) { state.pane = 'history'; render(); return true; }
  if (t.closest('#team-lock')) {
    openLockSheet({
      lockBefore: team.data?.lockBefore,
      defaultDate: isoDate(startOfWeek(new Date(), state.settings.weekStartsOn)),
      onLock: async (before) => {
        await teamLock(before);
        toast(before ? `Locked before ${shortDate(before)}` : 'All weeks unlocked');
        loadTeam();
      },
    });
    return true;
  }
  const exp = t.closest('#team-export');
  if (exp && team.data) {
    openTeamExportSheet({
      users: team.data.users,
      personId: exp.dataset.personExport ? Number(exp.dataset.personExport) : null,
      weekStartsOn: state.settings.weekStartsOn,
      rounding: state.settings.rounding,
      fetchRange: teamFetch,
    });
    return true;
  }
  return false;
}
