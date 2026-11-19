# Security and privacy

How Time Tracker protects data, and what still depends on you. Reviewed 2026-11-19.

## App (https://timetracker.jayframemedia.com.au)
- **Code only from this app.** A Content Security Policy (in `index.html`) blocks code from anywhere else; inline scripts and styles are banned too.
  - The app may only talk to itself and the sync server.
  - `tests/pwa.test.js` fails if anything breaks the policy.
- **Everything shown is made safe.** Shift details, names and labels are escaped before display, so typed text can't run as code.
- **No analytics, trackers, ads, third-party scripts or web fonts.** No referrer is sent.
- **On the device:** shifts live in the browser's local storage for this app (IndexedDB). The device's own encryption and passcode protect them. The sync key is kept in the app's settings on that device.
- **CSV exports** add an apostrophe in front of any job or employee text that looks like a spreadsheet formula, so it can't run when the file is opened in Excel, Sheets or Numbers.

## Sync server (https://time.jayframemedia.com.au)
- **No open ports.** The only way in is the Cloudflare Tunnel. HTTPS ends at Cloudflare, which means Cloudflare can technically see the traffic. That's normal for any Cloudflare-fronted site.
- **Personal keys:** every request needs one. They're 256-bit random values, stored only as SHA-256 hashes, and can be revoked instantly with `admin.mjs revoke`.
- **Staff isolation is enforced on the server.** Staff can only read and write their own shifts; owner-only endpoints refuse everyone else. Tests check this.
- **Input checks:** uploaded shifts are validated and limited (5000 per upload, 2 MB per request). Database queries are never built from user text.
- **Response headers:** CORS is limited to the app's address. HSTS, `nosniff`, `DENY` framing, no referrer, `no-store` caching, and a CSP that allows nothing.
- **Container:** runs as a non-root user and has a health check. Images and GitHub Actions are pinned to exact versions, and Dependabot proposes updates.
- **Logs** record the request type, path and result, with no IP addresses, keys or shift details.
- **Rate limiting** is done by a Cloudflare rule (see `server/README.md`).

## Data, history and backups
- **Nothing is truly deleted.** Deletes only hide a shift, and every version of every shift is kept, so the owner sees any changes.
- **Backups:** every night there's a copy in the server volume (14 daily, plus monthly copies kept indefinitely). Those copies also go to a private Cloudflare R2 bucket (`docker compose run --rm offsite`).
- **Checking and restoring:** `verify-backup.mjs` checks a backup without changing it. The restore steps are in `server/README.md`.
- **Uptime:** `.github/workflows/uptime.yml` checks the app and server every 30 minutes and emails on failure.

## Privacy for staff
- Staff see in Settings what's stored (shift times, job labels, device name) and that the owner can see and correct them.
- Only the owner's Team view shows other people's shifts. It loads live and doesn't store them on the owner's devices.
- **Record keeping** (not legal advice): Fair Work generally requires hours records to be kept for 7 years and given to the employee on request. Export a person's CSV from Team for that.

## Known open items
- **SSH (checked 2026-11-19):** the server still allows root sign-in with a password (`permitrootlogin yes`, `passwordauthentication yes`). Automatic security updates are on. Recommended when convenient:
  1. Create an SSH key on the Mac and copy it to the server.
  2. Test that key sign-in works.
  3. Then set `PasswordAuthentication no` and `PermitRootLogin prohibit-password` in `/etc/ssh/sshd_config.d/00-hardening.conf`. The file name must sort before `50-cloud-init.conf`.
  Steps: `server/README.md` → Keeping the server healthy.

## Your part
- **Keep secrets safe:** keep `.env` (keys, tunnel token, R2 credentials) and SSH access to the server private. Hand out staff keys privately.
- **Keep the server updated:** automatic security updates on, SSH keys rather than passwords, and an Ubuntu upgrade before April 2027 (`server/README.md` → Keeping the server healthy).
- **Review Dependabot updates** and merge them; for server images, update the server afterwards.
- **Test a restore once a year.**
