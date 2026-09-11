#!/usr/bin/env bash
# Proxora one-line installer
#
# wget -qO- https://raw.githubusercontent.com/MarcelRuh/proxora/main/scripts/install.sh | sudo bash
#
# Installs Docker Engine + Compose V2 when missing (https://get.docker.com).
# Skip that with PROXORA_SKIP_DOCKER_INSTALL=1
set -euo pipefail

REPO="${PROXORA_REPO:-MarcelRuh/proxora}"
BRANCH="${PROXORA_BRANCH:-main}"
INSTALL_DIR="${PROXORA_DIR:-/opt/proxora}"
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
info() { printf '==> %s\n' "$*"; }

need() { command -v "$1" >/dev/null 2>&1 || { red "Missing $1"; exit 1; }; }

as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

docker_cmd() {
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    docker "$@"
  else
    as_root docker "$@"
  fi
}

http_get() {
  local url="$1"
  local ua="${2:-proxora-install}"
  if command -v wget >/dev/null 2>&1; then
    wget -qO- --timeout=8 --tries=1 -U "$ua" "$url"
  else
    curl -fsSL --max-time 8 -A "$ua" "$url"
  fi
}

http_ok() {
  local url="$1"
  if command -v wget >/dev/null 2>&1; then
    wget -qO- --timeout=3 --tries=1 "$url" >/dev/null 2>&1
  else
    curl -fsS --max-time 3 "$url" >/dev/null 2>&1
  fi
}

download_file() {
  local url="$1" dest="$2"
  if command -v wget >/dev/null 2>&1; then
    wget -qO "$dest" --timeout=45 --tries=3 "$url"
  else
    curl -fsSL --max-time 45 --retry 3 -o "$dest" "$url"
  fi
}

apt_install() {
  as_root apt-get update -qq
  as_root apt-get install -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold "$@"
}

rand() { openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
rand_pw() { openssl rand -base64 18 2>/dev/null | tr -d '/+=' | head -c 20; }

telemetry_ping() {
  local asset="$1"
  case "${PROXORA_TELEMETRY:-1}" in
    0|false|off|no) return 0 ;;
  esac
  http_get "https://github.com/${REPO}/releases/download/stats/${asset}" >/dev/null 2>&1 || true
}

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

env_ensure() {
  local file="$1" key="$2" value="$3"
  if ! grep -qE "^${key}=" "$file" 2>/dev/null; then
    printf '%s=%s\n' "$key" "$value" | as_root tee -a "$file" >/dev/null
  fi
}

require_linux() {
  case "$(uname -s)" in
    Linux) ;;
    *)
      red "Proxora-Installer läuft nur unter Linux."
      exit 1
      ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64|aarch64|arm64) ;;
    *)
      red "Nicht unterstützte Architektur: $(uname -m) (x86_64 oder aarch64)."
      exit 1
      ;;
  esac
}

require_root_or_sudo() {
  if [[ "$(id -u)" -eq 0 ]]; then
    return 0
  fi
  if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    return 0
  fi
  if [[ ! -t 0 ]]; then
    red "Nicht als root und ohne Passwort-sudo. So ausführen:"
    red "  wget -qO- https://raw.githubusercontent.com/${REPO}/${BRANCH}/scripts/install.sh | sudo bash"
    exit 1
  fi
  if command -v sudo >/dev/null 2>&1; then
    info "sudo wird für Docker und ${INSTALL_DIR} benötigt"
    sudo -v
    return 0
  fi
  red "Als root ausführen oder sudo installieren."
  exit 1
}

ensure_host_tools() {
  local pkgs=()
  command -v wget >/dev/null 2>&1 || command -v curl >/dev/null 2>&1 || pkgs+=(wget curl)
  command -v tar >/dev/null 2>&1 || pkgs+=(tar)
  command -v openssl >/dev/null 2>&1 || pkgs+=(openssl)
  command -v git >/dev/null 2>&1 || pkgs+=(git)
  [[ -f /etc/ssl/certs/ca-certificates.crt || -f /etc/ssl/cert.pem ]] || pkgs+=(ca-certificates)
  if [[ "${#pkgs[@]}" -eq 0 ]]; then
    return 0
  fi
  if command -v apt-get >/dev/null 2>&1; then
    info "Installiere Host-Pakete: ${pkgs[*]}"
    apt_install "${pkgs[@]}"
  elif command -v dnf >/dev/null 2>&1; then
    as_root dnf install -y "${pkgs[@]}"
  elif command -v yum >/dev/null 2>&1; then
    as_root yum install -y "${pkgs[@]}"
  fi
  command -v wget >/dev/null 2>&1 || command -v curl >/dev/null 2>&1 || {
    red "wget oder curl wird benötigt."
    exit 1
  }
}

docker_ready() {
  command -v docker >/dev/null 2>&1 || return 1
  docker_cmd compose version >/dev/null 2>&1 || return 1
  docker_cmd info >/dev/null 2>&1
}

wait_docker_daemon() {
  local i
  for i in $(seq 1 30); do
    if docker_cmd info >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

start_docker_service() {
  as_root systemctl enable --now docker >/dev/null 2>&1 || true
  as_root systemctl start docker >/dev/null 2>&1 || true
  as_root service docker start >/dev/null 2>&1 || true
}

install_compose_plugin() {
  if command -v apt-get >/dev/null 2>&1; then
    apt_install docker-compose-plugin && return 0
    apt_install docker-compose-v2 && return 0
  elif command -v dnf >/dev/null 2>&1; then
    as_root dnf install -y docker-compose-plugin && return 0
  fi
  return 1
}

install_docker_convenience() {
  local script
  script="$(mktemp)"
  info "Installiere Docker Engine + Compose V2 (get.docker.com)"
  if ! download_file "https://get.docker.com" "$script"; then
    rm -f "$script"
    return 1
  fi
  if ! as_root sh "$script"; then
    rm -f "$script"
    return 1
  fi
  rm -f "$script"
  return 0
}

install_docker_distro() {
  info "Fallback: Distro-Pakete für Docker"
  if command -v apt-get >/dev/null 2>&1; then
    apt_install docker.io docker-compose-v2 ca-certificates && return 0
    apt_install docker.io docker-compose-plugin && return 0
  elif command -v dnf >/dev/null 2>&1; then
    as_root dnf install -y docker docker-compose-plugin && return 0
  elif command -v yum >/dev/null 2>&1; then
    as_root yum install -y docker docker-compose-plugin && return 0
  fi
  return 1
}

ensure_docker() {
  if docker_ready; then
    info "Docker bereits vorhanden ($(docker_cmd --version 2>/dev/null | head -1))"
    return 0
  fi
  case "${PROXORA_SKIP_DOCKER_INSTALL:-0}" in
    1|true|yes)
      red "Docker / Compose V2 fehlt. Installiere Docker oder lasse PROXORA_SKIP_DOCKER_INSTALL weg."
      exit 1
      ;;
  esac

  if command -v docker >/dev/null 2>&1 && ! docker_cmd compose version >/dev/null 2>&1; then
    info "Docker gefunden, Compose V2 fehlt – Plugin wird nachinstalliert"
    install_compose_plugin || true
    start_docker_service
    if docker_ready; then
      return 0
    fi
  fi

  if ! command -v docker >/dev/null 2>&1 || ! docker_ready; then
    if ! install_docker_convenience; then
      yellow "get.docker.com fehlgeschlagen – versuche Distro-Pakete"
      if ! install_docker_distro; then
        red "Docker konnte nicht installiert werden (get.docker.com und Distro-Pakete)."
        exit 1
      fi
    fi
  fi

  start_docker_service
  hash -r 2>/dev/null || true
  if ! wait_docker_daemon; then
    red "Docker-Daemon startet nicht. journalctl -u docker"
    exit 1
  fi
  if ! docker_cmd compose version >/dev/null 2>&1; then
    install_compose_plugin || true
  fi
  if ! docker_ready; then
    red "Docker oder Compose V2 ist nach der Installation nicht nutzbar."
    exit 1
  fi
  info "Docker bereit ($(docker_cmd --version 2>/dev/null | head -1))"
}

warn_environment() {
  if command -v pveversion >/dev/null 2>&1; then
    yellow "Hinweis: Installation auf einem Proxmox-Host. Eine eigene VM ist sauberer, Docker neben PVE funktioniert aber."
  fi
  local parent avail
  parent="$(dirname "$INSTALL_DIR")"
  avail="$(df -Pk "$parent" 2>/dev/null | awk 'NR==2 { print $4 }')"
  if [[ -n "$avail" && "$avail" -lt 1500000 ]]; then
    red "Weniger als ~1,5 GB frei auf ${parent} – Image-Build wird knapp."
    exit 1
  fi
  if [[ -n "$avail" && "$avail" -lt 5000000 ]]; then
    yellow "Weniger als ~5 GB frei auf ${parent} – der erste Build kann scheitern."
  fi
}

hint_firewall() {
  local port="$1"
  if command -v ufw >/dev/null 2>&1 && as_root ufw status 2>/dev/null | grep -qi 'Status: active'; then
    yellow "UFW ist aktiv. Port ${port} ggf. öffnen: ufw allow ${port}/tcp"
  fi
  if command -v firewall-cmd >/dev/null 2>&1 && as_root firewall-cmd --state 2>/dev/null | grep -qi running; then
    yellow "firewalld ist aktiv. Port ${port} ggf. öffnen: firewall-cmd --add-port=${port}/tcp --permanent && firewall-cmd --reload"
  fi
}

require_linux
require_root_or_sudo
ensure_host_tools
ensure_docker
warn_environment

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
    need tar
    tmp="$(mktemp -d)"
    download_file "https://github.com/${REPO}/archive/refs/heads/${BRANCH}.tar.gz" "$tmp/src.tgz"
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
  PG_PW="${POSTGRES_PASSWORD:-$(rand_pw)}"
  as_root tee "${INSTALL_DIR}/.env" >/dev/null <<EOF
APP_URL=http://${LAN_IP}:3000
NODE_ENV=production
DATABASE_URL=postgresql://proxora:${PG_PW}@postgres:5432/proxora?schema=public
POSTGRES_USER=proxora
POSTGRES_PASSWORD=${PG_PW}
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
  env_ensure "${INSTALL_DIR}/.env" PROXORA_INSTALL_DIR "$INSTALL_DIR"
  env_ensure "${INSTALL_DIR}/.env" PROXORA_REPO "$REPO"
  env_ensure "${INSTALL_DIR}/.env" PROXORA_BRANCH "$BRANCH"
  env_ensure "${INSTALL_DIR}/.env" LISTEN_HOST "0.0.0.0"
  env_ensure "${INSTALL_DIR}/.env" PORT "3000"
fi
as_root chmod 600 "${INSTALL_DIR}/.env" 2>/dev/null || true

PORT="$(env_get "${INSTALL_DIR}/.env" PORT)"
PORT="${PORT:-3000}"
sync_app_url "${INSTALL_DIR}/.env" "$LAN_IP" "$PORT"
hint_firewall "$PORT"

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
  if http_ok "http://127.0.0.1:${PORT}/api/health"; then
    ok=1
    break
  fi
  sleep 3
done

if [[ "$ok" -ne 1 ]]; then
  red "Proxora did not become healthy on http://127.0.0.1:${PORT}"
  docker_cmd compose -f docker-compose.prod.yml logs --tail 80 proxora || true
  exit 1
fi

if [[ "$NEW_INSTALL" == "1" ]]; then
  telemetry_ping install
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
