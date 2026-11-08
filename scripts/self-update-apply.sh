#!/bin/sh
# Shared apply script (host CLI + in-app updater container).
# Env: PROXORA_INSTALL_DIR, PROXORA_REPO, PROXORA_BRANCH, PROXORA_RELEASE_TAG
# PROXORA_SKIP_COMPOSE=1 → sync files only
set -eu

INSTALL_DIR="${PROXORA_INSTALL_DIR:-/opt/proxora}"
REPO="${PROXORA_REPO:-MarcelRuh/proxora}"
BRANCH="${PROXORA_BRANCH:-main}"
RELEASE_TAG="${PROXORA_RELEASE_TAG:-}"
SKIP_COMPOSE="${PROXORA_SKIP_COMPOSE:-0}"
CLONE_URL="https://github.com/${REPO}.git"
PROGRESS_FILE="${INSTALL_DIR}/.proxora-update-progress"
LOCK_DIR="${INSTALL_DIR}/.proxora-update.lock"
COMPOSE_LOG_FILE="${INSTALL_DIR}/.proxora-update-compose.log"
SIGNAL_DIR="${PROXORA_UPDATE_SIGNAL_DIR:-}"
# Slow links / large layers: override with PROXORA_*_TIMEOUT_SEC if needed.
PULL_TIMEOUT_SEC="${PROXORA_PULL_TIMEOUT_SEC:-900}"
BUILD_TIMEOUT_SEC="${PROXORA_BUILD_TIMEOUT_SEC:-900}"
UP_TIMEOUT_SEC="${PROXORA_UP_TIMEOUT_SEC:-600}"
rm -f "$PROGRESS_FILE"

mirror_progress() {
  if [ -n "$SIGNAL_DIR" ] && [ -d "$SIGNAL_DIR" ] && [ -f "$PROGRESS_FILE" ]; then
    cp "$PROGRESS_FILE" "${SIGNAL_DIR}/.proxora-update-progress" 2>/dev/null || true
  fi
}

# Exclusive lock via mkdir. Clear only when the recorded pid is gone.
acquire_update_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    printf '%s\n' "$$" > "${LOCK_DIR}/pid"
    return 0
  fi
  old_pid=""
  if [ -f "${LOCK_DIR}/pid" ]; then
    old_pid="$(tr -d '[:space:]' < "${LOCK_DIR}/pid" 2>/dev/null || true)"
  fi
  if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
    return 1
  fi
  echo "==> Clearing stale update lock"
  rm -rf "$LOCK_DIR"
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    printf '%s\n' "$$" > "${LOCK_DIR}/pid"
    return 0
  fi
  return 1
}
if ! acquire_update_lock; then
  echo "ERROR: another Proxora update is already running" >&2
  printf 'percent=%s\nstep=%s\ndetail=%s\n' 0 error "Update already running" > "$PROGRESS_FILE"
  mirror_progress
  exit 1
fi
trap 'rm -rf "$LOCK_DIR"' EXIT

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
  mirror_progress
}

creep_pull() {
  last=0
  if [ -f "$PROGRESS_FILE" ]; then
    parsed="$(sed -n 's/^percent=\([0-9][0-9]*\).*/\1/p' "$PROGRESS_FILE" | head -1)"
    if [ -n "${parsed:-}" ]; then last="$parsed"; fi
  fi
  next=$((last + 1))
  if [ "$next" -lt 32 ]; then next=32; fi
  if [ "$next" -gt 74 ]; then next=74; fi
  write_progress "$next" pull "Pulling image"
}

file_size() {
  wc -c < "$1" 2>/dev/null | tr -d ' ' || echo 0
}

# Read only bytes appended after phase_start so earlier phases cannot fake progress
# (e.g. old "Container … Started" while a new pull is still running).
phase_log_tail() {
  logf="$1"
  start="$2"
  size="$(file_size "$logf")"
  if [ -z "$size" ] || [ "$size" -le "$start" ]; then
    printf ''
    return 0
  fi
  # Portable slice of new bytes, then keep a trailing window for matching.
  dd if="$logf" bs=1 skip="$start" 2>/dev/null | tail -c 16000 || true
}

kill_tree() {
  pid="$1"
  if [ -z "$pid" ]; then return 0; fi
  # Children first (compose plugin / docker pull). BusyBox/procps pgrep preferred.
  if command -v pgrep >/dev/null 2>&1; then
    for child in $(pgrep -P "$pid" 2>/dev/null || true); do
      kill_tree "$child"
    done
  fi
  kill "$pid" 2>/dev/null || true
  sleep 1
  kill -9 "$pid" 2>/dev/null || true
}

wait_pid_timeout() {
  pid="$1"
  timeout_sec="$2"
  label="$3"
  elapsed=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$elapsed" -ge "$timeout_sec" ]; then
      echo "ERROR: ${label} timed out after ${timeout_sec}s" >&2
      kill_tree "$pid"
      wait "$pid" 2>/dev/null || true
      return 124
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  wait "$pid"
  return $?
}

# phase: pull | build | up | fullbuild — only that phase's markers update progress.
watch_compose_log() {
  pid="$1"
  logf="$2"
  phase="$3"
  start_size="$(file_size "$logf")"
  ticks=0
  while kill -0 "$pid" 2>/dev/null; do
    log="$(phase_log_tail "$logf" "$start_size")"
    case "$phase" in
      pull)
        case "$log" in
          *"Pulled"*|*"Downloaded newer image"*|*"Image is up to date"*)
            write_progress 76 pull "Image ready"
            ;;
          *"Pulling"*|*"Downloading"*|*"Extracting"*|*"Retrying"*|*"Verifying Checksum"*|*"Download complete"*)
            ticks=$((ticks + 1))
            if [ $((ticks % 3)) -eq 0 ]; then creep_pull; fi
            ;;
        esac
        ;;
      build)
        case "$log" in
          *"Built"*|*"naming to"*)
            write_progress 81 build "Sidecar built"
            ;;
          *"exporting to image"*)
            write_progress 80 build "Exporting sidecar"
            ;;
          *"Building"*|*"RUN "*|*"CACHED"*|*"load build"*)
            write_progress 79 build "Building WireGuard sidecar"
            ;;
        esac
        ;;
      up)
        case "$log" in
          *"Container proxora"*"Healthy"*)
            write_progress 94 startWeb "Container healthy"
            ;;
          *"Container proxora"*"Started"*)
            write_progress 90 startWeb "Container starting"
            ;;
          *"Container proxora"*"Recreated"*|*"Container proxora"*"Created"*)
            write_progress 86 startWeb "Container recreated"
            ;;
          *"Starting"*|*"Waiting"*|*"Healthy"*)
            write_progress 84 startWeb "Starting stack"
            ;;
        esac
        ;;
      fullbuild)
        case "$log" in
          *"Container proxora"*"Healthy"*) write_progress 94 startWeb "Container healthy" ;;
          *"Container proxora"*"Started"*) write_progress 90 startWeb "Container starting" ;;
          *"Image proxora Built"*|*"naming to"*"proxora"*) write_progress 80 buildWeb "Image built" ;;
          *"exporting to image"*) write_progress 72 export "Exporting image" ;;
          *"Compiled successfully"*) write_progress 64 buildWeb "Web compiled" ;;
          *"proxora Building"*|*" Building web"*|*" Building proxora"*) write_progress 42 buildWeb "Building image" ;;
        esac
        ;;
    esac
    sleep 1
  done
}

# Run a background command, watch phase-scoped progress, enforce timeout.
run_watched() {
  phase="$1"
  timeout_sec="$2"
  label="$3"
  shift 3
  "$@" >> "$TMP/compose.log" 2>&1 &
  cmd_pid=$!
  watch_compose_log "$cmd_pid" "$TMP/compose.log" "$phase" &
  watch_pid=$!
  set +e
  wait_pid_timeout "$cmd_pid" "$timeout_sec" "$label"
  cmd_rc=$?
  set -e
  kill "$watch_pid" 2>/dev/null || true
  wait "$watch_pid" 2>/dev/null || true
  return "$cmd_rc"
}

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: missing command: $1" >&2; exit 1; }
}

valid_release_tag() {
  echo "$1" | grep -Eq '^v?[0-9]+\.[0-9]+\.[0-9]+$'
}

pick_latest_semver() {
  awk '
    /^v?[0-9]+\.[0-9]+\.[0-9]+$/ {
      t = $0
      v = t
      sub(/^v/, "", v)
      n = split(v, a, ".")
      if (n < 3) next
      maj = a[1] + 0; min = a[2] + 0; pat = a[3] + 0
      if (best == "" || maj > bm || (maj == bm && min > bn) || (maj == bm && min == bn && pat > bp)) {
        bm = maj; bn = min; bp = pat; best = t
      }
    }
    END { if (best != "") print best }
  '
}

github_html_latest_tag() {
  wget -qS --spider -T 20 -U "proxora-self-update" \
    "https://github.com/${REPO}/releases/latest" 2>&1 \
    | tr -d '\r' \
    | sed -n 's/.*\/releases\/tag\/\([^[:space:]]*\).*/\1/p' \
    | head -1
}

github_git_latest_tag() {
  tags=""
  if command -v git >/dev/null 2>&1; then
    tags="$(git ls-remote --tags --refs "$CLONE_URL" 2>/dev/null | awk '{print $2}' | sed 's|refs/tags/||' || true)"
  fi
  if [ -z "$tags" ]; then
    tags="$(wget -qO- -T 20 --header='User-Agent: git/2.43.0' \
      "https://github.com/${REPO}.git/info/refs?service=git-upload-pack" 2>/dev/null \
      | tr -d '\000' | grep -oE 'refs/tags/v?[0-9]+\.[0-9]+\.[0-9]+' | sed 's|refs/tags/||' || true)"
  fi
  printf '%s\n' "$tags" | pick_latest_semver
}

github_api_latest_tag() {
  tok="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
  if [ -n "$tok" ]; then
    wget -qO- -T 20 \
      --header='User-Agent: proxora-self-update' \
      --header='Accept: application/vnd.github+json' \
      --header="Authorization: Bearer ${tok}" \
      "https://api.github.com/repos/${REPO}/releases/latest"
  else
    wget -qO- -T 20 --header='User-Agent: proxora-self-update' \
      "https://api.github.com/repos/${REPO}/releases/latest"
  fi 2>/dev/null | tr ',' '\n' | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1
}

# Prefer an explicit pin from the UI/watcher, then the highest remote semver.
resolve_release_tag() {
  if valid_release_tag "$RELEASE_TAG"; then echo "$RELEASE_TAG"; return 0; fi
  if [ -n "$SIGNAL_DIR" ] && [ -f "${SIGNAL_DIR}/target" ]; then
    best="$(tr -d '[:space:]' < "${SIGNAL_DIR}/target")"
    if valid_release_tag "$best"; then echo "$best"; return 0; fi
  fi
  best="$(
    printf '%s\n' \
      "$(github_html_latest_tag || true)" \
      "$(github_git_latest_tag || true)" \
      | pick_latest_semver
  )"
  if valid_release_tag "$best"; then echo "$best"; return 0; fi
  best="$(github_api_latest_tag || true)"
  if valid_release_tag "$best"; then echo "$best"; return 0; fi
  return 1
}

echo "==> Proxora self-update"
echo " dir=${INSTALL_DIR} repo=${REPO} branch=${BRANCH} skip_compose=${SKIP_COMPOSE}"
write_progress 4 start "Update started"

need wget
need tar
if [ "$SKIP_COMPOSE" != "1" ]; then
  need docker
  docker compose version >/dev/null 2>&1 || { echo "ERROR: docker compose plugin required" >&2; exit 1; }
fi

RESOLVED="$(resolve_release_tag || true)"
if [ -n "$RESOLVED" ]; then
  RELEASE_TAG="$RESOLVED"
fi
if [ -z "$RELEASE_TAG" ]; then
  echo "ERROR: could not resolve latest GitHub release" >&2
  write_progress 0 error "Latest GitHub release not found"
  exit 1
fi
TARBALL_URL="https://github.com/${REPO}/archive/refs/tags/${RELEASE_TAG}.tar.gz"
echo " release=${RELEASE_TAG}"

if [ ! -f "${INSTALL_DIR}/docker-compose.yml" ]; then
  echo "ERROR: docker-compose.yml missing in ${INSTALL_DIR}" >&2
  exit 1
fi

disk_avail_kb() {
  df -Pk "$INSTALL_DIR" 2>/dev/null | awk 'NR==2 {print $4}'
}

free_docker_space() {
  percent="${1:-6}"
  echo "==> Cleaning Docker leftovers"
  write_progress "$percent" cleanup "Pruning unused images and build cache"
  docker container prune -f >/dev/null 2>&1 || true
  docker builder prune -af >/dev/null 2>&1 || true
  docker image prune -af >/dev/null 2>&1 || true
  avail="$(disk_avail_kb)"
  echo " disk available: ${avail:-?}K"
  if [ "${avail:-0}" -lt 4194304 ]; then
    write_progress 0 error "Not enough disk space (${avail}K free, need 4G+)"
    echo "ERROR: not enough disk space after cleanup (${avail}K free, need at least 4G)" >&2
    exit 1
  fi
}

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
    SHA="$(git ls-remote "$CLONE_URL" "refs/tags/${RELEASE_TAG}" | awk '{print $1}' | head -1 || true)"
    if [ -n "${SHA:-}" ]; then echo "$SHA"; return 0; fi
  fi
  SHA="$(wget -qO- --header='User-Agent: git/2.43.0' \
    "https://github.com/${REPO}.git/info/refs?service=git-upload-pack" \
    | tr -d '\000' | grep -oE "[0-9a-f]{40}[[:space:]]+refs/tags/${RELEASE_TAG}" | awk '{print $1}' | head -1 || true)"
  if [ -n "${SHA:-}" ]; then echo "$SHA"; return 0; fi
  echo "ERROR: could not resolve release ${RELEASE_TAG}" >&2
  exit 1
}

sync_via_git() {
  git config --global --add safe.directory "$INSTALL_DIR" >/dev/null 2>&1 || true
  git -C "$INSTALL_DIR" remote get-url origin >/dev/null 2>&1 || git -C "$INSTALL_DIR" remote add origin "$CLONE_URL" >/dev/null 2>&1 || true
  git -C "$INSTALL_DIR" remote set-url origin "$CLONE_URL" >/dev/null 2>&1 || true
  git -C "$INSTALL_DIR" fetch --force --depth 1 origin "refs/tags/${RELEASE_TAG}:refs/tags/${RELEASE_TAG}"
  REMOTE="$(git -C "$INSTALL_DIR" rev-parse "${RELEASE_TAG}" 2>/dev/null || git -C "$INSTALL_DIR" rev-parse FETCH_HEAD)"
  if [ -z "${REMOTE:-}" ]; then
    echo "ERROR: fetch did not return a revision" >&2
    return 1
  fi
  echo "==> Local changes that will be overwritten (except .env / data / progress files):"
  git -C "$INSTALL_DIR" status --porcelain --untracked-files=no | grep -vE '^\s*\.env$|^\s*\.proxora-' || true
  git -C "$INSTALL_DIR" reset --hard "$REMOTE"
  git -C "$INSTALL_DIR" clean -fd \
    -e .env \
    -e data \
    -e data/ \
    -e .proxora-revision \
    -e .proxora-update-progress \
    -e .proxora-update-compose.log \
    -e .proxora-update.lock
  echo " git reset to $REMOTE ($RELEASE_TAG)"
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
trap 'rm -rf "$TMP" "$LOCK_DIR"' EXIT

if [ "$SKIP_COMPOSE" != "1" ]; then
  free_docker_space 6
fi

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
  if [ -n "$SIGNAL_DIR" ] && [ -d "$SIGNAL_DIR" ]; then
    printf '%s\n' "$SHA" > "${SIGNAL_DIR}/.proxora-revision"
  fi
  echo " wrote .proxora-revision"
  write_progress 100 done "Files updated"
  echo "==> Done. Restart Proxora if it does not hot-reload."
  exit 0
fi

echo "==> Updating stack"
write_progress 26 cleanup "Freeing space before update"
free_docker_space 26
write_progress 28 build "Stack update starting"
cd "$INSTALL_DIR"
sync_app_url_if_localhost "${INSTALL_DIR}/.env"
VER="$(sed -n 's/^  "version": "\([^"]*\)".*/\1/p' package.json | head -1)"
if [ -n "$VER" ] && [ -f .env ]; then
  if grep -q '^PROXORA_VERSION=' .env; then
    sed -i "s|^PROXORA_VERSION=.*|PROXORA_VERSION=${VER}|" .env
  else
    printf 'PROXORA_VERSION=%s\n' "$VER" >> .env
  fi
  export PROXORA_VERSION="$VER"
fi
# Compose/BuildKit hijack fails through docker-socket-proxy (403). Prefer the unix socket.
if [ -S /var/run/docker.sock ]; then
  unset DOCKER_HOST
fi
export COMPOSE_BAKE=false
COMPOSE_FILE="docker-compose.yml"
if [ -f docker-compose.prod.yml ]; then COMPOSE_FILE="docker-compose.prod.yml"; fi
: > "$TMP/compose.log"
fail_compose() {
  reason="$1"
  cp "$TMP/compose.log" "$COMPOSE_LOG_FILE" 2>/dev/null || true
  if [ -n "$SIGNAL_DIR" ] && [ -d "$SIGNAL_DIR" ]; then
    cp "$TMP/compose.log" "${SIGNAL_DIR}/.proxora-update-compose.log" 2>/dev/null || true
  fi
  write_progress 0 error "$reason"
  echo "ERROR: ${reason} (see ${COMPOSE_LOG_FILE})" >&2
  exit 1
}

if [ "${PROXORA_BUILD:-0}" = "1" ]; then
  set +e
  run_watched fullbuild "$UP_TIMEOUT_SEC" "compose up --build" \
    docker compose -f "$COMPOSE_FILE" up -d --build --remove-orphans
  COMPOSE_RC=$?
  set -e
else
  set +e
  run_watched pull "$PULL_TIMEOUT_SEC" "image pull" \
    docker compose -f "$COMPOSE_FILE" pull proxora
  PULL_RC=$?
  set -e
  if [ "$PULL_RC" -eq 124 ]; then
    fail_compose "Image pull timed out after ${PULL_TIMEOUT_SEC}s — check network to ghcr.io and retry"
  fi
  if [ "$PULL_RC" -eq 0 ]; then
    write_progress 78 pull "App image ready"
    # Sidecar is build-only (no GHCR tag). --no-build would leave Proxora Created
    # and the stack dead if proxora-proxora-wireguard:latest is missing.
    echo "==> Building WireGuard sidecar" >> "$TMP/compose.log"
    write_progress 80 build "Building WireGuard sidecar"
    set +e
    run_watched build "$BUILD_TIMEOUT_SEC" "WireGuard sidecar build" \
      docker compose -f "$COMPOSE_FILE" build proxora-wireguard
    BUILD_RC=$?
    set -e
    if [ "$BUILD_RC" -eq 124 ]; then
      fail_compose "WireGuard sidecar build timed out after ${BUILD_TIMEOUT_SEC}s"
    fi
    if [ "$BUILD_RC" -ne 0 ]; then
      fail_compose "WireGuard sidecar build failed"
    fi
    write_progress 82 pull "Image ready"
    set +e
    run_watched up "$UP_TIMEOUT_SEC" "compose up" \
      docker compose -f "$COMPOSE_FILE" up -d --no-build --remove-orphans
    COMPOSE_RC=$?
    set -e
  else
    echo "==> Image pull failed (exit ${PULL_RC}), building locally" >> "$TMP/compose.log"
    write_progress 40 buildWeb "Pull failed — building locally"
    set +e
    run_watched fullbuild "$UP_TIMEOUT_SEC" "compose up --build" \
      docker compose -f "$COMPOSE_FILE" up -d --build --remove-orphans
    COMPOSE_RC=$?
    set -e
  fi
fi
cat "$TMP/compose.log" || true
cp "$TMP/compose.log" "$COMPOSE_LOG_FILE" 2>/dev/null || true
if [ -n "$SIGNAL_DIR" ] && [ -d "$SIGNAL_DIR" ]; then
  cp "$TMP/compose.log" "${SIGNAL_DIR}/.proxora-update-compose.log" 2>/dev/null || true
fi
if [ "${COMPOSE_RC:-1}" -eq 124 ]; then
  fail_compose "Stack start timed out after ${UP_TIMEOUT_SEC}s"
fi
if [ "${COMPOSE_RC:-1}" -ne 0 ]; then
  if grep -q 'unable to upgrade to tcp' "$TMP/compose.log"; then
    err="Docker-Socket-Proxy blockiert den Image-Build (403). Einmal auf dem Host: docker compose -f docker-compose.prod.yml up -d --build --remove-orphans"
  else
    err="$(grep -Ei 'ERROR|error:|failed|ELIFECYCLE|no space|forbidden|timed out' "$TMP/compose.log" | grep -viE 'COMPOSE_BAKE|better performances' | tail -1 | tr '\n' ' ' | cut -c1-180)"
  fi
  if [ -z "$err" ]; then
    err="$(tail -8 "$TMP/compose.log" | grep -viE 'COMPOSE_BAKE|better performances' | tr '\n' ' ' | cut -c1-180)"
  fi
  fail_compose "${err:-Compose rebuild failed}"
fi

echo "==> Reattaching WireGuard to the new Proxora network"
docker compose -f "$COMPOSE_FILE" up -d --build --no-deps --force-recreate proxora-wireguard >> "$TMP/compose.log" 2>&1 || true

printf '%s\n' "$SHA" > "${INSTALL_DIR}/.proxora-revision"
if [ -n "$SIGNAL_DIR" ] && [ -d "$SIGNAL_DIR" ]; then
  printf '%s\n' "$SHA" > "${SIGNAL_DIR}/.proxora-revision"
fi
echo " wrote .proxora-revision"
write_progress 96 finalize "Revision saved"
docker builder prune -af >/dev/null 2>&1 || true
docker image prune -af >/dev/null 2>&1 || true
write_progress 100 done "Update complete"
echo "==> Done. Proxora should come back shortly."
