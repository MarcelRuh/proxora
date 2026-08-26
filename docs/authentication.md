# Authentication

Proxora has its **own** user database. Proxmox PAM users are not reused for the web UI.

## Login

`POST /api/auth/login` with `{ username, password }`.

- Passwords are hashed with **bcrypt** (12 rounds).
- A random session token is generated and stored as **SHA-256** in `Session`.
- The raw token is set as the httpOnly `pm_session` cookie (`SameSite=Lax`, `Secure` in production).
- Login is rate-limited (8 attempts / 15 minutes / IP).
- Success and failure are written to the audit log (`LOGIN_SUCCESS` / `LOGIN_FAILED`).

## Session validation

API routes load the cookie, hash it, and join `User` + `Role` + `UserHostAccess`. Disabled users cannot obtain a session.

`proxy.ts` redirects anonymous page requests to `/login`. APIs still perform a full database check.

## CSRF

Mutating requests with an `Origin` header must match the request `Host` / `X-Forwarded-Host` (LAN IP access), `APP_URL`, or a comma-separated `APP_ALLOWED_ORIGINS` list.

## Logout

`POST /api/auth/logout` deletes the server session and the cookie.

## Bootstrap

`prisma db seed` creates system roles and the admin from:

```
BOOTSTRAP_ADMIN_USERNAME
BOOTSTRAP_ADMIN_PASSWORD
BOOTSTRAP_ADMIN_EMAIL
```

Change the default password immediately after first login.
