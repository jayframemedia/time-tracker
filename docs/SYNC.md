# Phase 3 — Sync between devices

The iPhone and Mac share one history through a small sync server you run yourself (`server/`). It runs in Docker on your own Ubuntu server, behind a Cloudflare Tunnel at `https://time.jayframemedia.com.au`. Setup steps: `server/README.md`.

There are no accounts or logins. Each device holds a long shared **sync key** and sends it as `Authorization: Bearer <key>`. The key is kept in the server's `.env` file and in each device's Settings, never in the repo.

```
iPhone app ─┐                      Cloudflare            your server (Docker)
            ├─ HTTPS ─► time.jayframemedia.com.au ─tunnel─► cloudflared ─► sync:8787 ─► SQLite
Mac app ────┘
```

## API (`server/server.mjs`)

| Request | Response |
| --- | --- |
| `GET /health` (no auth) | `ok` |
| `GET /api/ping` | `{ ok: true, serverTime }`, used to check the address and key |
| `POST /api/entries` `{ entries: [entry, …] }` | `{ ok, upserted, skipped, serverTime }` |
| `GET /api/entries?since=<cursor>` | `{ ok, entries, cursor, more, serverTime }`, up to 1000 per page, **own shifts only** |
| `GET /api/team/entries?from&to` (owner) | `{ ok, users, entries (with userId, clockSkewMs, original), running, lockBefore }` |
| `POST /api/team/entries` (owner) | correct anyone's existing shift |
| `POST /api/team/lock { before }` (owner) | lock staff edits to shifts before a date (`null` unlocks) |

Since Phase 5, every reply also includes `user: { name, role }` and `lockBefore`. A push reply also has `rejected` (ids) and `restore` (the server's copy, for the device to take back). The optional `X-Client-Time` header lets the server record how far off a phone's clock is.

**Users (Phase 5):** each person has a personal key. Keys are stored only as hashes, and the original `SYNC_TOKEN` becomes the owner's key. Staff can only read and write their own shifts. Every accepted write is also kept in a `versions` table. Details: `docs/MULTI-USER.md`.

Errors are `{ ok: false, error: "bad_token" | "bad_request" | "bad_entry" | "too_large" | "not_found" | "server_error" }`.

- **Last write wins:** an upsert replaces the stored copy only if the incoming `updatedAt` is newer. On a tie, the stored copy stays.
- **Cursor, not timestamps:** every accepted write gets the next server sequence number, and clients pull "everything after the cursor I last saw". A device with a wrong clock can therefore never make the other device miss a change.
- **Soft deletes:** these travel as `deleted: true`. Rows are never removed.
- **Validation:** only the entry fields in CLAUDE.md are stored; anything else is dropped. Limits: 5000 entries per upload, 2 MB per request.
- **Who can call it:** CORS allows only the app's origin (`ALLOWED_ORIGINS`). No ports are published; the only way in is the tunnel.

## App (`js/sync.js`)

- **Push:** each entry keeps a local-only `syncedAt` (the `updatedAt` it was last synced at). Entries where `syncedAt ≠ updatedAt` are uploaded in batches of 500. `syncedAt` never leaves the device.
- **Pull:** the app fetches everything after `tt.sync.cursor` and merges by `id`; the newest `updatedAt` wins.
- **When it syncs:**
  - on launch;
  - when the app comes back to the foreground or back online;
  - every 30 s while open;
  - right after Start / Finish / Discard;
  - shortly after any edit, delete, Undo or label change;
  - when you tap **Sync now**.
- **Offline:** nothing is lost. Changes stay unsynced and go up next time.
- **Running timer across devices:**
  - Start on one device and the other shows it running, so you can finish it from either.
  - If both devices started a shift while offline, a red "Another shift is running" notice offers to discard the extra one.
- **Settings → Sync between devices** sets the server address and sync key. It also offers Sync now and Turn off sync, and shows "On · synced 2 min ago" with a status dot.
  - Connecting re-sends everything on that device, so your existing separate histories merge.
- **Config** (`tt.sync`), **cursor** and **status** live in localStorage, alongside the other settings.

## Tests

- `tests/server.test.js` starts a real server on a temporary database. It covers auth, CORS, last-write-wins, the cursor with a slow clock, deletes, paging, validation and backups.
- `tests/sync.test.js` covers the app-side helpers.
