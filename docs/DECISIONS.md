# Decisions

## Made
| Decision | Choice | Why |
| --- | --- | --- |
| Platform | Installable PWA (iPhone home screen + Mac Dock) | Free, one codebase, no App Store, nothing expires |
| Storage | On-device IndexedDB | Works offline; no server needed |
| Cross-device sync | Own sync server (Node + SQLite in Docker) behind a Cloudflare Tunnel at time.jayframemedia.com.au — replaces the earlier Google Sheets plan | Instant, data stays on Jason's server, no ports opened, no change to the CyberPanel website; iCloud needs the paid Apple Developer Program |
| Licence / hosting | MIT, public GitHub repo, GitHub Pages | Open source, free hosting |
| Finish interaction | Press and hold 1 s | Prevents accidental shift ends; switch to tap + Undo if it feels slow |
| Accent / theme | Dark only, #FF7A1A orange | Per brief: premium, dark, large orange Start |
| Hours precision | Whole clock minutes (seconds ignored) | Hours always match the HH:MM times shown and exported: 08:00 → 17:00 is exactly 9.00 h |
| Rounding method | Each clock-in and clock-out is rounded to the nearest 5 or 15 min, then hours are worked out from the rounded times | Shown times and hours always agree; stored times are never changed, so turning rounding off restores the exact times |
| Edited flag | Set only when clock-in or clock-out is changed by hand; job/employee edits don't set it | Matches the data model: `edited` means the times were changed after Finish |
| Short shifts | Under 60 s asks "Keep or discard?"; Discard soft-deletes; closing the prompt leaves the timer running | Avoids accidental zero-length shifts without losing a real one |
| Mac history | Repeats the date on every row (as in the Mac reference) and adds a Day total row for multi-shift days (as in CLAUDE.md) | Follows both references |
| Sync cursor | Server sequence numbers, not timestamps, decide what to pull | A device with a wrong clock can't cause the other to miss changes; last-write-wins still uses `updatedAt` |
| Two shifts running | Shown as a red notice with "Discard it" rather than auto-resolved | Only happens if both devices start offline; Jason decides which is real |
| Offline updates | Service worker caches a versioned copy; bump `VERSION` in `sw.js` on every release | Installed apps update on the next launch after a deploy |

## Defaults chosen — confirm or change (Jason)
| Question | Default used | Alternatives |
| --- | --- | --- |
| Deduct breaks? | **No** — 8 am to 5 pm = 9.00 h (matches the brief's example) | Pause/Resume button, or auto-deduct 30 min on shifts > 5 h |
| Rounding | None (exact minutes) | Nearest 5 or 15 min |
| Job & employee labels | Hidden by default | Shown |
| Week start | Monday | Sunday |
| Time format in app | 12-hour (8:00 am) | 24-hour |
| Time format in CSV | 24-hour HH:MM (sorts and calculates cleanly) | 12-hour |
| Sync from day one? | No — shipped Phase 1–2 first; Phase 3 built after | — |
