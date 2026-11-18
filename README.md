# Time Tracker — starter pack for Claude Code

An open-source, in-house time tracker for iPhone and Mac: a big orange Start button, a timer that counts up, Finish to log the shift, a History tab by day, and CSV export. Google Sheets sync is optional (Phase 3).

## What's in this folder

| File | What it is |
| --- | --- |
| `CLAUDE.md` | The rulebook Claude Code reads automatically: stack, data model, rules, definition of done |
| `KICKOFF.md` | Copy-paste prompts for each build phase |
| `docs/SPEC.md` | Full functional spec: screens, behaviour, edge cases |
| `docs/DESIGN.md` | Visual spec: layout sizes, states, components, Mac layout |
| `docs/DECISIONS.md` | Choices already made (with defaults) and ones still open |
| `docs/SYNC.md` | Phase 3 Google Sheets sync: Apps Script contract |
| `design/tokens.css` | Colours, type, spacing — use exactly |
| `design/mockup.html` | Working iPhone reference prototype — open in a browser |
| `design/mac-reference.html` | Mac layout reference — open in a browser |
| `samples/sample-export.csv` | Exact CSV format the app must produce |

## How to start (on your Mac)

1. Unzip this folder somewhere sensible, e.g. `~/Projects/time-tracker`.
2. Open Terminal in that folder and run:
   ```bash
   git init
   claude
   ```
3. Paste the **Phase 1** prompt from `KICKOFF.md`.
4. When Claude Code finishes a phase, test on your phone and Mac using its checklist, then paste the next phase prompt.

## Before you publish to GitHub

- Create a **public** repo (open source) — GitHub Pages is free for public repos.
- Never commit real timesheets or your Sheets token. `.gitignore` should exclude `*.csv` except `samples/`.

## Installing the app

- **iPhone:** open the GitHub Pages URL in Safari → Share → Add to Home Screen.
- **Mac (macOS 14 Sonoma or later):** open the URL in Safari → File → Add to Dock.

Until Phase 3 sync is on, the iPhone and Mac keep separate histories. Export CSV weekly as a backup.
