#!/usr/bin/env python3
"""Build Tauri updater latest.json from a GitHub release's assets + .sig files.

Usage:
  python3 scripts/desktop-latest-json.py v2.4.4 [--repo MarcelRuh/proxora] [--out latest.json]

Expects the release to already contain:
  Proxora_<ver>_amd64.AppImage (+ .sig)
  Proxora_<ver>_x64-setup.exe (+ .sig)
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory


def gh_json(args: list[str]) -> object:
    raw = subprocess.check_output(["gh", *args], text=True)
    return json.loads(raw)


def read_sig(path: Path) -> str:
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        raise SystemExit(f"empty signature: {path}")
    return text


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("tag", help="Release tag, e.g. v2.4.4")
    parser.add_argument("--repo", default="MarcelRuh/proxora")
    parser.add_argument("--out", default="latest.json")
    parser.add_argument("--notes", default="")
    args = parser.parse_args()

    tag: str = args.tag
    ver = tag.lstrip("v")
    release = gh_json(["release", "view", tag, "-R", args.repo, "--json", "assets,publishedAt,body"])
    assets = {a["name"]: a["url"] for a in release["assets"]}
    # Prefer browser download URLs via pattern on github releases/download
    base = f"https://github.com/{args.repo}/releases/download/{tag}"

    appimage = f"Proxora_{ver}_amd64.AppImage"
    nsis = f"Proxora_{ver}_x64-setup.exe"
    needed = [appimage, f"{appimage}.sig", nsis, f"{nsis}.sig"]
    missing = [n for n in needed if n not in assets]
    if missing:
        print(f"missing release assets: {', '.join(missing)}", file=sys.stderr)
        return 1

    with TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        subprocess.check_call(
            [
                "gh",
                "release",
                "download",
                tag,
                "-R",
                args.repo,
                "-D",
                str(tmp_path),
                "-p",
                f"{appimage}.sig",
                "-p",
                f"{nsis}.sig",
            ]
        )
        linux_sig = read_sig(tmp_path / f"{appimage}.sig")
        windows_sig = read_sig(tmp_path / f"{nsis}.sig")

    pub_date = release.get("publishedAt") or datetime.now(timezone.utc).isoformat()
    notes = (args.notes or release.get("body") or "").strip()
    # Keep notes short for the updater dialog.
    if len(notes) > 800:
        notes = notes[:797] + "..."

    payload = {
        "version": ver,
        "notes": notes,
        "pub_date": pub_date,
        "platforms": {
            "linux-x86_64": {
                "signature": linux_sig,
                "url": f"{base}/{appimage}",
            },
            "windows-x86_64": {
                "signature": windows_sig,
                "url": f"{base}/{nsis}",
            },
        },
    }
    out = Path(args.out)
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
