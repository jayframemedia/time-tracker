# Phase 5 — Staff (multiple users) — plan

**Goal:** each staff member tracks their own hours on their own phone. Jason (the owner) sees everyone's hours, checks edits, and exports CSV.

**Not needed:** payroll integration, login screens, email accounts.

## How it works

- **No logins.** Each person has their own **personal key**.
  - Jason creates it on the server and gives it to them privately.
  - They enter the address and their key once, in Settings → Sync, exactly as Jason did.
- **The server knows who each key belongs to.** It stores whose every shift is, and staff only ever receive their own shifts back.
- **Roles:**
  - **owner:** Jason.
  - **staff:** everyone else.
- **Jason keeps his existing key and history.** On upgrade, the current `SYNC_TOKEN` becomes the owner's key, so nothing changes on his devices.

## Server changes (`server/`)

1. **Users table.** Fields: `id`, `name`, `role` (owner/staff), the key's hash (keys are never stored in plain text), created date, and revoked date.
2. **Admin commands** (run over SSH):
   - `docker compose exec sync node admin.mjs add "Sam Smith"`: creates a staff member and prints their key once.
   - `… list`: names, roles, last sync time, number of shifts.
   - `… revoke "Sam Smith"`: the key stops working immediately, and their shifts are kept.
   - `… new-key "Sam Smith"`: replaces a lost key.
3. **Every shift is tied to a person.** The server records which key uploaded each shift. A person can never change someone else's shift, even by guessing an ID.
4. **Edit history.** Every version of every shift is kept, so Jason can see the original times next to any change.
5. **Week locking.** Jason can lock all weeks up to a date (e.g. "everything before this Monday").
   - The server then refuses staff edits or deletes on locked shifts.
   - Jason can still correct them.
6. **Server timestamps.** The server notes when it first received each Start and Finish. If a phone's clock looked wrong by more than 5 minutes, the shift is flagged for Jason.
7. **Owner-only endpoints:**
   - `GET /api/team/summary?from&to`: hours per person per day.
   - `GET /api/team/entries?from&to&user`: shifts with their edit history.
   - `POST /api/team/lock`: lock weeks.
8. **Record keeping.**
   - Shifts are never physically deleted. "Delete" stays a soft delete, so the history survives.
   - Backups: 14 daily copies **plus one monthly copy kept indefinitely** (a few MB a year).
   - A monthly "download all" reminder for an off-server copy.

## App changes

- **Staff app:**
  - The same app as now; their name fills the Employee column automatically.
  - Locked weeks show a padlock and can't be edited.
  - The Settings → About text explains what's stored and that Jason can see it.
- **Owner app:** a new **Team** tab (iPhone) and **Team** pane (Mac). It loads live from the server, so it needs a connection, and other people's shifts aren't stored on Jason's devices.
  - **This week / last week / pick a week:** a table with one row per person, columns Mon–Sun and a total.
  - **Tap a person:** their shifts, with an "edited" badge showing original → new times, plus a flag if a phone clock looked wrong.
  - **Who's clocked in now.**
  - **Lock weeks up to…**
  - **Export CSV:** everyone or one person, any range. The format is the same 8 columns, with Employee filled in.

## Onboarding a new staff member

1. Over SSH, run `node admin.mjs add "Name"` and copy the key it prints.
2. Send the key privately, in person or in a private message, never in a group chat.
3. They open **timetracker.jayframemedia.com.au** in Safari → Add to Home Screen → Settings → Sync between devices, then enter the address and key.
4. When someone leaves, run `revoke`. Their hours stay in your records.

## Things to keep in mind

- **Record-keeping obligations.** Fair Work generally requires employers to keep records of hours worked for 7 years. The monthly archive covers this, but check what applies to your business; this plan isn't legal advice.
- **Privacy.** Staff should know what's recorded (shift times, optional job label, device name) and who sees it (Jason). The app's About text will say so.
- **Trust.** Staff can still fix their own mistakes. Edit history, week locking and clock flags make changes visible rather than impossible.
- **Capacity.** One small server handles dozens of staff comfortably, at no extra cost.

## Decisions for Jason (defaults in bold)

| Question | Default | Alternatives |
| --- | --- | --- |
| Roughly how many staff? | **Under 20** | More (still fine; affects the Team table layout) |
| Can staff edit their own past shifts? | **Yes, until the week is locked**; edits visible to you | View only (you make all corrections) |
| Week locking | **Manual** ("lock up to…") | Automatic, e.g. every Tuesday locks the previous week |
| Job labels for staff | **Hidden** | Shown, with a job list you define |
| Can staff see each other? | **No** | — |
| Team view offline | **No** (always live) | Cached copy on your devices |
