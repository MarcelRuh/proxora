# Architecture

Proxora is a Next.js application that sits in front of any number of **independent** Proxmox VE hosts. It does not assume a Proxmox cluster. Each host is stored in PostgreSQL with encrypted credentials and is contacted through its own Proxmox VE API session.

```
Browser
  │  HTTPS (session cookie)
  ▼
Next.js UI + Route Handlers
    │
    ├── PostgreSQL (users, RBAC, hosts, audit, jobs)
    ├── WebSocket console proxy
    └── WireGuard sidecar (client to the colleague's WG server VM)
          │
          ├── Host A  → Proxmox API :8006
          ├── Host B  → Proxmox API :8006
          └── Peer Proxora (HTTP/WS to the IP you configured) → shared hosts
```

## Layers

| Layer | Path | Responsibility |
| --- | --- | --- |
| UI | `app/(app)`, `components/` | Pages, tables, wizards, xterm.js |
| HTTP API | `app/api/` | Auth, validation, RBAC, CSRF origin check |
| Services | `server/services/` | Hosts, users, dashboard, updates, search, audit |
| Proxmox client | `server/proxmox/` | Official `/api2/json` wrapper |
| Console proxy | `server/ws/` | Termproxy ↔ browser WebSocket |
| Persistence | `prisma/` | PostgreSQL schema |

UI components never call Proxmox or Prisma directly. Route handlers never embed host secrets in responses.

## Host isolation

Dashboard and list endpoints use `Promise.all` / `allSettled` per host. A timeout or TLS error on one host marks that host `ERROR` and continues with the others.

## Connection states

`ONLINE | OFFLINE | CONNECTING | ERROR | MAINTENANCE`

These are stored on the `Host` row and shown as badges. Live telemetry is fetched on demand and polled with TanStack Query (8–15s). High-frequency metrics are not hammered globally.

## Self-update

The Proxora app never receives `docker.sock` or the install checkout. Compose runs `proxora-updater` with the host socket. The app writes `/update-signal/request`; the sidecar starts `proxora-self-updater` with the local apply script, which syncs the latest GitHub **release** (not `main`).

## Extensibility

`server/notifications/providers.ts` is the extension point for additional notifiers. They are registered, not hardcoded into UI tables.
