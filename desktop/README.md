# Proxora for Desktop

Official desktop client (Rust / Tauri 2). It is a system WebView around your self-hosted Proxora — **same model as the Android app**: dashboard, hosts, VMs/LXC, console, files, backups, WireGuard, updates.

This is not a second API. Login, cookies, CSRF and roles apply unchanged.

## Download

Tagged GitHub releases ship Linux packages:

- `Proxora_<version>_amd64.AppImage`
- `Proxora_<version>_amd64.deb`
- `Proxora-<version>-1.x86_64.rpm`

Windows builds (`.msi` / `.exe`) are produced when the Windows CI runner is available for a tag; you can also build locally on Windows (see below).

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
| Prefs file | `~/.config/proxora-desktop/prefs.json` (Linux) |
