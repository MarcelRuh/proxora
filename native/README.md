# Proxora Native

Eigenständiger **Rust-/egui**-Desktop-Client für Proxora. Spricht die bestehende HTTP-API an (Session-Cookie `pm_session`) — **kein WebView**.

Zielbild: langfristig die Web-Oberfläche ersetzen.

## Features

- Eigene Titelleiste (kein OS-Chrome) mit Drag / Min / Max / Close
- Sidebar-Navigation, Control-Room-Theme (Charcoal + Acid Green)
- Server-URL + optionales insecure TLS
- Login inkl. TOTP/Recovery
- Übersicht (Dashboard-Metriken + Ressourcenbalken)
- Hosts-Liste
- Gäste (VMs + LXC) mit Start / Shutdown / Reboot / Stop
- **Auto-Updater** über GitHub Releases (`native-v*` / ProxoraNative-Assets)

## Voraussetzungen

- Rust stable (`rustup`)
- Linux: typische egui/OpenGL-Deps (`libgtk-3`, Mesa/GL)
- Laufende Proxora-Instanz

## Windows-Installer

CI baut unter Tags `v*` / `native-v*` (oder manuell via Workflow **Native Client**):

- `ProxoraNative_<version>_x64-setup.exe` — NSIS-Installer
- `ProxoraNative_<version>_x64-portable.zip` — portable `.exe`

```bash
gh workflow run native-client.yml
gh run watch
```

> Nicht verwechseln mit dem **Tauri-WebView**-Installer `Proxora_*_x64-setup.exe`.

## Start (Entwicklung)

```bash
cd native
cargo run --release
```

## Architektur

| Schicht | Inhalt |
| --- | --- |
| `src/api/` | Blocking `reqwest`-Client, Models, Power-Actions |
| `src/prefs.rs` | Config unter Proxora/proxora-native |
| `src/theme.rs` | Farben, Typo, Visuals |
| `src/updater.rs` | GitHub-Release-Check, Download, Installer-Launch |
| `src/app.rs` | Custom Titlebar, Sidebar, Screens, Worker |

## Updater

Beim Start (und über „Nach Updates suchen“) prüft der Client `MarcelRuh/proxora` Releases:

1. Tags `native-vX.Y.Z` mit Asset `ProxoraNative_*_x64-setup.exe` (Windows) bzw. `*_linux_amd64.tar.gz`
2. Banner bei neuer Version → Download → Installieren & Neustart (Windows startet den NSIS-Installer und beendet die App)

## Version

Aktuell: **0.2.0** (`Cargo.toml`).
