/** Desktop client downloads (Windows / macOS) published on GitHub releases by CI. */

export type ReleaseAsset = { name: string; url: string; size: number };

export type DesktopPlatform = "windows" | "windows-msi" | "macos" | "macos-app";

export type DesktopDownloads = Record<DesktopPlatform, ReleaseAsset | null>;

export const DESKTOP_PLATFORMS: DesktopPlatform[] = ["windows", "windows-msi", "macos", "macos-app"];

const PATTERNS: Record<DesktopPlatform, RegExp> = {
  windows: /^Proxora_[\d.]+_x64-setup\.exe$/i,
  "windows-msi": /^Proxora_[\d.]+_x64_[a-z-]+\.msi$/i,
  macos: /^Proxora_[\d.]+_universal\.dmg$/i,
  "macos-app": /^Proxora_[\d.]+_universal\.app\.tar\.gz$/i,
};

export const DESKTOP_CONTENT_TYPES: Record<DesktopPlatform, string> = {
  windows: "application/vnd.microsoft.portable-executable",
  "windows-msi": "application/x-msi",
  macos: "application/x-apple-diskimage",
  "macos-app": "application/gzip",
};

export function isDesktopPlatform(value: string): value is DesktopPlatform {
  return (DESKTOP_PLATFORMS as string[]).includes(value);
}

export function parseReleaseAssets(json: unknown): ReleaseAsset[] {
  if (!json || typeof json !== "object") return [];
  const assets = (json as { assets?: unknown }).assets;
  if (!Array.isArray(assets)) return [];
  const out: ReleaseAsset[] = [];
  for (const asset of assets) {
    if (!asset || typeof asset !== "object") continue;
    const raw = asset as { name?: unknown; browser_download_url?: unknown; size?: unknown };
    const name = String(raw.name ?? "");
    const url = String(raw.browser_download_url ?? "");
    if (!name || !/^https:\/\//i.test(url)) continue;
    out.push({ name, url, size: typeof raw.size === "number" ? raw.size : 0 });
  }
  return out;
}

export function pickDesktopDownloads(assets: ReleaseAsset[]): DesktopDownloads {
  const result = {} as DesktopDownloads;
  for (const platform of DESKTOP_PLATFORMS) {
    result[platform] = assets.find((a) => PATTERNS[platform].test(a.name)) ?? null;
  }
  return result;
}

/** Only http(s) origins are embedded into the install script. */
export function normalizeServerOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * macOS installer: downloads the universal app from the GitHub release, installs it to
 * /Applications (or ~/Applications), clears Gatekeeper quarantine (build is not notarized)
 * and pre-fills this Proxora server when the client has no server configured yet.
 */
export function buildMacInstallScript(opts: { repo: string; tag: string | null; serverUrl: string | null }): string {
  const tag = opts.tag && /^v?\d+\.\d+\.\d+$/.test(opts.tag) ? (opts.tag.startsWith("v") ? opts.tag : `v${opts.tag}`) : "";
  const repo = /^[\w.-]+\/[\w.-]+$/.test(opts.repo) ? opts.repo : "MarcelRuh/proxora";
  const server = normalizeServerOrigin(opts.serverUrl) ?? "";
  return `#!/bin/bash
# Proxora desktop client installer for macOS (Intel + Apple Silicon).
# Usage: bash install-proxora-macos.sh [--server URL] [--tag vX.Y.Z]
set -euo pipefail

REPO=${shellQuote(repo)}
TAG=${shellQuote(tag)}
SERVER_URL=${shellQuote(server)}

while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER_URL="\${2:-}"; shift 2 ;;
    --tag) TAG="\${2:-}"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This installer is for macOS only." >&2
  exit 1
fi

if [ -z "$TAG" ]; then
  echo "==> Looking up the latest Proxora release"
  TAG="$(curl -fsSL "https://api.github.com/repos/\${REPO}/releases/latest" | sed -n 's/.*"tag_name": *"\\([^"]*\\)".*/\\1/p' | head -1)"
  if [ -z "$TAG" ]; then
    echo "Could not determine the latest release." >&2
    exit 1
  fi
fi
VERSION="\${TAG#v}"
ASSET="Proxora_\${VERSION}_universal.app.tar.gz"
URL="https://github.com/\${REPO}/releases/download/\${TAG}/\${ASSET}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> Downloading Proxora \${VERSION}"
curl -fL --progress-bar -o "$TMP/proxora.tar.gz" "$URL"
tar -xzf "$TMP/proxora.tar.gz" -C "$TMP"
if [ ! -d "$TMP/Proxora.app" ]; then
  echo "Download did not contain Proxora.app" >&2
  exit 1
fi

DEST_DIR="/Applications"
SUDO=""
if [ ! -w "$DEST_DIR" ]; then
  if sudo -v 2>/dev/null; then
    SUDO="sudo"
  else
    DEST_DIR="$HOME/Applications"
    mkdir -p "$DEST_DIR"
  fi
fi
APP="$DEST_DIR/Proxora.app"

osascript -e 'tell application "Proxora" to quit' >/dev/null 2>&1 || true
echo "==> Installing to $APP"
$SUDO rm -rf "$APP"
$SUDO ditto "$TMP/Proxora.app" "$APP"
# Not notarized by Apple: drop the quarantine flag so Gatekeeper lets it start.
$SUDO xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

PREFS_DIR="$HOME/Library/Application Support/proxora-desktop"
PREFS="$PREFS_DIR/prefs.json"
if [ -n "$SERVER_URL" ] && [ ! -s "$PREFS" ]; then
  case "$SERVER_URL" in
    http://*|https://*) ;;
    *) echo "Ignoring invalid server URL: $SERVER_URL" >&2; SERVER_URL="" ;;
  esac
  if [ -n "$SERVER_URL" ] && ! printf '%s' "$SERVER_URL" | grep -q '["\\\\]'; then
    mkdir -p "$PREFS_DIR"
    printf '{\\n  "serverUrl": "%s",\\n  "allowInsecureTls": false,\\n  "lastPageUrl": null\\n}\\n' "$SERVER_URL" > "$PREFS"
    echo "==> Server preset: $SERVER_URL"
  fi
fi

echo "==> Done. Starting Proxora"
open "$APP"
`;
}
