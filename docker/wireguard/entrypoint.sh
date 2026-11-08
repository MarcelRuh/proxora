#!/bin/sh
set -eu
CONF_SRC="/wireguard/wg0.conf"
CONF_DST="/etc/wireguard/wg0.conf"
DISABLED="/wireguard/disabled"
STATUS="/wireguard/status.json"
LOG="/wireguard/apply.log"
HASHFILE="/tmp/wg0.hash"
export WG_QUICK_USERSPACE_IMPLEMENTATION="${WG_QUICK_USERSPACE_IMPLEMENTATION:-wireguard-go}"
mkdir -p /etc/wireguard /dev/net /wireguard 2>/dev/null || true
touch "$LOG" 2>/dev/null || true
if [ ! -e /dev/net/tun ]; then
  mkdir -p /dev/net
  mknod /dev/net/tun c 10 200 2>/dev/null || true
  chmod 666 /dev/net/tun 2>/dev/null || true
fi

log_line() {
  # Keep last ~200 lines so the UI stays readable.
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG" || true
  tail -n 200 "$LOG" > "${LOG}.tmp" 2>/dev/null && mv "${LOG}.tmp" "$LOG" || true
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g' | tr '\n' ' ' | sed 's/ *$//'
}

write_status() {
  up="$1"
  err_json="$2"
  checked="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  dump=""
  if [ "$up" = "true" ] && command -v wg >/dev/null 2>&1; then
    # Drop interface line (contains private key); keep peer rows only.
    dump="$(wg show wg0 dump 2>/dev/null | tail -n +2 || true)"
  fi
  # Shell-safe JSON without jq: dump goes as a JSON string.
  dump_json="null"
  if [ -n "$dump" ]; then
    dump_json="\"$(json_escape "$dump")\""
  fi
  printf '{"up":%s,"error":%s,"checkedAt":"%s","dump":%s}\n' "$up" "$err_json" "$checked" "$dump_json" > "$STATUS" || true
}

# Locally generated TCP (Proxora → colleague) must clamp MSS; FORWARD never sees it.
clamp_wg_mss() {
  iptables -t mangle -C OUTPUT -o wg0 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null ||
    iptables -t mangle -A OUTPUT -o wg0 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu || true
  iptables -t mangle -C INPUT -i wg0 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null ||
    iptables -t mangle -A INPUT -i wg0 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu || true
}

apply() {
  if [ -f "$DISABLED" ] || [ ! -f "$CONF_SRC" ]; then
    if [ -f "$DISABLED" ]; then
      log_line "tunnel disabled"
    else
      log_line "no wg0.conf yet"
    fi
    wg-quick down wg0 >/dev/null 2>&1 || true
    write_status false null
    return 0
  fi
  HASH="$(md5sum "$CONF_SRC" | awk '{print $1}')"
  OLD="$(cat "$HASHFILE" 2>/dev/null || true)"
  if [ "$HASH" = "$OLD" ] && wg show wg0 >/dev/null 2>&1; then
    ip link set dev wg0 mtu 1280 2>/dev/null || true
    clamp_wg_mss
    write_status true null
    return 0
  fi
  cp "$CONF_SRC" "$CONF_DST"
  chmod 600 "$CONF_DST"
  log_line "applying wg0.conf ($HASH)"
  wg-quick down wg0 >/dev/null 2>&1 || true
  OUT="$(mktemp)"
  if wg-quick up wg0 >"$OUT" 2>&1; then
    echo "$HASH" > "$HASHFILE"
    ip link set dev wg0 mtu 1280 2>/dev/null || true
    clamp_wg_mss
    log_line "wg-quick up ok"
    while IFS= read -r line || [ -n "$line" ]; do
      [ -n "$line" ] && log_line "wg-quick: $line"
    done < "$OUT"
    rm -f "$OUT"
    write_status true null
  else
    msg="$(tail -n 8 "$OUT" | tr '\n' ' ' | cut -c1-240)"
    log_line "wg-quick up failed: ${msg:-unknown}"
    while IFS= read -r line || [ -n "$line" ]; do
      [ -n "$line" ] && log_line "wg-quick: $line"
    done < "$OUT"
    rm -f "$OUT"
    write_status false "\"$(json_escape "${msg:-wg-quick failed}")\""
  fi
}

write_status false null
log_line "wireguard sidecar started"
while true; do
  apply || {
    log_line "apply crashed"
    write_status false '"apply failed"'
  }
  sleep 2
done
