# Decisions

## Made
| Decision | Choice | Why |
| --- | --- | --- |
| Platform | Installable PWA (iPhone home screen + Mac Dock) | Free, one codebase, no App Store, nothing expires |
| Storage | On-device IndexedDB | Works offline; no server needed |
| Cross-device sync | Optional Google Sheets via Apps Script (Phase 3) | Free; iCloud needs the paid Apple Developer Program |
| Licence / hosting | MIT, public GitHub repo, GitHub Pages | Open source, free hosting |
| Finish interaction | Press and hold 1 s | Prevents accidental shift ends; switch to tap + Undo if it feels slow |
| Accent / theme | Dark only, #FF7A1A orange | Per brief: premium, dark, large orange Start |

## Defaults chosen — confirm or change (Jason)
| Question | Default used | Alternatives |
| --- | --- | --- |
| Deduct breaks? | **No** — 8 am to 5 pm = 9.00 h (matches the brief's example) | Pause/Resume button, or auto-deduct 30 min on shifts > 5 h |
| Rounding | None (exact minutes) | Nearest 5 or 15 min |
| Job & employee labels | Hidden by default | Shown |
| Week start | Monday | Sunday |
| Time format in app | 12-hour (8:00 am) | 24-hour |
| Time format in CSV | 24-hour HH:MM (sorts and calculates cleanly) | 12-hour |
| Sync from day one? | No — ship Phase 1–2 first | Build Phase 3 straight after |
