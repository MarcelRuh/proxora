# Database

PostgreSQL via Prisma (`prisma/schema.prisma`).

## Models

- `User` — manager accounts, bcrypt hash, optional encrypted TOTP secret
- `Role` — permission string array, `isSystem` flag
- `Session` — hashed token, expiry, IP, user agent
- `Host` — URL, auth type, **encrypted** API secret, connection state, version metadata
- `UserHostAccess` — optional host allow-list
- `AuditLog` — append-only from the API (no update/delete routes)
- `Setting` — JSON documents
- `NotificationChannel` — encrypted provider config
- `Job` — update queue (`WAITING` / `RUNNING` / `SUCCESS` / `FAILED`)

## Secrets

`encryptedSecret` uses AES-256-GCM (`lib/crypto.ts`) with `ENCRYPTION_KEY`.
Notification webhook URLs are encrypted the same way.

Never log decrypted values. Prisma queries selected for the UI omit hashes and ciphertext.

## Migrations

```bash
npx prisma migrate dev
npx prisma migrate deploy   # production
npx prisma db seed
```
