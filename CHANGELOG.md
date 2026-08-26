# Changelog

All notable changes to this project are documented here.

## [Unreleased]

## [1.0.7] – 2026-08-27

### Added

- Hosts can be added with Proxmox **root / PAM password** (`root@pam`). The add-host dialog defaults to password auth; `root` is stored as `root@pam`. API tokens remain available.

## [1.0.6] – 2026-08-27

### Fixed

- Session cookie is no longer `Secure` on HTTP. Production + `http://192.168.x.x:3000` previously dropped the cookie in the browser, so login appeared to succeed but never stayed signed in.
- Installer sets `APP_URL` to the machine LAN IP (`http://<ip>:3000`) instead of localhost. HTTPS `APP_URL` (reverse proxy) is left unchanged.

## [1.0.5] – 2026-08-27

### Fixed

- CSRF no longer treats `APP_URL=http://localhost:3000` as the only allowed origin. Login from a LAN IP (`http://192.168.x.x:3000`) is allowed when it matches the request `Host`.

## [1.0.4] – 2026-08-27

### Fixed

- Production start no longer uses `tsx` for the Next.js custom server. The server is compiled with esbuild and started with `node dist/server.cjs`.
- Custom server no longer loads `next/headers` at process boot (WebSocket console used the App-Router session module). That left Next.js without `AsyncLocalStorage` (`Invariant: AsyncLocalStorage accessed in runtime where it is not available`).

## [1.0.3] – 2026-08-27

### Fixed

- Docker `npm ci` failed because Prisma `binaryTargets` used `debian-openssl-3.0` instead of `debian-openssl-3.0.x` (`prisma generate` in postinstall)

## [1.0.2] – 2026-08-26

### Fixed

- Container boot no longer treats the Prisma CLI shim as missing (`-x` on a non-executable `node_modules/.bin` link)
- `prisma migrate deploy` is invoked via `node …/prisma/build/index.js` and retried until Postgres is reachable
- Prisma client `binaryTargets` include `debian-openssl-3.0.x` for the slim Node image

## [1.0.1] – 2026-08-26

### Fixed

- Production bind address: do not use Docker `HOSTNAME` (container id), listen on `0.0.0.0`
- Docker image build: provide dummy `DATABASE_URL` so `next build` / Prisma can compile
- Custom server is incompatible with Next.js `output: "standalone"` – removed
- wget installer waits until `/api/health` is up and prints username + password again at the end

## [1.0.0] – 2026-08-26

### Added

- First public release of **Proxora**, a central control plane for independent Proxmox VE hosts
- Host inventory, VM/LXC lifecycle, create wizards, xterm.js consoles
- Storage and ZFS health, Proxmox APT updates, tasks, audit log, RBAC
- In-app GitHub self-update with version display (`current → latest`) and live progress bar
- wget installer / updater (`scripts/install.sh`, `scripts/update.sh`)
- Docker Compose production stack (web, PostgreSQL, Redis)
- GitHub Actions CI (lint, typecheck, tests, build)
