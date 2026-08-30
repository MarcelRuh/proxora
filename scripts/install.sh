#!/usr/bin/env bash
# Proxora one-line installer
#
# wget -qO- https://raw.githubusercontent.com/MarcelRuh/proxora/main/scripts/install.sh | bash
set -euo pipefail

REPO="${PROXORA_REPO:-MarcelRuh/proxora}"
BRANCH="${PROXORA_BRANCH:-main}"
INSTALL_DIR="${PROXORA_DIR:-/opt/proxora}"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
info() { printf '==> %s\n' "$*"; }

need() { command -v "$1" >/dev/null 2>&1 || { red "Missing $1"; exit 1; }; }
need docker
docker compose version >/dev/null 2>&1 || { red "Docker Compose V2 required"; exit 1; }

as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

docker_cmd() {
  if docker info >/dev/null 2>&1; then
    docker "$@"
  else
    as_root docker "$@"
  fi
}

rand() { openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
rand_pw() { openssl rand -base64 18 2>/dev/null | tr -d '/+=' | head -c 20; }

detect_lan_ip() {
  local ip
  ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')"
  if [[ -z "$ip" || "$ip" == "127.0.0.1" ]]; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  printf '%s\n' "${ip:-127.0.0.1}"
}

sync_app_url() {
  local file="$1" ip="$2" port="$3"
  local current url
  current="$(env_get "$file" APP_URL)"
  case "$current" in
    https://*) return 0 ;;
  esac
  url="http://${ip}:${port}"
  if grep -q '^APP_URL=' "$file" 2>/dev/null; then
    as_root sed -i "s|^APP_URL=.*|APP_URL=${url}|" "$file"
  else
    printf 'APP_URL=%s\n' "$url" | as_root tee -a "$file" >/dev/null
  fi
}

env_get() {
  local file="$1" key="$2"
  grep -E "^${key}=" "$file" 2>/dev/null | head -1 | cut -d= -f2- || true
}

info "Installing Proxora to ${INSTALL_DIR}"
as_root mkdir -p "$INSTALL_DIR"

if [[ -d "${INSTALL_DIR}/.git" ]]; then
  info "Existing git checkout – pulling ${BRANCH}"
  as_root git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
  as_root git -C "$INSTALL_DIR" checkout "$BRANCH"
  as_root git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH" || true
elif [[ -f "${INSTALL_DIR}/docker-compose.prod.yml" ]]; then
  info "Existing install directory found – skipping clone"
else
  if command -v git >/dev/null 2>&1; then
    as_root git clone --depth 1 --branch "$BRANCH" "https://github.com/${REPO}.git" "$INSTALL_DIR"
  else
    need wget
    need tar
    tmp="$(mktemp -d)"
    wget -qO "$tmp/src.tgz" "https://github.com/${REPO}/archive/refs/heads/${BRANCH}.tar.gz"
    tar -xzf "$tmp/src.tgz" -C "$tmp"
    src="$(find "$tmp" -maxdepth 1 -mindepth 1 -type d | head -1)"
    as_root cp -a "$src"/. "$INSTALL_DIR"/
    rm -rf "$tmp"
  fi
fi

NEW_INSTALL=0
LAN_IP="$(detect_lan_ip)"
if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
  NEW_INSTALL=1
  ADMIN_USER="${BOOTSTRAP_ADMIN_USERNAME:-admin}"
  ADMIN_PW="${BOOTSTRAP_ADMIN_PASSWORD:-$(rand_pw)}"
  ADMIN_EMAIL="${BOOTSTRAP_ADMIN_EMAIL:-admin@localhost}"
  as_root tee "${INSTALL_DIR}/.env" >/dev/null <<EOF
APP_URL=http://${LAN_IP}:3000
NODE_ENV=production
DATABASE_URL=postgresql://proxora:proxora@postgres:5432/proxora?schema=public
POSTGRES_USER=proxora
POSTGRES_PASSWORD=proxora
POSTGRES_DB=proxora
ENCRYPTION_KEY=$(rand)
SESSION_SECRET=$(rand)
BOOTSTRAP_ADMIN_USERNAME=${ADMIN_USER}
BOOTSTRAP_ADMIN_PASSWORD=${ADMIN_PW}
BOOTSTRAP_ADMIN_EMAIL=${ADMIN_EMAIL}
PROXORA_INSTALL_DIR=${INSTALL_DIR}
PROXORA_REPO=${REPO}
PROXORA_BRANCH=${BRANCH}
LISTEN_HOST=0.0.0.0
PORT=3000
EOF
  info "Generated ${INSTALL_DIR}/.env"
else
  info "Keeping existing .env"
  ADMIN_USER="$(env_get "${INSTALL_DIR}/.env" BOOTSTRAP_ADMIN_USERNAME)"
  ADMIN_PW="$(env_get "${INSTALL_DIR}/.env" BOOTSTRAP_ADMIN_PASSWORD)"
  ADMIN_EMAIL="$(env_get "${INSTALL_DIR}/.env" BOOTSTRAP_ADMIN_EMAIL)"
  ADMIN_USER="${ADMIN_USER:-admin}"
  ADMIN_EMAIL="${ADMIN_EMAIL:-admin@localhost}"
fi

PORT="$(env_get "${INSTALL_DIR}/.env" PORT)"
PORT="${PORT:-3000}"
sync_app_url "${INSTALL_DIR}/.env" "$LAN_IP" "$PORT"

SHA="$(as_root git -C "$INSTALL_DIR" rev-parse HEAD 2>/dev/null || true)"
if [[ -n "$SHA" ]]; then
  printf '%s\n' "$SHA" | as_root tee "${INSTALL_DIR}/.proxora-revision" >/dev/null
fi

as_root chmod +x "${INSTALL_DIR}/scripts/"*.sh 2>/dev/null || true

cd "$INSTALL_DIR"
info "Building and starting containers"
set +e
docker_cmd compose -f docker-compose.prod.yml up -d --build --wait --wait-timeout 180
COMPOSE_RC=$?
if [[ "$COMPOSE_RC" -ne 0 ]]; then
  docker_cmd compose -f docker-compose.prod.yml up -d --build
  COMPOSE_RC=$?
fi
set -e

if [[ "$COMPOSE_RC" -ne 0 ]]; then
  red "Compose failed. Last logs:"
  docker_cmd compose -f docker-compose.prod.yml logs --tail 80 || true
  exit "$COMPOSE_RC"
fi

ok=0
for _ in $(seq 1 40); do
  if wget -qO- --timeout=3 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 3
done

if [[ "$ok" -ne 1 ]]; then
  red "Proxora did not become healthy on http://127.0.0.1:3000"
  docker_cmd compose -f docker-compose.prod.yml logs --tail 80 proxora || true
  exit 1
fi

WEB_HINT="$(env_get "${INSTALL_DIR}/.env" APP_URL)"
WEB_HINT="${WEB_HINT:-http://${LAN_IP}:${PORT}}"

echo
green "Proxora is running."
echo
echo "┌──────────────────────────────────────────────┐"
echo "│ Login                                        │"
echo "├──────────────────────────────────────────────┤"
echo "│ UI:       ${WEB_HINT}"
echo "│ Username: ${ADMIN_USER}"
echo "│ Password: ${ADMIN_PW:-"(siehe ${INSTALL_DIR}/.env)"}"
echo "│ Dir:      ${INSTALL_DIR}"
echo "└──────────────────────────────────────────────┘"
echo
if [[ "$NEW_INSTALL" == "1" ]]; then
  yellow "Passwort jetzt speichern – es steht auch in ${INSTALL_DIR}/.env"
else
  yellow "Bestehende Installation: Passwort aus ${INSTALL_DIR}/.env"
fi
echo "Logs: docker compose -f ${INSTALL_DIR}/docker-compose.prod.yml logs -f"
echo "Change the bootstrap password immediately after first login."
