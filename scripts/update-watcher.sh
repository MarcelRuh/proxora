#!/bin/sh
# Sidecar: talks to docker-socket-proxy (or docker.sock as fallback).
# The Proxora app only writes an empty request file.
set -eu

INSTALL_DIR="${PROXORA_INSTALL_DIR:-/opt/proxora}"
SIGNAL_DIR="${PROXORA_UPDATE_SIGNAL_DIR:-/update-signal}"
REPO="${PROXORA_REPO:-MarcelRuh/proxora}"
BRANCH="${PROXORA_BRANCH:-main}"
UPDATER_NAME="proxora-self-updater"
UPDATER_IMAGE="${PROXORA_UPDATER_IMAGE:-docker:27.5.1-cli}"
SIGNAL_VOLUME="${PROXORA_SIGNAL_VOLUME:-proxora_update_signal}"
NETWORK="${PROXORA_DOCKER_NETWORK:-proxora_default}"
APPLY="${INSTALL_DIR}/scripts/self-update-apply.sh"
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
  if [ ! -f "$APPLY" ]; then
    echo "ERROR: missing $APPLY" >&2
    return 1
  fi
  docker rm -f "$UPDATER_NAME" >/dev/null 2>&1 || true
  set -- docker run -d --init --name "$UPDATER_NAME" \
    -v "${INSTALL_DIR}:${INSTALL_DIR}" \
    -v "${SIGNAL_VOLUME}:/update-signal" \
    -e "PROXORA_INSTALL_DIR=${INSTALL_DIR}" \
    -e "PROXORA_REPO=${REPO}" \
    -e "PROXORA_BRANCH=${BRANCH}" \
    -e "PROXORA_SKIP_COMPOSE=0" \
    -e "PROXORA_UPDATE_SIGNAL_DIR=/update-signal" \
    -w "$INSTALL_DIR" \
    --label proxora.update=self
  if [ -n "${DOCKER_HOST:-}" ]; then
    set -- "$@" --network "$NETWORK" -e "DOCKER_HOST=${DOCKER_HOST}"
  else
    set -- "$@" -v /var/run/docker.sock:/var/run/docker.sock
  fi
  "$@" "$UPDATER_IMAGE" sh "$APPLY"
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
