#!/bin/sh
# Shared apply script (host CLI + in-app updater container).
# Env: PROXORA_INSTALL_DIR, PROXORA_REPO, PROXORA_BRANCH
# PROXORA_SKIP_COMPOSE=1 → sync files only
set -eu

INSTALL_DIR="${PROXORA_INSTALL_DIR:-/opt/proxora}"
REPO="${PROXORA_REPO:-MarcelRuh/proxora}"
BRANCH="${PROXORA_BRANCH:-main}"
SKIP_COMPOSE="${PROXORA_SKIP_COMPOSE:-0}"
TARBALL_URL="https://github.com/${REPO}/archive/refs/heads/${BRANCH}.tar.gz"
CLONE_URL="https://github.com/${REPO}.git"
PROGRESS_FILE="${INSTALL_DIR}/.proxora-update-progress"
rm -f "$PROGRESS_FILE"

write_progress() {
  percent="$1"
  step="$2"
  detail="${3:-}"
  last=0
  if [ -f "$PROGRESS_FILE" ]; then
    parsed="$(sed -n 's/^percent=\([0-9][0-9]*\).*/\1/p' "$PROGRESS_FILE" | head -1)"
    if [ -n "${parsed:-}" ]; then last="$parsed"; fi
  fi
  if [ "$step" = "error" ]; then
    if [ "$last" -gt 0 ]; then percent="$last"; fi
  elif [ "$percent" -lt "$last" ]; then
    percent="$last"
  fi
  echo "==> [${percent}%] ${step}${detail:+ – $detail}"
  printf 'percent=%s\nstep=%s\ndetail=%s\n' "$percent" "$step" "$detail" > "$PROGRESS_FILE"
}

watch_compose_log() {
  pid="$1"
  logf="$2"
  while kill -0 "$pid" 2>/dev/null; do
    log="$(tail -c 16000 "$logf" 2>/dev/null || true)"
    case "$log" in
      *"Container proxora"*"Healthy"*) write_progress 94 startWeb "Container healthy" ;;
      *"Container proxora"*"Started"*) write_progress 90 startWeb "Container starting" ;;
      *"Image proxora Built"*|*"naming to"*"proxora"*) write_progress 80 buildWeb "Image built" ;;
      *"exporting to image"*) write_progress 72 export "Exporting image" ;;
      *"Compiled successfully"*) write_progress 64 buildWeb "Web compiled" ;;
      *"proxora Building"*|*" Building web"*|*" Building proxora"*) write_progress 42 buildWeb "Building image" ;;
    esac
    sleep 1
  done
}

echo "==> Proxora self-update"
echo " dir=${INSTALL_DIR} repo=${REPO} branch=${BRANCH} skip_compose=${SKIP_COMPOSE}"
write_progress 4 start "Update started"

if [ ! -f "${INSTALL_DIR}/docker-compose.yml" ]; then
  echo "ERROR: docker-compose.yml missing in ${INSTALL_DIR}" >&2
  exit 1
fi

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: missing command: $1" >&2; exit 1; }
}
need wget
need tar
if [ "$SKIP_COMPOSE" != "1" ]; then
  need docker
  docker compose version >/dev/null 2>&1 || { echo "ERROR: docker compose plugin required" >&2; exit 1; }
fi

detect_lan_ip() {
  _ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')"
  if [ -z "$_ip" ] || [ "$_ip" = "127.0.0.1" ]; then
    _ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  printf '%s\n' "${_ip:-127.0.0.1}"
}

sync_app_url_if_localhost() {
  _file="$1"
  [ -f "$_file" ] || return 0
  _current="$(grep -E '^APP_URL=' "$_file" 2>/dev/null | head -1 | cut -d= -f2- || true)"
  case "$_current" in
    https://*) return 0 ;;
    *localhost*|*127.0.0.1*|http://:*) ;;
    "") ;;
    *) return 0 ;;
  esac
  # In-app updater runs inside Docker — do not overwrite with a container IP.
  if [ -f /.dockerenv ]; then
    return 0
  fi
  _ip="$(detect_lan_ip)"
  _port="$(grep -E '^PORT=' "$_file" 2>/dev/null | head -1 | cut -d= -f2- || true)"
  _port="${_port:-3000}"
  _url="http://${_ip}:${_port}"
  if grep -q '^APP_URL=' "$_file" 2>/dev/null; then
    sed -i "s|^APP_URL=.*|APP_URL=${_url}|" "$_file"
  else
    printf 'APP_URL=%s\n' "$_url" >> "$_file"
  fi
}

ensure_git() {
  command -v git >/dev/null 2>&1 && return 0
  if command -v apk >/dev/null 2>&1; then apk add --no-cache git >/dev/null 2>&1 || return 1; fi
  command -v git >/dev/null 2>&1
}

resolve_sha() {
  if command -v git >/dev/null 2>&1; then
    SHA="$(git ls-remote "$CLONE_URL" "refs/heads/${BRANCH}" | awk '{print $1}' | head -1 || true)"
    if [ -n "${SHA:-}" ]; then echo "$SHA"; return 0; fi
  fi
  SHA="$(wget -qO- --header='User-Agent: git/2.43.0' \
    "https://github.com/${REPO}.git/info/refs?service=git-upload-pack" \
    | tr -d '\000' | grep -oE "[0-9a-f]{40}[[:space:]]+refs/heads/${BRANCH}" | awk '{print $1}' | head -1 || true)"
  if [ -n "${SHA:-}" ]; then echo "$SHA"; return 0; fi
  SHA="$(wget -qO- --header='User-Agent: proxora-self-update' \
    "https://github.com/${REPO}/commits/${BRANCH}.atom" \
    | sed -n 's/.*Grit::Commit\/\([a-f0-9]\{40\}\).*/\1/p' | head -1 || true)"
  if [ -n "${SHA:-}" ]; then echo "$SHA"; return 0; fi
  echo "ERROR: could not resolve remote commit SHA" >&2
  exit 1
}

sync_via_git() {
  git config --global --add safe.directory "$INSTALL_DIR" >/dev/null 2>&1 || true
  git -C "$INSTALL_DIR" remote get-url origin >/dev/null 2>&1 || git -C "$INSTALL_DIR" remote add origin "$CLONE_URL" >/dev/null 2>&1 || true
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
  LOCAL="$(git -C "$INSTALL_DIR" rev-parse HEAD)"
  REMOTE="$(git -C "$INSTALL_DIR" rev-parse FETCH_HEAD)"
  if [ "$LOCAL" = "$REMOTE" ]; then echo " git already at $REMOTE"; return 0; fi
  git -C "$INSTALL_DIR" merge --ff-only FETCH_HEAD
}

sync_via_tarball() {
  echo "==> Downloading source tarball"
  wget -qO "$TMP/src.tgz" "$TARBALL_URL"
  tar -xzf "$TMP/src.tgz" -C "$TMP"
  SRC="$(find "$TMP" -maxdepth 1 -mindepth 1 -type d ! -name '.' | head -1)"
  echo "==> Syncing files (preserving .env, data/, .git)"
  cd "$SRC"
  tar cf - \
    --exclude='./.env' \
    --exclude='./data' \
    --exclude='./.proxora-revision' \
    --exclude='./.proxora-update-progress' \
    --exclude='./.git' \
    --exclude='./node_modules' \
    --exclude='./.next' \
    . | (cd "$INSTALL_DIR" && tar xf -)
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> Resolving remote revision"
write_progress 8 resolve "Reading remote revision"
ensure_git || true
SHA="$(resolve_sha)"
echo " remote=$SHA"
write_progress 12 resolve "Remote revision resolved"

if [ -d "${INSTALL_DIR}/.git" ] && ensure_git && sync_via_git; then
  echo "==> Git sync complete"
  SHA="$(git -C "$INSTALL_DIR" rev-parse HEAD)"
  write_progress 22 sync "Source synced"
else
  write_progress 16 sync "Downloading source"
  sync_via_tarball
  write_progress 22 sync "Source synced"
fi

if [ "$SKIP_COMPOSE" = "1" ]; then
  printf '%s\n' "$SHA" > "${INSTALL_DIR}/.proxora-revision"
  echo " wrote .proxora-revision"
  write_progress 100 done "Files updated"
  echo "==> Done. Restart Proxora if it does not hot-reload."
  exit 0
fi

echo "==> Rebuilding stack (docker compose up -d --build)"
write_progress 28 build "Stack rebuild starting"
cd "$INSTALL_DIR"
sync_app_url_if_localhost "${INSTALL_DIR}/.env"
COMPOSE_FILE="docker-compose.yml"
if [ -f docker-compose.prod.yml ]; then COMPOSE_FILE="docker-compose.prod.yml"; fi
docker compose -f "$COMPOSE_FILE" up -d --build --remove-orphans > "$TMP/compose.log" 2>&1 &
CPID=$!
watch_compose_log "$CPID" "$TMP/compose.log" &
WATCH=$!
set +e
wait "$CPID"
COMPOSE_RC=$?
set -e
kill "$WATCH" 2>/dev/null || true
wait "$WATCH" 2>/dev/null || true
cat "$TMP/compose.log" || true
if [ "$COMPOSE_RC" -ne 0 ]; then
  write_progress 0 error "Compose rebuild failed"
  exit "$COMPOSE_RC"
fi

printf '%s\n' "$SHA" > "${INSTALL_DIR}/.proxora-revision"
echo " wrote .proxora-revision"
write_progress 96 finalize "Revision saved"
docker builder prune -af >/dev/null 2>&1 || true
write_progress 100 done "Update complete"
echo "==> Done. Proxora should come back shortly."
