# Sync server — setup on your Ubuntu server

A small Docker setup that lets your iPhone and Mac share one history.

- **`sync`**: a tiny Node service (no npm packages) that stores shifts in one SQLite file.
- **`tunnel`**: Cloudflare's connector. It links `time.<your domain>` to `sync`.

**Nothing is exposed on your server.** No ports are opened. Your website and CyberPanel/OpenLiteSpeed are not touched. Cloudflare handles HTTPS.

**Before you start:** the Cloudflare tunnel must exist, with a published application routing `time.<your domain>` → `http://sync:8787`, and you need its token (starts `eyJ…`). The service **must** be named `sync` on port `8787`; the compose file already does this.

Run the commands below over SSH as `root`, or prefix them with `sudo`.

## 1. Install Docker (skip if `docker compose version` already works)

```bash
docker compose version
```

If that fails, install Docker Engine with Docker's official script:

```bash
curl -fsSL https://get.docker.com -o /tmp/get-docker.sh && sh /tmp/get-docker.sh
```

Then check again with `docker compose version`.

> **CSF firewall:** if CyberPanel uses CSF, set `DOCKER = "1"` in `/etc/csf/csf.conf` and run `csf -r`. Without it, containers can't reach Cloudflare.

## 2. Get the code

```bash
git clone https://github.com/jayframemedia/time-tracker.git /opt/time-tracker
```

```bash
cd /opt/time-tracker/server
```

## 3. Add your secrets

```bash
cp .env.example .env && chmod 600 .env
```

Generate a sync key, and copy what it prints:

```bash
openssl rand -base64 32 | tr -d '/+=\n'; echo
```

Edit `.env`:

```bash
nano .env
```

- `SYNC_TOKEN=`: paste the key you just generated.
- `TUNNEL_TOKEN=`: paste the Cloudflare tunnel token.
- Leave `ALLOWED_ORIGINS` as it is (`https://timetracker.jayframemedia.com.au,https://jayframemedia.github.io`).

Save with Ctrl+O, Enter, then Ctrl+X. **Never commit or share `.env`.**

## 4. Start it

```bash
docker compose up -d --build
```

```bash
docker compose ps
```

Both `sync` and `tunnel` should be running, with `sync` marked `(healthy)`. Check that the tunnel connected:

```bash
docker compose logs tunnel | grep -i "registered tunnel connection"
```

In Cloudflare (Zero Trust → Networks → Tunnels), the tunnel should now say **Healthy**.

## 5. Test it from anywhere

```bash
curl https://time.jayframemedia.com.au/health
```

This should print `ok`.

## 6. Connect your devices

On the iPhone and the Mac, open **Settings → Sync between devices** and enter:

- **Server address:** `https://time.jayframemedia.com.au`
- **Sync key:** the `SYNC_TOKEN` value. Universal Clipboard is handy here: copy it on the Mac, paste it on the iPhone.

Tap **Connect**. Each device uploads its shifts and downloads the other's.

## Staff

Everyone gets their own **personal key**. The owner's key is the original `SYNC_TOKEN`.

| To | Run (in `/opt/time-tracker/server`) |
| --- | --- |
| Add someone | `docker compose exec sync node admin.mjs add "Sam Smith"` (prints their key once) |
| See everyone | `docker compose exec sync node admin.mjs list` |
| Someone leaves | `docker compose exec sync node admin.mjs revoke "Sam Smith"` (their hours are kept) |
| Lost key | `docker compose exec sync node admin.mjs new-key "Sam Smith"` |
| Fix a name | `docker compose exec sync node admin.mjs rename "Owner" "Jason"` |
| Remove a former staff member's old records | `docker compose exec sync node admin.mjs purge "Sam Smith" --before 2019-07-01`. This only shows what it would delete; add `--yes` to do it. It only works for revoked staff, and backup copies keep the data until they're removed. |

Give each key to the person privately. They install the app from https://timetracker.jayframemedia.com.au, open **Settings → Sync between devices**, and enter `time.jayframemedia.com.au` and their key.

## 7. Nightly backups, kept on the server and in Cloudflare R2

`backup.mjs` keeps 14 daily copies plus one copy per month (kept indefinitely, for record keeping) inside the Docker volume. The `offsite` service then copies them to a **private Cloudflare R2 bucket**, so losing the server doesn't lose the backups.

**One-off R2 setup (Cloudflare dashboard):**
1. **R2 Object Storage → Create bucket**, named `time-tracker-backups`. Leave it private (no public access).
2. **R2 → Manage API tokens → Create API token**:
   - **Permissions:** *Object Read & Write*.
   - **Specify bucket:** `time-tracker-backups` only.
   - **TTL:** forever.
   - Copy the **Access Key ID**, the **Secret Access Key**, and your **Account ID** (shown on the R2 overview page).
3. On the server, add them to `.env` with `nano .env`. Never commit or share them.
   ```
   R2_ACCOUNT_ID=…
   R2_ACCESS_KEY_ID=…
   R2_SECRET_ACCESS_KEY=…
   R2_BUCKET=time-tracker-backups
   ```
4. Optional, to keep R2 tidy: in the bucket's **Settings → Object lifecycle rules**, delete objects with prefix `backups/sync-` after 60 days. The monthly copies live under `backups/monthly/` and aren't affected.

**Test it once:**

```bash
cd /opt/time-tracker/server && docker compose exec -T sync node backup.mjs && docker compose run --rm offsite
```

```bash
docker compose run --rm offsite lsf -R r2:time-tracker-backups/backups
```

The second command should list today's `sync-YYYY-MM-DD.db` and `monthly/sync-YYYY-MM.db`.

**Schedule it:**

```bash
crontab -e
```

Replace any earlier Time Tracker line with this one (nightly at 3:15 am, server time):

```
15 3 * * * cd /opt/time-tracker/server && { docker compose exec -T sync node backup.mjs && docker compose run --rm offsite; } >> /var/log/time-tracker-backup.log 2>&1
```

## Checking and restoring backups

**Check a backup.** This reads it without changing anything, and shows integrity, people and shift counts:

```bash
cd /opt/time-tracker/server && docker compose exec sync ls /data/backups /data/backups/monthly
```

```bash
docker compose exec sync node verify-backup.mjs /data/backups/sync-2026-11-19.db
```

**Restore one.** This replaces the live data with the backup:

1. Take a safety copy of what's there now:
   ```bash
   docker compose exec -T sync node backup.mjs
   ```
2. Stop the sync service:
   ```bash
   docker compose stop sync
   ```
3. Put the backup in place. Change the date to the backup you want:
   ```bash
   docker compose run --rm --no-deps --entrypoint sh sync -c 'cp /data/backups/sync-2026-11-19.db /data/sync.db && rm -f /data/sync.db-wal /data/sync.db-shm'
   ```
4. Start it again and check:
   ```bash
   docker compose start sync && sleep 15 && docker compose exec sync node admin.mjs list
   ```
5. **On every device:** open **Settings → Sync between devices → Save and sync**. This re-sends anything the device has that's newer than the backup. Without it, those changes stay only on that device.

**Restore from R2** (if the server itself was lost). Set up the server again (steps 1–4 above, same `.env`), then download a backup and copy it into the volume:

```bash
mkdir -p /opt/time-tracker/restore && docker compose run --rm -v /opt/time-tracker/restore:/restore offsite copy r2:time-tracker-backups/backups/sync-2026-11-19.db /restore
```

```bash
docker compose cp /opt/time-tracker/restore/sync-2026-11-19.db sync:/data/backups/
```

Then follow "Restore one" from step 2.

## Cloudflare rate limit (recommended)

Free plan, one rule. It slows down anyone hammering the sync server.

1. In Cloudflare, open **jayframemedia.com.au → Security → WAF → Rate limiting rules → Create rule**.
2. **Name:** `time tracker sync`.
3. **If incoming requests match:** Hostname *equals* `time.jayframemedia.com.au`.
4. **Rate:** **100 requests per 10 seconds**, counted per **IP**. That's far above normal use: a device makes about 2 requests per sync, every 30 s.
5. **Then:** **Block** for **10 seconds**. Deploy.

## Keeping the server healthy

These are read-only checks; send me the output if you want a second opinion:

```bash
cat /etc/apt/apt.conf.d/20auto-upgrades 2>/dev/null; systemctl is-active unattended-upgrades; echo "---"; sshd -T 2>/dev/null | grep -E "^(permitrootlogin|passwordauthentication|pubkeyauthentication) "; echo "---"; lsb_release -ds
```

- **Automatic security updates:** both `APT::Periodic` lines should be `"1"`, and the service should be `active`.
- **SSH:** best practice is to sign in with SSH keys and turn off password sign-in (`passwordauthentication no`; `permitrootlogin prohibit-password` or `no`). Set up and **test** key sign-in in a second terminal *before* turning passwords off, so you can't lock yourself out.
- **Ubuntu 22.04's standard support ends in April 2027.** Plan a CyberPanel-supported upgrade before then.

## Updating

The first time you update to the staff version (Phase 5), the database is upgraded automatically. Your existing `SYNC_TOKEN` becomes the owner key and all existing shifts become yours. Add `OWNER_NAME=YourName` to `.env` first, or rename yourself afterwards.

```bash
cd /opt/time-tracker && git pull && cd server && docker compose up -d --build
```

Image versions are pinned in `Dockerfile` and `compose.yaml`. When a Dependabot update has been merged on GitHub, the same command applies it.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `curl …/health` gives a Cloudflare 502/1033 error | Tunnel isn't connected. Check `docker compose logs tunnel`, the token in `.env`, and that the route's service is `http://sync:8787`. |
| The app says "Can't reach the server" | Check the address in Settings (it must be `https://`). Check `ALLOWED_ORIGINS` includes `https://timetracker.jayframemedia.com.au`. If Cloudflare **Bot Fight Mode** is on, add a WAF *Skip* rule for `time.jayframemedia.com.au`. |
| "The sync key is wrong" | That person's key was revoked or mistyped. Run `node admin.mjs new-key "Name"` and give them the new one. |
| Lost the owner key | `docker compose exec sync node admin.mjs new-key "Jason"`, then enter the new key on your devices. `SYNC_TOKEN` in `.env` is only used when the database is first created. |
| `offsite` says access denied | Check the four `R2_` values in `.env`, and that the API token is scoped to the `time-tracker-backups` bucket with Object Read & Write. |

## What's stored

One SQLite file in the `time-tracker_sync-data` Docker volume, holding the same fields as the app (see `docs/SYNC.md`), plus users (names, roles, hashed keys) and the edit history. Backups go to the same volume and to your private R2 bucket. There are no accounts, no analytics, and nothing else.
