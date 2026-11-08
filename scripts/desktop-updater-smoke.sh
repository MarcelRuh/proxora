#!/usr/bin/env bash
# Validate that a GitHub release has a usable Tauri updater manifest + signed assets.
# Usage: scripts/desktop-updater-smoke.sh [v2.4.8] [--repo MarcelRuh/proxora]
set -euo pipefail

REPO="MarcelRuh/proxora"
TAG="${1:-}"
if [[ "${2:-}" == "--repo" ]]; then
  REPO="${3:?repo}"
elif [[ "${1:-}" == "--repo" ]]; then
  REPO="${2:?repo}"
  TAG="${3:-}"
fi

if [[ -z "$TAG" ]]; then
  TAG="$(gh release view -R "$REPO" --json tagName --jq .tagName)"
fi

echo "==> Smoke-checking desktop updater for ${REPO} ${TAG}"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

gh release download "$TAG" -R "$REPO" -D "$tmpdir" -p latest.json
gh release download "$TAG" -R "$REPO" -D "$tmpdir" -p '*.sig' || true

python3 - <<PY
import json, sys, urllib.request
from pathlib import Path
p = Path("${tmpdir}") / "latest.json"
data = json.loads(p.read_text())
ver = str(data.get("version", "")).lstrip("v")
tag = "${TAG}".lstrip("v")
assert ver == tag, f"latest.json version {ver!r} != tag {tag!r}"
platforms = data.get("platforms") or {}
for key in ("linux-x86_64", "windows-x86_64"):
    entry = platforms.get(key)
    assert isinstance(entry, dict), f"missing platform {key}"
    url = entry.get("url") or ""
    assert url, f"{key}.url missing"
    sig = entry.get("signature") or ""
    assert len(sig) > 80, f"{key}.signature too short"
    assert "github.com" in url, f"{key}.url unexpected: {url}"
    # HEAD the payload so updater clients will not get a 404 mid-install.
    req = urllib.request.Request(url, method="HEAD")
    with urllib.request.urlopen(req, timeout=30) as res:
        code = getattr(res, "status", None) or res.getcode()
        assert 200 <= int(code) < 400, f"{key} HEAD {code}"
        length = res.headers.get("Content-Length")
        if length is not None:
            assert int(length) > 1_000_000, f"{key} Content-Length too small: {length}"
print("ok: latest.json platforms", ", ".join(sorted(platforms)))
PY

sig_count="$(find "$tmpdir" -type f -name '*.sig' | wc -l | tr -d ' ')"
if [[ "$sig_count" -lt 1 ]]; then
  echo "warn: no .sig assets downloaded (embedded signature in latest.json still required)" >&2
else
  echo "ok: ${sig_count} .sig asset(s) present"
fi

echo "==> Desktop updater smoke OK"
