#!/bin/sh
set -e
cd /app

PRISMA="node ./node_modules/prisma/build/index.js"
TSX="node ./node_modules/tsx/dist/cli.mjs"

if [ ! -f ./node_modules/prisma/build/index.js ]; then
  echo "ERROR: prisma package missing in image (node_modules/prisma)" >&2
  ls -la ./node_modules/prisma 2>/dev/null || true
  exit 1
fi
if [ ! -f ./node_modules/tsx/dist/cli.mjs ]; then
  echo "ERROR: tsx package missing in image" >&2
  exit 1
fi
if [ ! -f ./dist/server.cjs ]; then
  echo "ERROR: compiled custom server missing (dist/server.cjs)" >&2
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set" >&2
  exit 1
fi

echo "Generating Prisma client…"
$PRISMA generate

echo "Waiting for database and applying migrations…"
i=0
while [ "$i" -lt 30 ]; do
  if $PRISMA migrate deploy; then
    break
  fi
  i=$((i + 1))
  echo "prisma migrate deploy failed, retry $i/30…"
  sleep 2
done
if [ "$i" -ge 30 ]; then
  echo "ERROR: prisma migrate deploy failed after 30 attempts" >&2
  exit 1
fi

echo "Seeding…"
$TSX prisma/seed.ts

echo "Starting Proxora on 0.0.0.0:${PORT:-3000}"
# Do not start Next.js via tsx: its CJS transformer breaks AsyncLocalStorage in Next 16.
exec node dist/server.cjs
