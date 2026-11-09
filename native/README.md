# Proxora Native

Eigenständiger **Rust-/egui**-Desktop-Client für Proxora. Spricht die bestehende HTTP-API an (Session-Cookie `pm_session`) — **kein WebView**.

Zielbild: langfristig die Web-Oberfläche ersetzen. Heute: MVP mit denselben Kernfunktionen.

## Features (MVP)

- Server-URL + optionales insecure TLS
- Login inkl. TOTP/Recovery
- Übersicht (Dashboard-Metriken)
- Hosts-Liste
- Gäste (VMs + LXC) mit Start / Shutdown / Reboot / Stop
- Eigene UI (dunkles Native-Theme), nicht die Next.js-App

## Voraussetzungen

- Rust stable (`rustup`)
- Linux: typische egui/OpenGL-Deps (`libgtk-3`, Mesa/GL)
- Laufende Proxora-Instanz (z. B. `http://192.168.178.246:3000`)

## Start

```bash
cd native
cargo run --release
```

Debug:

```bash
cargo run
```

## Architektur

| Schicht | Inhalt |
| --- | --- |
| `src/api/` | Blocking `reqwest`-Client, Models, Power-Actions |
| `src/prefs.rs` | `~/.config/proxora-native/prefs.json` |
| `src/app.rs` | egui-Screens + Background-Worker-Thread |

Auth wie im Browser: `POST /api/auth/login` setzt Cookie; Folge-Requests nutzen Cookie-Jar. Ohne `Origin`-Header (kein Browser) greift CSRF-Check nicht blockierend.

## Roadmap (Richtung Web-Ablösung)

1. Console (xterm/VNC) — native oder eingebettetes Terminal
2. Guest-Detail, Config, Snapshots
3. Backups, Storage, Templates
4. Community Scripts
5. Users/Roles/Settings
6. Web-UI optional deprecaten, wenn Parität erreicht

## Hinweis

Der bestehende Tauri-Client unter `desktop/` bleibt der **WebView-Shell**. `native/` ist der parallele API-first-Client.
