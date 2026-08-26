# Development

## Requirements

- Node.js 22+
- PostgreSQL 16
- Redis (optional)
- A Proxmox VE host reachable on `:8006` for live tests (not used by unit tests)

## Setup

```bash
cp .env.example .env
# generate ENCRYPTION_KEY: openssl rand -hex 32
npm install
npx prisma migrate dev
npx prisma db seed
npm run dev
```

Open http://localhost:3000 and sign in with `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD`.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Next.js + console WebSocket proxy |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest (mocked Proxmox API) |
| `npm run build` | Production build |

## Mock vs live

Unit tests never contact a real Proxmox node. `undici.fetch` is mocked in `tests/proxmox-client.test.ts`.

There is no production mock-data path. An empty host list is a valid empty state.

## Adding a permission

1. Append the key to `lib/permissions.ts`
2. Update role presets if it is a default grant
3. Enforce it in the matching `apiRoute(...)` handler
