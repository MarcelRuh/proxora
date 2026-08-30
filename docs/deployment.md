# Deployment

## Docker Compose (recommended)

```bash
cp .env.example .env
# set ENCRYPTION_KEY, SESSION_SECRET, BOOTSTRAP_ADMIN_PASSWORD
docker compose -f docker-compose.prod.yml up -d --build
```

Services:

- `proxora` — Next.js + console proxy (`server/index.ts`)
- `postgres` — application database

The entrypoint runs `prisma migrate deploy`, seeds the admin user, then starts the HTTP server on port 3000.

## One-line install / update

```bash
wget -qO- https://raw.githubusercontent.com/MarcelRuh/proxora/main/scripts/install.sh | bash
wget -qO- https://raw.githubusercontent.com/MarcelRuh/proxora/main/scripts/update.sh | bash
```

In-app: **Updates → Proxora self-update**. The UI shows `current → latest` and a live progress bar while Compose rebuilds. Set `PROXORA_INSTALL_DIR` to the host path that contains `docker-compose.yml` (the installer does this automatically).

The app container does **not** mount `docker.sock` and does **not** mount the install tree (so `.env` stays off the app). A sidecar (`proxora-updater`) has the Docker socket and starts the updater only when the app writes `/update-signal/request`. The request file is a trigger, not a command channel — the sidecar runs the local `scripts/self-update-apply.sh`. Compose build cannot run through `docker-socket-proxy` (HTTP 403 on TCP upgrade).

The wget installer prints username and password again in the final summary box. Re-running it keeps `.env` and rebuilds.

## Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL |
| `ENCRYPTION_KEY` | yes | ≥ 32 chars, prefer 64 hex |
| `SESSION_SECRET` | yes | cookie signing / rotation helper |
| `APP_URL` | yes in prod | Canonical public origin. The installer sets `http://<LAN-IP>:3000`. Leave HTTPS URLs untouched (reverse proxy). Cookie `Secure` follows this scheme. |
| `APP_ALLOWED_ORIGINS` | no | Extra CSRF origins, comma-separated |
| `BOOTSTRAP_ADMIN_PASSWORD` | first boot | change after login |
| `NEXT_PUBLIC_WS_URL` | no | only if WS is split |
| `PROXORA_INSTALL_DIR` | for self-update | Host path of the Compose install |
| `PROXORA_UPDATE_SIGNAL_DIR` | Compose | `/update-signal` shared with `proxora-updater` |
| `PROXORA_REPO` | no | default `MarcelRuh/proxora` |

## Reverse proxy

Terminate TLS in Caddy/nginx and forward:

- `/` → `web:3000`
- `/ws/console` with WebSocket upgrade headers

Set `APP_URL` to the public HTTPS origin.

## Backups

Dump PostgreSQL regularly. Losing `ENCRYPTION_KEY` makes stored API tokens unrecoverable — back up the key in a secret manager, not in git.
