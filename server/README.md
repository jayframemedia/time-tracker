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

## 7. Nightly backup (recommended)

```bash
crontab -e
```

Add this line. It keeps 14 daily copies inside the Docker volume:

```
15 3 * * * cd /opt/time-tracker/server && docker compose exec -T sync node backup.mjs >> /var/log/time-tracker-backup.log 2>&1
```

To copy the backups out of the container:

```bash
cd /opt/time-tracker/server && docker compose cp sync:/data/backups ./backups
```

## Updating

```bash
cd /opt/time-tracker && git pull && cd server && docker compose pull tunnel && docker compose up -d --build
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `curl …/health` gives a Cloudflare 502/1033 error | Tunnel isn't connected. Check `docker compose logs tunnel`, the token in `.env`, and that the route's service is `http://sync:8787`. |
| The app says "Can't reach the server" | Check the address in Settings (it must be `https://`). Check `ALLOWED_ORIGINS` includes `https://timetracker.jayframemedia.com.au`. If Cloudflare **Bot Fight Mode** is on, add a WAF *Skip* rule for `time.jayframemedia.com.au`. |
| "The sync key is wrong" | The key in Settings must match `SYNC_TOKEN` exactly. After changing `.env`, run `docker compose up -d`. |
| Changing the key | Edit `SYNC_TOKEN`, run `docker compose up -d`, then enter the new key on each device. |

## What's stored

One SQLite file in the `time-tracker_sync-data` Docker volume, holding the same fields as the app (see `docs/SYNC.md`). There are no accounts, no analytics, and nothing else.
