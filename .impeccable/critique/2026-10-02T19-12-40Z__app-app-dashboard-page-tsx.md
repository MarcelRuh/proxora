---
target: Dashboard nach Layout und Lesezustand
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/home/proxmox-manager/app/(app)/dashboard/page.tsx"
target_fingerprint: "sha256:9d869090cd9eaa4443e7b84f40e9c042bc0e8298371badea9768fe9b639a5719"
target_path: /home/proxmox-manager/app/(app)/dashboard/page.tsx
timestamp: 2026-10-02T19-12-40Z
slug: app-app-dashboard-page-tsx
---
Method: dual-agent (A: 73e4f50e-48b6-4ea7-a4c2-7e098f4c4aba · B: 3a20f8d0-360b-49ba-82cf-c6f4edc3243f)

Zusätzlich: Klickpfade (295616a3-72b2-40c6-bca4-aee49258d755), Produktion (dd683fc5-8a47-4c64-aa17-23252f267f0c).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Lesen, keine Sensoren und der echte Update-Fortschritt sind lesbar. Ein offline Node zeigt trotzdem volle Balken. |
| 2 | Match System / Real World | 2 | Apt-Satz und °C stimmen. „GitHub“ in der Sidebar führt nach /proxora. Job-Status bleibt FAILED/SUCCESS. |
| 3 | User Control and Freedom | 3 | Abbrechen, Schließen und „Alle Hosts“ sind da. „Alle Paketlisten prüfen“ ignoriert den Host-Filter. |
| 4 | Consistency and Standards | 2 | Der Temperatursatz ist auf beiden Flächen gleich. Die Host-Aktionszeile und die Updates-Seite stapeln weiter gleich gewichtige Knöpfe. |
| 5 | Error Prevention | 3 | Upgrade und Power verlangen Bestätigung. Zwei rote Power-Buttons liegen direkt nebeneinander. |
| 6 | Recognition Rather Than Recall | 3 | Node und Schwelle stehen im Dialog. Der gefilterte Host ist auf der Updates-Seite nicht benannt. Gesperrte Rechte stecken oft nur im title. |
| 7 | Flexibility and Efficiency | 2 | Die Suche hat ein Kürzel. Upgrade und Aktualisieren nicht. |
| 8 | Aesthetic and Minimalist Design | 2 | Die Dashboard-Karte ist eng. Der Node-Kopf legt fünf Aktionen neben die Metriken. |
| 9 | Error Recovery | 2 | Lade-Fehler der Seite haben Wiederholen. Der Paketlistenfehler ist ein grauer Satz ohne Link. |
| 10 | Help and Documentation | 2 | Der Konsolentext sagt, dass Schließen apt nicht beendet. „Keine Sensoren“ und „GitHub“ erklären sich nicht an der Stelle. |
| **Total** | | **24/40** | **Akzeptabel** |

Kognitive Last: 5 von 8 Checks fallen durch. Bestanden haben Gruppierung, Arbeitsgedächtnis und die Staffelung im Upgrade-Dialog.

## Design Specificity Verdict

**LLM:** Die Sätze sind für Proxora geschrieben: heißester Node, apt läuft nach dem Schließen weiter, Paketlink ist hostscharf. Die Hülle bleibt eine dunkle Admin-Konsole aus Panel und drei Balken.

**Im Code bestätigt:** Temperatur ist ein Satz unter drei Balken, kein vierter Balken. Ein gecachter Nullwert bleibt „keine Sensoren“. Fehler und veraltete Liste sind verschiedene Texte. Ab fünf Nodes ein Select. Der Konsolentext sagt, dass Schließen apt nicht beendet.

**Deterministic scan:** detect auf Dashboard, Host-Upgrade, App-Shell, Hostseite und Updates: Exit 0, 0 Findings. codex-grid-background ist nicht aufgetaucht.

**Visual overlays:** Kein Overlay. localhost:3000 antwortet unauthentifiziert mit 307 auf /login.

**Klickpfade:** Kein bestätigter Bug. Ein Host ohne Sensoren bleibt beim 90-Sekunden-Poll auf „Keine Sensoren“. Die Hostseite kippt beim 45-Sekunden-Poll nicht mehr. Fehlertext und veraltete Liste verdrängen sich nicht. Schließen der Konsole feuert einmal. Der Host-Filter und „Alle Hosts“ passen. Der Sidebar-Balken nur bei laufendem Update mit echtem Prozent.

**Produktion:** 82/100, kein Blocker. Upgrade bleibt an updates.upgrade, confirm true und die gewählte Node gebunden. retainCpuTemp und der hwmon-Befehl sind nicht verschlechtert. Ein veraltetes Cache-null bleibt null. Keine Secrets im Diff. Der Stand ist uncommitted auf v2.1.16.

## Overall Impression

Die letzten Fixes halten. Der Score bleibt bei 24/40, weil die nächste Lüge nicht mehr die Temperatur ist, sondern ein offline Node, der wie eine leerlaufende Maschine aussieht, und ein Paketfehler ohne Weg zurück.

## What's Working

- Temperatur ist auf Dashboard und Hostseite derselbe Satz unter den Balken. Hitze steht im Wort und in der Farbe. Ein leerer Cache bleibt „Keine Sensoren“.
- Der Konsolentext trägt den riskanten Moment: Schließen stoppt apt nicht.
- Paketzähler, veraltete Liste und Ladefehler sind drei Zustände. „Alle Hosts“ hebt den Filter auf.

## Priority Issues

### [P1] Ein offline Node liest sich als leerlaufende Maschine
Die Status-Route liefert für jeden Node ein Status-Objekt. Die Hostseite zeichnet CPU, RAM und Rootfs deshalb immer und setzt die Temperatur bei offline auf „Keine Sensoren“. Das Dashboard ersetzt einen toten Host durch die Fehlerzeile. Ein Operator kann 0 % Last für einen toten Node halten.
Fix: Offline denselben Satz wie auf dem Dashboard, ohne Balken und ohne „Keine Sensoren“.
Suggested command: /impeccable clarify

### [P1] Der Paketfehler verschluckt den Weg
Bei einem Ladefehler bleibt ein grauer Satz ohne Link und ohne Wiederholen. Zähler und „Paketliste veraltet“ führen nach /updates?host=.
Fix: Denselben Link unter dem Fehlertext, plus Wiederholen.
Suggested command: /impeccable clarify

### [P2] Filter und „Alle Paketlisten prüfen“ haben verschiedene Reichweiten
/updates?host= zeigt die Karte und „Alle Hosts“, nennt den Host aber nicht. Der Header-Button prüft weiter jeden erlaubten Host.
Fix: Den Hostnamen in die Filterzeile. „Alle Paketlisten prüfen“ auf der gefilterten Seite nur diese Karte, oder den Button umbenennen.
Suggested command: /impeccable clarify

### [P2] Die Host-Aktionszeile ist die laute Stelle
Fünf Buttons, davon zwei rot und gleich gewichtig. Die Updates-Seite legt weiter pro Node einen Upgrade-Button, auch deaktiviert bei null Paketen. Der Dashboard-Dialog hat die Select-Schwelle schon.
Fix: Eine primäre Aktion, der Rest hinter Mehr. Deaktivierte Upgrade-Buttons nicht zeichnen.
Suggested command: /impeccable distill

## Persona Red Flags

**Alex:** „Alle Paketlisten prüfen“ auf einer gefilterten Seite trifft die falsche Menge. Ein offline Node mit vollen Balken kostet den Blick, den er im Vorbeigehen wirft.

**Jordan:** „GitHub“ in der Sidebar ist kein GitHub-Link, das Ziel ist /proxora. Ein offline Node zeigt das rohe Statuswort, volle Balken und „Keine Sensoren“. Der Paketfehler nennt keinen nächsten Schritt.

## Minor Observations

- useDashboard liefert cpuTempReading, die Seite liest es nicht.
- Die Paketliste auf der Updates-Seite kappt bei 12 Einträgen ohne Restzahl.
- Das Node-Select nutzt rounded-[4px] statt des UI-Radius.
- Job-Badges sprechen FAILED und SUCCESS.

## Questions to Consider

- Was darf eine Host-Karte zeichnen, solange der Node offline ist, wenn „Keine Sensoren“ dann ein Zustand wäre, den dieser Node nie erreicht?
- Soll „Alle Paketlisten prüfen“ auf der gefilterten Seite nur die sichtbare Karte meinen, und bleibt das Sidebar-Wort „GitHub“ haltbar, wenn das Ziel /proxora ist?
