# Changelog

All notable changes to this project are documented here.

## [Unreleased]

## [1.0.19] – 2026-08-27

### Added

- Host package lists refresh automatically every 3 hours. When new updates appear, Proxora shows a banner, a sidebar badge, a toast, and (if configured) Discord/webhook notifications.

## [1.0.18] – 2026-08-27

### Changed

- Guest config also hides CPU-Units (`cpuunits`).

## [1.0.17] – 2026-08-27

### Fixed

- Host updates no longer call the nonexistent Proxmox path `/apt/upgrade`. Package lists refresh via `apt update` and wait for the task; applying updates opens the same node upgrade shell as the PVE GUI.
- Guest config no longer shows CPU type (`host`) or CPU limit.

## [1.0.16] – 2026-08-27

### Changed

- Guest config is split into CPU/RAM, Allgemein, Disks, Mountpoints, Netzwerk.
- LXC bind-mounts match `pct set <id> -mp0 /host/dir,mp=/container/mount/point`. Storage volumes remain a second mount type.

## [1.0.15] – 2026-08-27

### Changed

- Guest detail is one page (no tabs). Power buttons follow running/stopped state. LXC config can add `mpN` mountpoints.

## [1.0.14] – 2026-08-27

### Changed

- VM/LXC detail shows live CPU, RAM, disk and network usage. Config is a form for cores, memory, disks, NICs and all other Proxmox keys — not JSON.

## [1.0.13] – 2026-08-27

### Changed

- Dashboard guest table includes the host. Host cards show cores plus RAM and storage as used/total sizes (GB/TB), not only percentages.

## [1.0.12] – 2026-08-27

### Changed

- Dashboard shows one ID-sorted list of all VMs and LXC (smallest ID first). Self-update moved to Settings → Proxora. Recent activity removed from the dashboard.

## [1.0.11] – 2026-08-27

### Fixed

- Host connections are re-probed on startup so a self-update no longer leaves hosts stuck in ERROR.
- ENCRYPTION_KEY is read at runtime (not inlined at Docker build). Decrypt failures show a clear credential error instead of OpenSSL noise.

## [1.0.10] – 2026-08-27

### Fixed

- Self-update prunes unused Docker images, stopped containers, and build cache **before** (and after) the rebuild, and aborts if less than 4 GB is free.

## [1.0.9] – 2026-08-27

### Fixed

- Confirm dialogs (self-update and others) close immediately after confirmation instead of staying open until the action finishes.

## [1.0.8] – 2026-08-27

### Fixed

- Self-update no longer reports an update when the running version matches GitHub (git SHA drift is ignored).

### Added

- Dashboard lists every VM and CT ID (with name, host, status).
- ZFS page shows per-disk green/amber/red status and a pool summary (“Alle Platten grün”).

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
