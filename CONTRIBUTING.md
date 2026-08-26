# Contributing

Thanks for helping with Proxora.

## Ground rules

- TypeScript, no `any` unless a Proxmox payload is truly untyped
- Call Proxmox only through `server/proxmox`
- Do not read/write Prisma from React components
- Do not put secrets in logs, the UI, or git
- Destructive actions need a confirmation dialog **and** `confirm: true` on the API
- A single unreachable host must never fail the whole request

## Workflow

```bash
npm install
npx prisma migrate dev
npm run lint
npm run typecheck
npm test
```

Open a PR against `main`. CI runs lint, typecheck, tests and build.
