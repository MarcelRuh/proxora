#!/usr/bin/env bash
# Validate that a GitHub release has a usable Tauri updater manifest.
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
python3 - <<PY
import json, sys
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
    assert entry.get("url"), f"{key}.url missing"
    sig = entry.get("signature") or ""
    assert len(sig) > 80, f"{key}.signature too short"
    assert "github.com" in entry["url"], f"{key}.url unexpected: {entry['url']}"
print("ok: latest.json platforms", ", ".join(sorted(platforms)))
PY

echo "==> Desktop updater smoke OK"
