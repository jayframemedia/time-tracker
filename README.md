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
| `index.html`, `styles.css`, `js/`, `sw.js`, `manifest.webmanifest`, `icons/` | The app |
| `tests/` | `node --test` unit tests |
| `tools/serve.mjs`, `tools/make-icons.mjs` | Local server; icon generator |

## Run it locally

```bash
node tools/serve.mjs
```
Open http://localhost:8080. Run the tests with `node --test tests/` (Node 22+, no installs).

## Publish to GitHub Pages

1. Create a **public** repo on GitHub (e.g. `time-tracker`). Don't add a README or licence there.
2. In this folder:
   ```bash
   git remote add origin https://github.com/<your-username>/time-tracker.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Open the **Actions** tab. The "Test and deploy" run tests the code, then publishes it. When it's green, the app is at `https://<your-username>.github.io/time-tracker/`.

**Releasing a change:** bump `VERSION` in `sw.js` (e.g. `v1` → `v2`), commit and push. Installed copies pick up the new version the next time they're opened.

## Before you publish to GitHub

- Create a **public** repo (open source) — GitHub Pages is free for public repos.
- Never commit real timesheets or your Sheets token. `.gitignore` should exclude `*.csv` except `samples/`.

## Installing the app

- **iPhone:** open the GitHub Pages URL in Safari → Share → Add to Home Screen.
- **Mac (macOS 14 Sonoma or later):** open the URL in Safari → File → Add to Dock.

Until Phase 3 sync is on, the iPhone and Mac keep separate histories. Export CSV weekly as a backup.
