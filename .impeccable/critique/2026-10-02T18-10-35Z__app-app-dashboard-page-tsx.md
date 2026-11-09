---
target: Dashboard und Host-Auslastung
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/home/proxmox-manager/app/(app)/dashboard/page.tsx"
target_fingerprint: "sha256:180e71b750fbb49729c4dce7f4edb3d1aae2d6346c22db13fe47c3b9d59e3b7f"
target_path: /home/proxmox-manager/app/(app)/dashboard/page.tsx
timestamp: 2026-10-02T18-10-35Z
slug: app-app-dashboard-page-tsx
---
Method: dual-agent (A: 266b0d24-3707-4aa6-be83-6b72bb228b90 · B: 744b2cd6-425c-4f51-9f8f-8ffc04ef04e2)

Zusätzlich: Klickpfade (36619f09-4dff-491b-b307-f51a3f10c400), Produktion (71e6f4cc-8945-491e-97aa-d0cbeac4d940).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Temperatur bleibt ein Gedankenstrich, solange Sensoren noch gelesen werden. Der Sidebar-Balken zeigt 8 %, obwohl nur ein Update verfügbar ist. |
| 2 | Match System / Real World | 2 | „Uptime (min.)“ meint die kürzeste Node-Laufzeit. „Update(s)“ und „heiß“ ohne 85 °C sprechen nicht die Betriebssprache. |
| 3 | User Control and Freedom | 3 | Abbrechen, Konsole schließen und Host-Link sind da. Schließen der Upgrade-Konsole startet sofort den Paket-Check. |
| 4 | Consistency and Standards | 2 | Dieselbe Temperatur ist auf dem Dashboard Text und auf der Hostseite ein Balken, der Grad als Prozent malt. |
| 5 | Error Prevention | 2 | Upgrade verlangt Bestätigung und Recht. Ein Host, der nicht online ist, bleibt upgrade-fähig, wenn noch eine alte Paketzahl da ist. |
| 6 | Recognition Rather Than Recall | 2 | Der Grund für „—“ liegt nur im Tooltip. Die heißeste Cluster-Node ist unbenannt. |
| 7 | Flexibility and Efficiency | 2 | Upgrade sitzt an der Karte. Es gibt kein Sammel-Upgrade und keine Altersangabe der Werte. |
| 8 | Aesthetic and Minimalist Design | 2 | Dieselbe Proxora-Update-Tatsache erscheint als Banner, Nav-Badge und Sidebar-Balken. |
| 9 | Error Recovery | 2 | Lade-Fehler haben „Erneut versuchen“. Ein Sensor-Ausfall hat keine sichtbare Aktion. |
| 10 | Help and Documentation | 2 | Die zwei Sätze im Upgrade-Dialog helfen. Auf der Fläche, auf der die Temperatur fehlt, ist die Hilfe ein Hover. |
| **Total** | | **21/40** | **Schwach, benutzbar** |

Kognitive Last: 7 von 8 Prüfpunkten fehlen. Bestanden hat nur die Gruppierung der Karten. Hohe Last.

## Design Specificity Verdict

**LLM:** Die Shell ist für Proxora geschrieben (Betrieb / Daten / System, Upgrade-Text nennt apt dist-upgrade und root@pam). Das Dashboard selbst ist ein austauschbares Admin-Raster: Kicker, Titel „Dashboard“, graue Verhältniszeile, Zweispaltengitter mit drei Balken. Die Produktstimme steckt im Dialog, nicht in der Seite, die der Operator öffnet, um Last zu sehen.

**Deterministic scan:** `impeccable detect` auf Dashboard, Host-Upgrade, App-Shell und Hostseite: Exit 0, 0 Findings. Der bekannte Fehlalarm `codex-grid-background` ist in diesem Lauf nicht aufgetaucht.

**Visual overlays:** Kein Overlay. `http://localhost:3000` antwortet unauthentifiziert mit 307 auf `/login`. `detect.js` wurde nicht injiziert.

**Klickpfade:** Kein bestätigter Bug. Refresh, Proxora-Link, Upgrade pro Node und Temperatur-Cache halten den versprochenen Endzustand. Eine neue Messung ersetzt die alte. Ein Fehlschlag löscht sie nicht. Der Retry stoppt nach vier Versuchen.

**Produktion:** 84/100, kein Blocker in v2.1.16. Upgrade hängt an `updates.upgrade`, `confirmId` wird serverseitig verlangt, der hwmon-Befehl ist eine Konstante. Drei Tradeoffs: Shell mit Host-Credential ohne extra `hosts.console`-Prüfung, letzte Temperatur bleibt bei Lesefehler stehen, Rollback nur über das vorherige Image-Tag.

## Overall Impression

Die Seite beantwortet „tragen die Hosts?“ und „wartet ein Upgrade?“, aber der einzige gefüllte Button ist das Upgrade, und die Temperatur, wegen der man herkommt, kann als Gedankenstrich dastehen. Der größte Hebel ist, die drei Temperaturzustände sichtbar zu machen und das Proxora-Update auf ein Signal zu reduzieren.

## What's Working

- Der Upgrade-Dialog sagt die Proxmox-Wahrheit: Shell, Bestätigung dort, kein stilles API-Upgrade.
- Der Button erscheint nur mit `updates.upgrade`. Die Bestätigung ist destructive, ein zweiter Klick ist gesperrt, und Schließen prüft die Paketliste neu.
- Die Flottenzeile ist eine Zeile, kein KPI-Kachelfeld. Der Temperatur-Cache lässt eine sichtbare Gradzahl nicht mehr auf „—“ zurückfallen.

## Priority Issues

### [P1] Temperatur hat keinen sichtbaren Lesezustand
Online und noch ohne Wert zeigt das Dashboard „—“; der Satz dazu hängt nur am Tooltip. Die Hostseite malt Grad auf einen 0–100-Balken, formatiert fest mit de-DE, und 70 °C wirkt wie eine Warnung, obwohl der Alarm erst bei 85 °C liegt. Ein Cluster nennt die heißeste Node nicht.
Fix: drei Zustände an beiden Stellen. „Sensoren werden gelesen“, solange die Retries laufen. „Keine Sensoren“ als sichtbarer Satz ohne Balken, wenn sie ausbleiben. Bei einem Wert die Zahl in der UI-Locale, „heiß ab 85 °C“, und bei mehreren Nodes den Namen der heißesten. Grad nie als Prozentbalken.
Suggested command: /impeccable clarify

### [P1] Paketzahl und Upgrade-Button konkurrieren mit den Metern
Solange die Paketliste lädt, steht nur der Warning-Link. Danach sitzt der einzige gefüllte Button der Karte darunter. Liefert die Liste null Pakete, verschwindet die Zeile. Offline wird nicht geprüft.
Fix: Meter bleiben die Hauptsache. Pakete als ruhiger Chip nach `/updates`. Ein sekundärer Button. Die Node-Wahl erst im Dialog. Upgrade nur bei ONLINE. Eine leere Antwort als „Liste veraltet“, nicht als Verschwinden.
Suggested command: /impeccable distill

### [P1] Proxora-Update dreifach, Sidebar-Balken lügt
Dieselbe Tatsache: Warning-Balken auf dem Dashboard, Badge an der Navigation, und in der Sidebar ein Balken auf 8 %, obwohl nur ein Update verfügbar ist. „Update“ und „GitHub“ sind fest englisch.
Fix: ein Signal. Verfügbar bleibt Text auf dem Versionslink, „vX → vY“, ohne Meter. Der Balken bewegt sich erst, wenn das Update läuft, mit dem echten Prozentwert.
Suggested command: /impeccable clarify

### [P2] Die Statuszeile nennt die Ausnahme nicht
„2/3 Hosts · 4/9 Laufend“ nennt keinen Host. Die Karte ohne Verbindung ersetzt die Meter durch eine oft englische Fehlermeldung und bleibt upgrade-fähig.
Fix: die Ausnahme in die Zeile („pve-02 nicht erreichbar“). Offline-Karten nach oben. Bekannte Fehler auf einen deutschen nächsten Schritt mappen.
Suggested command: /impeccable clarify

### [P2] Deutsche Copy bricht an den täglich gelesenen Stellen
„{n} Update(s) verfügbar“. „Uptime (min.)“ liest sich als Minuten, meint aber die kürzeste Laufzeit. Titel „Dashboard“ und Kicker „Übersicht“ sagen dasselbe. Fertige Keys wie `dashboard.allHostsOnline` werden nicht benutzt.
Fix: „1 Update“ / „{n} Updates“. „Kürzeste Laufzeit {time}“. Schwelle an die Zahl. Locale auch auf der Hostseite.
Suggested command: /impeccable clarify

## Persona Red Flags

**Alex (täglich Upgrade).** Pro Host eine Bestätigung, dann eine modale Konsole, dann ein stiller Check. Kein Sammelweg. Der 8-%-Balken und das dreifache Proxora-Nag liegen jeden Morgen im Weg. „Uptime (min.)“ und „—“ kosten den Blick im Vorbeigehen.

**Jordan (zum ersten Mal).** Der erste gefüllte Button heißt „Upgrade starten“. Der Dialog setzt `apt dist-upgrade` und `root@pam` voraus. „—“ hat keine sichtbare Erklärung. Ein offline Host kann Englisch zeigen.

## Minor Observations

- Lade-Skeleton ist ein Balken plus zwei Karten; die echte Seite hat Banner und Statuszeile.
- Drei Verben für Nachladen: Aktualisieren, Update, Upgrade.
- Schließen der Konsole toasted den Check nicht. Der Öffnen-Toast bestätigt das Fenster, nicht apt.
- Amber trägt gleichzeitig Proxora-Hinweis, Paketlink und Hitze.

## Questions to Consider

- Wenn die Seite nur „tragen die Hosts?“ und „wartet ein Upgrade?“ beantworten soll, warum ist der einzige gefüllte Button das Upgrade?
- Was ändert sich, wenn Temperatur dieselben drei Zustände bekommt wie die Verbindung und der Sidebar-Balken sich erst bewegt, wenn ein Proxora-Update wirklich läuft?
