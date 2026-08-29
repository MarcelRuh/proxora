# Security Policy

## Reporting

Please report vulnerabilities privately. Do not open a public issue with working exploits against this manager or against Proxmox hosts.

## Hardening checklist

- Change `BOOTSTRAP_ADMIN_PASSWORD` after first login
- Use a 32-byte `ENCRYPTION_KEY` (`openssl rand -hex 32`) and store it outside git
- Put the app behind HTTPS
- Prefer Proxmox API tokens with least privilege over `root@pam` passwords
- Restrict manager users with host allow-lists when needed
- Do not mount `docker.sock` into the Proxora **app** container; only `proxora-updater` gets it for self-update
- Set `REDIS_PASSWORD` in production Compose
- Back up PostgreSQL **and** `ENCRYPTION_KEY` together

## What is stored encrypted

- Proxmox API token secrets / passwords
- Notification channel credentials

Session tokens are stored hashed (SHA-256). Passwords use bcrypt.
