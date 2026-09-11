#!/usr/bin/env python3
"""Snapshot GitHub `stats` release download counts into usage.json + README.md."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


def gh_json(*args: str) -> dict:
    out = subprocess.check_output(["gh", "api", *args], text=True)
    return json.loads(out)


def asset_count(release: dict, name: str) -> int:
    total = 0
    for asset in release.get("assets") or []:
        if asset.get("name") == name:
            total += int(asset.get("download_count") or 0)
    return total


def weekly_active(history: list[dict], now: datetime) -> int:
    if not history:
        return 0
    latest = history[-1]
    cutoff = now - timedelta(days=7)
    baseline = int(history[0].get("live") or 0)
    for item in history:
        raw = str(item.get("at") or "")
        try:
            ts = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            continue
        if ts <= cutoff:
            baseline = int(item.get("live") or 0)
    return max(0, int(latest.get("live") or 0) - baseline)


def main() -> int:
    repo = os.environ.get("GITHUB_REPOSITORY", "MarcelRuh/proxora")
    tag = os.environ.get("USAGE_RELEASE_TAG", "stats")
    out_dir = Path(os.environ.get("USAGE_OUT", "usage-out"))
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        release = gh_json(f"repos/{repo}/releases/tags/{tag}")
    except subprocess.CalledProcessError:
        print(f"release {tag} missing", file=sys.stderr)
        return 1

    now = datetime.now(timezone.utc)
    row = {
        "at": now.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "install": asset_count(release, "install"),
        "live": asset_count(release, "live"),
    }

    history_path = out_dir / "usage.json"
    history: list[dict] = []
    if history_path.exists():
        loaded = json.loads(history_path.read_text())
        if isinstance(loaded, list):
            history = loaded

    if history and str(history[-1].get("at", ""))[:10] == row["at"][:10]:
        history[-1] = row
    else:
        history.append(row)
    history = history[-400:]
    latest = history[-1]
    active = weekly_active(history, now)
    latest["active7d"] = active
    history_path.write_text(json.dumps(history, indent=2) + "\n")
    readme = f"""# Proxora usage

Anonymous counts from GitHub release downloads on the `{tag}` prerelease.
No instance IDs, IPs, or hostnames are written to this repo — installs and running copies only GET a dummy file.

| Metric | Count |
| --- | ---: |
| wget installs | {latest["install"]} |
| Active (~7 days) | {active} |
| Cumulative weekly pings | {latest["live"]} |

Updated **{row["at"]}**.

Opt out: set `PROXORA_TELEMETRY=0` in `.env`.

[Release](https://github.com/{repo}/releases/tag/{tag}) · [Main repo](https://github.com/{repo})
"""
    (out_dir / "README.md").write_text(readme)
    print(f"installs={latest['install']} live={latest['live']} active7d={active}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
