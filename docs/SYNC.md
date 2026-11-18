# Phase 3 — Google Sheets sync

Optional. Lets the iPhone and Mac share one history through a Google Sheet. No Google sign-in in the app: a small Apps Script bound to the Sheet runs as Jason and accepts requests carrying a secret token.

## Sheet
One tab named `Entries`, header row:
```
id | start | end | employee | job | device | edited | deleted | createdAt | updatedAt | hours
```
`hours` is a number the script writes on each upsert: `(end − start)` in hours, 2 dp (blank while running). Computing it in the script avoids fragile Sheets formulas on ISO strings with offsets.
Protect the tab so only the script owner can edit.

## Apps Script (`apps-script/Code.gs`)
- Deployed as a web app: **Execute as: Me**, **Who has access: Anyone**.
- Token stored in **Script Properties** as `TOKEN` (long random string). Never in the repo.
- Wrap writes in `LockService.getScriptLock()`.
- Always return JSON via `ContentService` with `MimeType.JSON`.

### Contract
```
POST  body (Content-Type: text/plain to avoid CORS preflight):
  { "action": "upsert", "token": "…", "entries": [ entry, … ] }
  → { "ok": true, "upserted": 3, "serverTime": "ISO" }

GET   ?action=list&token=…&since=<ISO updatedAt>
  → { "ok": true, "entries": [ entry, … ], "serverTime": "ISO" }

Errors → { "ok": false, "error": "bad_token" | "bad_request" | "…" }
```
- `upsert`: match on `id`; replace the row only if the incoming `updatedAt` is newer (last write wins); otherwise append.
- Soft deletes travel as `deleted: true`; rows are never physically removed.

## Client (`js/sync.js`)
- Keep a `syncedAt` per entry (local only) and a global `lastPull` in localStorage.
- Sync on: app open, after Finish, after edit/delete, and "Sync now".
- Push: entries where `updatedAt > syncedAt`. Pull: `since = lastPull`. Merge by `id`, newest `updatedAt` wins.
- Apps Script replies to POST with a 302 redirect; `fetch` follows it by default. Offline → queue silently and retry next time.
- Settings: endpoint URL, token, Sync now, "Last synced 2 min ago", status dot.

## Test
`curl` the endpoint for upsert/list with good and bad tokens before wiring the UI.
