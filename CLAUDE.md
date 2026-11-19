# Time Tracker — project rules for Claude Code

## What this is
An open-source, in-house time tracker for ONE user (Jason, Brisbane) on an iPhone 17 Pro and a Mac.
Start/finish timer → logged entry → history by day → CSV export. Sync between devices: own server in Docker behind a Cloudflare Tunnel (Phase 3, `server/`, `docs/SYNC.md`).

**Before writing code, read:** `docs/SPEC.md`, `docs/DESIGN.md`, `docs/DECISIONS.md`.
**Visual + behavioural reference:** open `design/mockup.html` (iPhone) and `design/mac-reference.html` (Mac) in a browser. Match them. They are reference prototypes only — do not copy their code structure into the app.

## Stack (do not change without asking)
- Installable PWA: `index.html`, `styles.css`, `js/*.js` (ES modules), `manifest.webmanifest`, `sw.js`, `icons/`
- Vanilla JS. No framework, no build step, no runtime npm dependencies.
- Storage: IndexedDB (object store `entries`, keyPath `id`). localStorage only for settings and the running timer's start time.
- Hosting: GitHub Pages, deployed by a GitHub Actions workflow. Licence: MIT.
- Must install on iPhone (Safari → Share → Add to Home Screen) and Mac (Safari → File → Add to Dock, macOS 14+).

## Data model
```
entry = {
  id: string (crypto.randomUUID()),
  start: string (ISO 8601 with offset, e.g. 2026-11-16T08:00:00+10:00),
  end: string | null (null while running),
  employee: string | null,
  job: string | null,
  device: string ("iPhone" | "Mac" | user-set name),
  edited: boolean (true if times changed by hand after Finish),
  deleted: boolean (soft delete, needed for sync),
  createdAt: string (ISO), updatedAt: string (ISO)
}
```
- Weekday, total hours and week totals are COMPUTED, never stored.
- Display in device local time. Jason is in Australia/Brisbane (+10:00, no daylight saving).

## Timer rules
- Store the start timestamp; the display is `now − start`. Never store a ticking counter.
- On launch, restore a running timer from storage (survives force-quit, sleep, reboot).
- Only one open entry at a time.
- Finish = press and hold 1 second (white progress ring fills; release early cancels). Enter/Space on the focused button also finishes (accessibility).
- Shifts shorter than 60 s: ask "Keep or discard?".
- Haptics: `navigator.vibrate` where supported; skip silently where not (iOS Safari).

## History
- Grouped by week (week starts Monday), newest first, week total shown in the accent colour.
- Row format: `Mon 16 Nov | 8:00 am | 5:00 pm | 9.00 h`.
- A day with more than one shift shows each shift, then a "Day total" row.
- Tap a row → edit sheet (start/end pickers, job, employee) → sets `edited: true`.
- Delete via swipe-left (iPhone) or a delete button (Mac) → soft delete + "Undo" toast for 5 s.

## CSV export
- Header, exactly: `Date,Day,Clock in,Clock out,Total hours,Employee,Job,ID`
- Date `YYYY-MM-DD`; Day = full weekday; times `HH:MM` 24-hour; Total hours = decimal, 2 dp.
- Range picker: This week, Last week, This month, All, Custom.
- iPhone: `navigator.share({ files })` when supported, else download. Mac: download.
- Filename: `timesheet_<YYYY-MM-DD>_to_<YYYY-MM-DD>.csv`. RFC 4180 quoting. UTF-8 with BOM (so Excel reads it correctly).
- Example: `samples/sample-export.csv`.

## Design
- Use the tokens in `design/tokens.css` exactly. Dark only. Accent `#FF7A1A`.
- System font stack only (no web fonts). Counter uses `font-variant-numeric: tabular-nums`.
- Touch targets ≥ 44 px. Respect `prefers-reduced-motion`. Use `env(safe-area-inset-*)` on iPhone.
- Full layout specs, sizes and states: `docs/DESIGN.md`.

## Never
- Add analytics, trackers, third-party CDNs or network-loaded fonts.
- Commit personal data, real timesheets, `server/.env`, the sync key or the Cloudflare tunnel token.
- Add accounts or login screens.
- Change the stack or the CSV columns without asking.

## Workflow
- Work one phase at a time, using the prompts in `KICKOFF.md`. At the end of each phase, stop and list exactly what Jason should test on his iPhone and Mac.
- Keep modules small: `store.js`, `timer.js`, `history.js`, `csv.js`, `ui.js`, `sync.js`, plus `format.js`, `settings.js`, `sheets.js`, `swipe.js`, `app.js`.
- Bump `VERSION` in `sw.js` whenever an app file changes, and list any new app file in its `ASSETS`.
- Put date/hours/CSV formatting in pure functions and test them with `node --test` (no dependencies).
- Use clear commit messages, one commit per meaningful step.

## Definition of done (Phases 1–2)
- Installs on iPhone home screen and Mac Dock; opens full screen with the app icon.
- Works offline (Airplane Mode) after the first load.
- Timer is correct after force-quitting mid-shift and reopening.
- History matches the mockup; week and day totals are correct.
- CSV opens correctly in Numbers, Excel and Google Sheets.
