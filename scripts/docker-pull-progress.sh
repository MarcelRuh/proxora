#!/bin/sh
# Pull via Docker Engine API with real layer byte progress (streaming).
# Usage:
#   docker-pull-progress.sh <image:tag> [progress_file]
# Maps engine 0–100% into the self-update pull band 32–74.
set -eu

IMAGE="${1:?image required}"
PROGRESS_OUT="${2:-}"

case "$IMAGE" in
  *:*) NAME="${IMAGE%:*}"; TAG="${IMAGE##*:}" ;;
  *) NAME="$IMAGE"; TAG="latest" ;;
esac
ENC="$(printf '%s' "$NAME" | sed 's|/|%2F|g')"

if ! command -v curl >/dev/null 2>&1; then
  if command -v apk >/dev/null 2>&1; then
    apk add --no-cache curl >/dev/null
  fi
fi

write_ui() {
  raw_pct="$1"
  detail="$2"
  mapped=$((32 + (raw_pct * 42) / 100))
  if [ "$mapped" -lt 32 ]; then mapped=32; fi
  if [ "$mapped" -gt 74 ]; then mapped=74; fi
  echo "==> [${mapped}%] pull – ${detail}"
  if [ -n "$PROGRESS_OUT" ]; then
    printf 'percent=%s\nstep=%s\ndetail=%s\n' "$mapped" pull "$detail" > "$PROGRESS_OUT"
    if [ -n "${PROXORA_UPDATE_SIGNAL_DIR:-}" ] && [ -d "${PROXORA_UPDATE_SIGNAL_DIR}" ]; then
      cp "$PROGRESS_OUT" "${PROXORA_UPDATE_SIGNAL_DIR}/.proxora-update-progress" 2>/dev/null || true
    fi
  fi
}

fallback_pull() {
  write_ui 10 "Pulling ${IMAGE} via docker pull"
  docker pull "$IMAGE"
  write_ui 100 "Image ready"
}

if ! command -v curl >/dev/null 2>&1; then
  fallback_pull
  exit 0
fi

STATE="$(mktemp -d)"
trap 'rm -rf "$STATE"' EXIT
ERR_FILE="${STATE}/error"
RC_FILE="${STATE}/curl.rc"
: > "${STATE}/raw.log"
printf '1\n' > "$RC_FILE"

write_ui 5 "Contacting registry…"

# Stream JSON status lines; capture curl exit separately.
(
  set +e
  curl -sS -N --unix-socket /var/run/docker.sock \
    -X POST "http://localhost/v1.45/images/create?fromImage=${ENC}&tag=${TAG}"
  echo $? > "$RC_FILE"
) | while IFS= read -r line || [ -n "$line" ]; do
  [ -z "$line" ] && continue
  printf '%s\n' "$line" >> "${STATE}/raw.log"
  case "$line" in
    *'"error"'*)
      printf '%s\n' "$line" > "$ERR_FILE"
      ;;
  esac

  id="$(printf '%s' "$line" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)"
  status="$(printf '%s' "$line" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p' | head -1)"
  current="$(printf '%s' "$line" | sed -n 's/.*"current":\([0-9][0-9]*\).*/\1/p' | head -1)"
  total="$(printf '%s' "$line" | sed -n 's/.*"total":\([0-9][0-9]*\).*/\1/p' | head -1)"

  case "$status" in
    Downloading|Extracting)
      if [ -n "$id" ] && [ -n "${current:-}" ] && [ -n "${total:-}" ] && [ "$total" -gt 0 ]; then
        printf '%s %s\n' "$current" "$total" > "${STATE}/l-${id}"
      fi
      ;;
    "Download complete"|"Pull complete"|"Already exists")
      if [ -n "$id" ]; then
        if [ -f "${STATE}/l-${id}" ]; then
          tot="$(awk '{print $2}' "${STATE}/l-${id}")"
          printf '%s %s\n' "$tot" "$tot" > "${STATE}/l-${id}"
        else
          printf '1 1\n' > "${STATE}/l-${id}"
        fi
      fi
      ;;
  esac

  cur=0
  tot=0
  for f in "$STATE"/l-*; do
    [ -f "$f" ] || continue
    c="$(awk '{print $1}' "$f")"
    t="$(awk '{print $2}' "$f")"
    cur=$((cur + c))
    tot=$((tot + t))
  done
  if [ "$tot" -gt 0 ]; then
    pct=$((cur * 100 / tot))
    [ "$pct" -gt 99 ] && pct=99
    mb_c=$((cur / 1048576))
    mb_t=$((tot / 1048576))
    write_ui "$pct" "Downloading ${mb_c}/${mb_t} MiB"
  fi
done

CURL_RC="$(cat "$RC_FILE" 2>/dev/null || echo 1)"
if [ -f "$ERR_FILE" ]; then
  cat "$ERR_FILE" >&2
  exit 1
fi
if [ "$CURL_RC" != "0" ]; then
  echo "docker API pull failed (exit ${CURL_RC})" >&2
  fallback_pull
  exit 0
fi
if grep -qi 'manifest unknown\|not found' "${STATE}/raw.log" 2>/dev/null; then
  echo "manifest unknown for ${IMAGE}" >&2
  exit 1
fi

write_ui 100 "Image ready"
exit 0
