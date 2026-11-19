# Kickoff prompts — paste one phase at a time

## Phase 1 — Core app (timer, history, CSV, installable)

```text
Read CLAUDE.md, then docs/SPEC.md, docs/DESIGN.md and docs/DECISIONS.md. Open design/mockup.html
and design/mac-reference.html to see the target look and behaviour.

Build Phase 1 only:
- Installable PWA (manifest, service worker, icons) that works offline after first load
- Timer tab: orange START, counter from 00:00:00, press-and-hold FINISH (1 s), restore running
  timer after force-quit
- History tab: grouped by week, rows "Mon 16 Nov | 8:00 am | 5:00 pm | 9.00 h", day totals,
  week totals
- CSV export with the exact columns in CLAUDE.md
- IndexedDB storage
- node --test unit tests for date, hours and CSV formatting
- GitHub Actions workflow that deploys to GitHub Pages

Use design/tokens.css exactly. No sync, no editing, no settings yet.
When done, give me the exact steps to publish to GitHub Pages and install on my iPhone and Mac,
and a test checklist.
```

## Phase 2 — Polish and editing

```text
Phase 2: polish and editing.
- Edit sheet when a History row is tapped (start/end, job, employee) → edited: true
- Soft delete with 5 s Undo toast (swipe-left on iPhone, delete button on Mac)
- "Keep or discard?" for shifts under 60 s
- Settings tab per docs/SPEC.md (12/24 h, week start, rounding, show/hide job + employee labels,
  device name)
- Mac layout: Timer and History side by side at widths >= 900 px (see design/mac-reference.html)
- Motion polish per docs/DESIGN.md, respecting prefers-reduced-motion
- App icon + splash in the brand colours
Then give me a full-day test checklist, including one shift in Airplane Mode and one force-quit.
```

## Phase 3 — Sync (built: own server + Cloudflare Tunnel; see docs/SYNC.md and server/README.md)

Original Google Sheets prompt, kept for reference:

```text
Phase 3: Google Sheets sync per docs/SYNC.md.
- Write apps-script/Code.gs (bound to a Sheet) with the exact API contract
- Give me step-by-step instructions to create the Sheet, paste the script, set the TOKEN script
  property, and deploy it as a web app (Execute as: Me, Who has access: Anyone)
- Add js/sync.js: push unsynced entries, pull changes since the last sync, last-write-wins on
  updatedAt, soft deletes respected
- Settings: endpoint URL + token fields, "Sync now" button, last-synced time
- Never commit the token
Test with curl first, then on both devices.
```

## Phase 5 — Staff: multiple users + owner Team view (built)

```text
Phase 5: staff. Read docs/MULTI-USER.md (plan + decisions) first.
- Server: users table (owner/staff), personal keys (hashed), admin.mjs add/list/revoke/new-key,
  every shift tied to its user, staff only see their own, edit history, week locking,
  server receive-times with clock-drift flag, owner-only /api/team/* endpoints,
  monthly backups kept indefinitely. Migrate: current SYNC_TOKEN becomes the owner key.
- App: Employee auto-filled from the user's name; padlock on locked weeks; About text on what's stored.
- Owner app: Team tab (iPhone) / pane (Mac): week table per person (Mon–Sun + total), drill into a
  person's shifts with edit history and clock flags, who's clocked in now, lock weeks, CSV export
  for everyone or one person.
- Tests for user isolation (staff can never read or change another's shift), locking and history.
Then give me the server upgrade steps and a test checklist using a test staff key on a second device.
```

## Phase 4 — Native upgrade (only if needed later)

```text
Port the app to a native SwiftUI multiplatform app (iOS + macOS) with SwiftData + CloudKit,
a Live Activity for the running timer, and the same data model, CSV format and design tokens.
Keep the PWA working in parallel. (Requires the paid Apple Developer Program.)
```
