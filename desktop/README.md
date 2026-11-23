# Proxora for Desktop

Official desktop client (Rust / Tauri 2). It is a system WebView around your self-hosted Proxora — **same model as the Android app**: dashboard, hosts, VMs/LXC, console, files, backups, WireGuard, updates.

This is not a second API. Login, cookies, CSRF and roles apply unchanged.

## Download

Tagged GitHub releases ship Linux packages:

- `Proxora_<version>_amd64.AppImage`
- `Proxora_<version>_amd64.deb`
- `Proxora-<version>-1.x86_64.rpm`

Windows builds (`.msi` / NSIS `.exe`) are produced on tagged releases. The NSIS installer uses **per-machine** mode (`C:\Program Files\Proxora`, admin required).

macOS builds are universal (Apple Silicon + Intel, macOS 10.15+):

- `Proxora_<version>_universal.dmg`
- `Proxora_<version>_universal.app.tar.gz` (also used by the in-app updater)

The macOS app is ad-hoc signed and **not notarized**. Gatekeeper blocks it until the quarantine flag is removed: `xattr -dr com.apple.quarantine /Applications/Proxora.app`.

The easiest way to get a client is the **Clients herunterladen / Download clients** card on the Proxora page (`/proxora`) of your instance. It offers the Windows `.exe`, the Android APK and a macOS install script (`install-proxora-macos.sh`) that downloads the app, installs it to `/Applications`, removes the quarantine flag and presets your server URL.

## Use

1. Install or run the AppImage / package.
2. Enter your Proxora URL, e.g. `http://192.168.178.246:3000` or `https://proxora.home.arpa`.
3. Optional: enable **Allow insecure TLS** for self-signed LAN HTTPS (best-effort; prefer HTTP on LAN or a trusted cert).
4. Sign in as usual. Session cookies stay in the WebView until you change the server.
5. Menu **Proxora → Reload** or **Change server…**.

External links open in your system browser. Same-origin navigation stays in the app.

## Build

Requirements:

- Rust stable (`rustup`)
- Node.js 20+
- Linux: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `patchelf`
- Windows: WebView2 runtime (bootstrapper is bundled by Tauri)
- macOS: Xcode command line tools; for a universal build `rustup target add aarch64-apple-darwin x86_64-apple-darwin` and `npm run build -- --target universal-apple-darwin`

```bash
cd desktop
npm install
npm run build
```

Dev:

```bash
cd desktop
npm install
npm run dev
```

Artifacts land under `src-tauri/target/release/bundle/`.

## Layout

| Path | Role |
| --- | --- |
| `ui/` | Setup screen (URL + insecure TLS) |
| `src-tauri/` | Tauri shell, prefs, menu, navigation |
| Prefs file | `~/.config/proxora-desktop/prefs.json` (Linux), `~/Library/Application Support/proxora-desktop/prefs.json` (macOS) |
