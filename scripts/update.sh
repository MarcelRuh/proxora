#!/usr/bin/env bash
# Proxora host-side updater (CLI counterpart to Settings → Updates)
#
# wget -qO- https://raw.githubusercontent.com/MarcelRuh/proxora/main/scripts/update.sh | bash
set -euo pipefail

REPO="${PROXORA_REPO:-MarcelRuh/proxora}"
BRANCH="${PROXORA_BRANCH:-main}"
INSTALL_DIR="${PROXORA_DIR:-${PROXORA_INSTALL_DIR:-/opt/proxora}}"

export PROXORA_INSTALL_DIR="$INSTALL_DIR"
export PROXORA_REPO="$REPO"
export PROXORA_BRANCH="$BRANCH"

if [[ -f "${INSTALL_DIR}/scripts/self-update-apply.sh" ]]; then
  exec sh "${INSTALL_DIR}/scripts/self-update-apply.sh"
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
wget -qO "$TMP" "https://raw.githubusercontent.com/${REPO}/${BRANCH}/scripts/self-update-apply.sh"
chmod +x "$TMP"
exec sh "$TMP"
