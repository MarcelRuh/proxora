# Proxora Desktop (nativ)

Eigenständiger Desktop-Client für Proxora in **Rust + egui** (aktuell **0.3.1**). Spricht die Proxora-HTTP-API direkt an (Session-Cookie `pm_session`) — kein WebView, keine eingebettete Web-Oberfläche.

Design: Proxora-Web-DNA (Pink/Lila/Cyan), dichteres Native-Chrome mit eigener Titelleiste.

## Funktionen

| Bereich | Inhalt |
| --- | --- |
| Übersicht | Cluster-Kennzahlen, Hinweise (Host-Fehler, Updates, volle Storages, CPU-Temperatur, fehlgeschlagene Tasks), Host-Tabelle |
| Hosts | Liste + Inspector (Nodes mit CPU/RAM/RootFS, Cluster/Quorum, Gäste, Storage), Hinzufügen/Bearbeiten mit Verbindungstest, Wartungsmodus, Node-Neustart/-Shutdown, Entfernen |
| VMs & Container | Filter, Sortierung, Mehrfachauswahl, Power-Aktionen; Inspector mit Übersicht, Konfigurations-Editor (inkl. Disk-Vergrößern, Windows-Profil, Rohschlüssel), Snapshots, Backups/Restore, Firewall, HA, Dateien (Guest Agent oder SFTP), Klonen, Migrieren, Löschen |
| Erstellen | VM- und Container-Assistent (ISO/Vorlage, Storage, Netz, statische IPs aus den Gast-Netzen, Start nach Anlage) |
| Konsole | Natives Terminal (Host-Shell, LXC, serielle VM-Konsole, `apt dist-upgrade`, Community-Skripte), SPICE über remote-viewer, VNC im Browser |
| Daten | Storage-Inhalte mit Löschen, ZFS-Pools inkl. Disk-Status, Backup-Jobs (Zeitplan, Aufbewahrung), Backup-Dateien, Restore, Aufräumen verwaister Backups |
| Betrieb | Vorlagen & ISOs, Community-Skripte, Proxmox-Aufgaben mit Live-Log und Abbrechen, APT-Updates mit Upgrade |
| System | Proxora-Self-Update + DB-Backup, Benutzer, Rollen, Audit-Log, WireGuard/Freigaben, Einstellungen (Passwort, 2FA, Sitzungen, Gast-Netze, Alarme, Benachrichtigungen, Suite-Apps) |
| Desktop | Eigene Titelleiste, Befehlspalette (Strg+K), Zurück/Vor, einklappbare Seitenleiste, Aufgaben-Leiste mit Fortschritt, Toasts, Auto-Updater |

Tastenkürzel: `Strg+K` Suche/Befehle · `F5`/`Strg+R` aktualisieren · `Strg+B` Seitenleiste · `Alt+←/→` Verlauf. Im fokussierten Terminal gehen alle Tasten an die Shell.

## Installation

Releases mit Tag `native-v*` enthalten:

- `ProxoraNative_<version>_x64-setup.exe` — Windows-Installer (NSIS)
- `ProxoraNative_<version>_x64-portable.zip` — portable `.exe`
- `ProxoraNative_<version>_linux_amd64.tar.gz`

Die App prüft beim Start auf neue Releases und installiert sie auf Wunsch selbst (Einstellungen › Desktop-App).

> Nicht verwechseln mit dem Tauri-Installer `Proxora_*_x64-setup.exe`, der die Web-Oberfläche lädt.

## Entwicklung

```bash
cd native
cargo run --release          # App starten
cargo test --release --lib   # Unit-Tests
```

UI-Screenshots ohne Server und ohne GPU (Demo-Daten, CPU-Rasterizer):

```bash
cargo run --release --example snapshot --features demo -- /tmp/snaps            # alle Szenen
cargo run --release --example snapshot --features demo -- /tmp/snaps dashboard  # einzelne Szene
```

## Architektur

| Pfad | Inhalt |
| --- | --- |
| `src/net/` | Blocking-`reqwest`-Client, tolerante serde-Modelle, Rechteprüfung wie `lib/permissions.ts`, `Resource<T>` (Laden/Fehler/Veralten) |
| `src/app/` | Fenster-Chrome, Arbeitsbereich mit Seitenleiste/Statusleiste, Befehlspalette, Dialoge, gemeinsamer Zustand mit Aktionen + Proxmox-Task-Verfolgung |
| `src/pages/` | Eine Datei pro Bereich |
| `src/term.rs` | `/ws/console`-WebSocket + vt100-Emulation |
| `src/ui/` | Widgets, Formatierung, Toasts |
| `src/theme.rs` | Farben, Typografie (Inter, JetBrains Mono, Orbitron), Phosphor-Icons |
| `src/updater.rs` | GitHub-Release-Check, Download, Installer-Start |
| `src/demo.rs` | Fixtures für Screenshots (`--features demo`) |

Schriften: OFL-lizenziert, siehe `assets/fonts/OFL-*.txt`.

## Sicherheit

- „Angemeldet bleiben“ speichert das Sitzungs-Cookie unverschlüsselt im Benutzerprofil (`prefs.json`, unter Linux mit Rechten 600). Auf geteilten Rechnern abschalten.
- „Selbstsignierte Zertifikate akzeptieren“ deaktiviert die TLS-Prüfung für HTTP und Terminal-WebSocket.
- SFTP-Dateizugriff prüft den Host-Key nicht (Server-Verhalten).
