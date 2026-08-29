#!/bin/sh
# Sidecar: owns docker.sock. The Proxora app only writes an empty request file.
# Env: PROXORA_INSTALL_DIR, PROXORA_REPO, PROXORA_BRANCH, PROXORA_UPDATE_SIGNAL_DIR
set -eu

INSTALL_DIR="${PROXORA_INSTALL_DIR:-/opt/proxora}"
SIGNAL_DIR="${PROXORA_UPDATE_SIGNAL_DIR:-/update-signal}"
REPO="${PROXORA_REPO:-MarcelRuh/proxora}"
BRANCH="${PROXORA_BRANCH:-main}"
UPDATER_NAME="proxora-self-updater"
REQUEST="${SIGNAL_DIR}/request"
LOCK="${SIGNAL_DIR}/.proxora-update.lock"

if ! echo "$REPO" | grep -Eq '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'; then
  echo "ERROR: invalid PROXORA_REPO" >&2
  exit 1
fi
if ! echo "$BRANCH" | grep -Eq '^[A-Za-z0-9._/-]+$'; then
  echo "ERROR: invalid PROXORA_BRANCH" >&2
  exit 1
fi

mkdir -p "$SIGNAL_DIR"
echo "==> Proxora update watcher"
echo " dir=${INSTALL_DIR} signal=${SIGNAL_DIR} repo=${REPO} branch=${BRANCH}"

updater_running() {
  docker ps --filter "name=^${UPDATER_NAME}$" --filter "status=running" --format "{{.Names}}" 2>/dev/null | grep -qx "$UPDATER_NAME"
}

sync_lock() {
  if updater_running; then
    touch "$LOCK"
  else
    rm -f "$LOCK"
  fi
}

start_updater() {
  docker rm -f "$UPDATER_NAME" >/dev/null 2>&1 || true
  RAW_URL="https://raw.githubusercontent.com/${REPO}/${BRANCH}/scripts/self-update-apply.sh"
  docker run -d --init --name "$UPDATER_NAME" \
    -v "${INSTALL_DIR}:${INSTALL_DIR}" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -e "PROXORA_INSTALL_DIR=${INSTALL_DIR}" \
    -e "PROXORA_REPO=${REPO}" \
    -e "PROXORA_BRANCH=${BRANCH}" \
    -e "PROXORA_SKIP_COMPOSE=0" \
    -w "$INSTALL_DIR" \
    --label proxora.update=self \
    docker:27-cli \
    sh -c "wget -qO /tmp/proxora-apply.sh \"$RAW_URL\" && exec sh /tmp/proxora-apply.sh"
}

sync_lock

while true; do
  if [ -f "$REQUEST" ]; then
    rm -f "$REQUEST"
    if updater_running; then
      echo "==> Update already running"
    else
      echo "==> Update requested"
      touch "$LOCK"
      if ! start_updater; then
        echo "==> Failed to start updater" >&2
        rm -f "$LOCK"
      fi
    fi
  fi
  sync_lock
  sleep 2
done
