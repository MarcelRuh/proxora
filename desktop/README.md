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

To check the Windows and macOS builds before tagging, start the CI by hand (**Actions → CI → Run workflow**). Such runs keep the packages as workflow artifacts only: no updater signatures, no release upload.

The easiest way to get a client is the **Clients herunterladen / Download clients** card on the Proxora page (`/proxora`) of your instance. It offers the Windows `.exe` (and `.msi`), the Linux AppImage, `.deb` and `.rpm`, the Android APK and a macOS install script (`install-proxora-macos.sh`). The download buttons go through your Proxora server, so the device does not need to reach GitHub.

The macOS script fetches the app from GitHub, checks its SHA-256, quits a running Proxora, installs it to `/Applications` owned by you (so updates need no password; `~/Applications` without admin rights), removes the quarantine flag and presets your server URL if none is configured yet. Options: `--tag vX.Y.Z`, `--server URL`, `--help`.

## Use

1. Install or run the AppImage / package.
2. Enter your Proxora URL, e.g. `http://192.168.178.246:3000` or `https://proxora.home.arpa`.
3. Self-signed HTTPS on the LAN (prefer HTTP on the LAN or a trusted certificate):
   - Linux / Windows: enable **Allow insecure TLS**. Windows restarts the app once to apply it.
   - macOS: the option is not offered, because the system WebView cannot skip certificate errors. Add the certificate in Keychain Access and set it to **Always Trust**.
4. Sign in as usual. Session cookies stay in the WebView until you change the server.
5. Menu **Proxora → Reload** or **Change server…**.

External links open in your system browser. Same-origin navigation stays in the app.

If the server cannot be loaded, the app stays on (or returns to) the setup screen and shows why: no answer within 15 seconds, certificate error or connection error.

## Updates

The app checks for updates on start and via **Proxora → Check for updates…**. Updates are signed (Tauri updater, `latest.json` on the GitHub release).

- AppImage, Windows and macOS download and install updates themselves, then restart.
- `.deb` / `.rpm`: the start check only reports a new version. **Check for updates…** installs the signed package of the same type and asks for the admin password. If a release has no such package, download it from the Proxora page.

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
| `ui/` | Setup screen (URL, insecure TLS, connection errors) |
| `src-tauri/` | Tauri shell, prefs, menu, navigation, updater |
| `src-tauri/Info.plist` | macOS additions: plain HTTP in the WebView (App Transport Security), local network prompt text |
| Prefs file | `~/.config/proxora-desktop/prefs.json` (Linux), `~/Library/Application Support/proxora-desktop/prefs.json` (macOS), `%APPDATA%\proxora-desktop\prefs.json` (Windows) |
