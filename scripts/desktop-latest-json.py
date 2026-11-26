#!/usr/bin/env python3
"""Build Tauri updater latest.json from a GitHub release's assets + .sig files.

Usage:
  python3 scripts/desktop-latest-json.py v2.4.4 [--repo MarcelRuh/proxora] [--out latest.json]

Expects the release to already contain:
  Proxora_<ver>_amd64.AppImage (+ .sig)
  Proxora_<ver>_x64-setup.exe (+ .sig)
Optional (added to darwin-* platforms when present):
  Proxora_<ver>_universal.app.tar.gz (+ .sig)
Optional (linux-x86_64-deb / linux-x86_64-rpm, so installed packages update as packages):
  Proxora_<ver>_amd64.deb (+ .sig)
  Proxora-<ver>-<release>.x86_64.rpm (+ .sig)
"""
from __future__ import annotations

import argparse
import json
import re
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
    mac_archive = f"Proxora_{ver}_universal.app.tar.gz"
    deb = f"Proxora_{ver}_amd64.deb"
    rpm_pattern = re.compile(rf"^Proxora-{re.escape(ver)}-\d+\.x86_64\.rpm$")
    rpm = next((n for n in sorted(assets) if rpm_pattern.match(n)), None)
    # Package entries without a signature would break the updater, so they are added only in pairs.
    packages = {
        key: name
        for key, name in (("linux-x86_64-deb", deb), ("linux-x86_64-rpm", rpm))
        if name and name in assets and f"{name}.sig" in assets
    }
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
        mac_sig = None
        if mac_archive in assets and f"{mac_archive}.sig" in assets:
            subprocess.check_call(
                ["gh", "release", "download", tag, "-R", args.repo, "-D", str(tmp_path), "-p", f"{mac_archive}.sig"]
            )
            mac_sig = read_sig(tmp_path / f"{mac_archive}.sig")
        package_sigs = {}
        for key, name in packages.items():
            subprocess.check_call(
                ["gh", "release", "download", tag, "-R", args.repo, "-D", str(tmp_path), "-p", f"{name}.sig"]
            )
            package_sigs[key] = read_sig(tmp_path / f"{name}.sig")

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
    if mac_sig:
        # One universal build serves both Apple Silicon and Intel Macs.
        for key in ("darwin-aarch64", "darwin-x86_64"):
            payload["platforms"][key] = {"signature": mac_sig, "url": f"{base}/{mac_archive}"}
    for key, name in packages.items():
        payload["platforms"][key] = {"signature": package_sigs[key], "url": f"{base}/{name}"}
    out = Path(args.out)
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
