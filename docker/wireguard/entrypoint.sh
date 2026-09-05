#!/bin/sh
set -eu
CONF_SRC="/wireguard/wg0.conf"
CONF_DST="/etc/wireguard/wg0.conf"
DISABLED="/wireguard/disabled"
STATUS="/wireguard/status.json"
HASHFILE="/tmp/wg0.hash"
export WG_QUICK_USERSPACE_IMPLEMENTATION="${WG_QUICK_USERSPACE_IMPLEMENTATION:-wireguard-go}"
mkdir -p /etc/wireguard /dev/net 2>/dev/null || true
if [ ! -e /dev/net/tun ]; then
  mkdir -p /dev/net
  mknod /dev/net/tun c 10 200 2>/dev/null || true
  chmod 666 /dev/net/tun 2>/dev/null || true
fi

write_status() {
  printf '{"up":%s,"error":%s}\n' "$1" "$2" > "$STATUS" || true
}

apply() {
  if [ -f "$DISABLED" ] || [ ! -f "$CONF_SRC" ]; then
    wg-quick down wg0 >/dev/null 2>&1 || true
    write_status false null
    return 0
  fi
  HASH="$(md5sum "$CONF_SRC" | awk '{print $1}')"
  OLD="$(cat "$HASHFILE" 2>/dev/null || true)"
  if [ "$HASH" = "$OLD" ] && wg show wg0 >/dev/null 2>&1; then
    write_status true null
    return 0
  fi
  cp "$CONF_SRC" "$CONF_DST"
  chmod 600 "$CONF_DST"
  wg-quick down wg0 >/dev/null 2>&1 || true
  if wg-quick up wg0; then
    echo "$HASH" > "$HASHFILE"
    write_status true null
  else
    write_status false '"wg-quick failed"'
  fi
}

write_status false null
while true; do
  apply || write_status false '"apply failed"'
  sleep 2
done
