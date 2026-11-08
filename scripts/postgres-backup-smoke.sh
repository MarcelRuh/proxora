#!/usr/bin/env bash
# Smoke: pg_dump from the running Proxora Postgres, then restore into a throwaway DB.
# Usage (on the host that runs Compose):
#   scripts/postgres-backup-smoke.sh
# Optional: COMPOSE_PROJECT / DATABASE_URL overrides.
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="${PROXORA_INSTALL_DIR:-}"
if [[ -z "$ROOT" ]]; then
  if [[ -f /opt/proxora/docker-compose.prod.yml || -f /opt/proxora/docker-compose.yml ]]; then
    ROOT=/opt/proxora
  else
    ROOT="$SCRIPT_ROOT"
  fi
fi
cd "$ROOT"

COMPOSE=(docker compose)
if [[ -f docker-compose.prod.yml ]]; then
  COMPOSE=(docker compose -f docker-compose.prod.yml)
elif [[ -f docker-compose.yml ]] || [[ -f compose.yml ]]; then
  :
else
  echo "No compose file in $ROOT" >&2
  exit 1
fi

PG_SERVICE="${PG_SERVICE:-postgres}"
DUMP_FILE="$(mktemp "${TMPDIR:-/tmp}/proxora-pg-smoke.XXXXXX.sql")"
trap 'rm -f "$DUMP_FILE"' EXIT

echo "==> Dumping Proxora Postgres via ${PG_SERVICE}"
"${COMPOSE[@]}" exec -T "$PG_SERVICE" \
  pg_dump -U "${POSTGRES_USER:-proxora}" -d "${POSTGRES_DB:-proxora}" \
  --no-owner --no-privileges --clean --if-exists >"$DUMP_FILE"

bytes="$(wc -c <"$DUMP_FILE" | tr -d ' ')"
if [[ "$bytes" -lt 200 ]]; then
  echo "Dump too small (${bytes} bytes)" >&2
  exit 1
fi
if ! grep -qE 'CREATE TABLE|CREATE SCHEMA' "$DUMP_FILE"; then
  echo "Dump does not look like a SQL schema dump" >&2
  exit 1
fi
echo "ok: dump ${bytes} bytes"

SMOKE_DB="proxora_smoke_$$"
echo "==> Restoring into throwaway database ${SMOKE_DB}"
"${COMPOSE[@]}" exec -T "$PG_SERVICE" \
  psql -U "${POSTGRES_USER:-proxora}" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS ${SMOKE_DB};" \
  -c "CREATE DATABASE ${SMOKE_DB};"

"${COMPOSE[@]}" exec -T "$PG_SERVICE" \
  psql -U "${POSTGRES_USER:-proxora}" -d "$SMOKE_DB" -v ON_ERROR_STOP=1 <"$DUMP_FILE" >/dev/null

tables="$("${COMPOSE[@]}" exec -T "$PG_SERVICE" \
  psql -U "${POSTGRES_USER:-proxora}" -d "$SMOKE_DB" -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")"
tables="$(echo "$tables" | tr -d '[:space:]')"
if [[ -z "$tables" || "$tables" -lt 1 ]]; then
  echo "Restore produced no public tables" >&2
  exit 1
fi
echo "ok: restore has ${tables} public tables"

"${COMPOSE[@]}" exec -T "$PG_SERVICE" \
  psql -U "${POSTGRES_USER:-proxora}" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS ${SMOKE_DB};" >/dev/null

echo "==> Postgres backup/restore smoke OK"
