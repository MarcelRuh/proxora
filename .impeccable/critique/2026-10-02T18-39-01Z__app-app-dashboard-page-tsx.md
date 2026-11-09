---
target: Dashboard nach den drei P1
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/home/proxmox-manager/app/(app)/dashboard/page.tsx"
target_fingerprint: "sha256:f3a5b94451928455c9afdf5195908eb8e803cc1ca57b2bb0e7c185f927faee27"
target_path: /home/proxmox-manager/app/(app)/dashboard/page.tsx
timestamp: 2026-10-02T18-39-01Z
slug: app-app-dashboard-page-tsx
---
Method: dual-agent (A: adbb5158-3f26-4966-8141-302106618ae3 · B: fe27072e-34a8-4107-8002-edce932ee145)

Zusätzlich: Klickpfade (675060ee-1bd2-4c08-abdc-8856b49318cb), Produktion (9ebc0824-bf16-4e0b-91bc-7d2b988b0e31).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | „Sensoren werden gelesen“ und „Keine Sensoren“ wechseln sich ab. Der Sidebar-Balken hat keine Prozentzahl. |
| 2 | Match System / Real World | 3 | °C, Locale und apt-Text sitzen. Timeout-Texte kommen noch englisch aus dem Server. |
| 3 | User Control and Freedom | 3 | Abbrechen und Schließen sind da. Die Konsole sagt nicht, dass apt nach dem Schließen weiterläuft. |
| 4 | Consistency and Standards | 2 | Dashboard-Temperatur ist ein Satz, die Hostseite eine vierte Zelle im Balkenraster. |
| 5 | Error Prevention | 3 | Upgrade braucht Online, Recht, gewählte Node und den destruktiven Dialog. |
| 6 | Recognition Rather Than Recall | 3 | Node und Schwelle stehen im Dialog. Die Paketzeile sieht nicht aus wie ein Link. |
| 7 | Flexibility and Efficiency | 2 | Suche hat ein Kürzel. Upgrade und Aktualisieren nicht. |
| 8 | Aesthetic and Minimalist Design | 3 | Ein verfügbares Proxora-Update bleibt aus dem Dashboard. |
| 9 | Error Recovery | 2 | „Keine Sensoren“ und „Paketliste veraltet“ nennen keinen nächsten Schritt. Derselbe Satz steht auch bei einem Ladefehler. |
| 10 | Help and Documentation | 2 | Der Upgrade-Dialog erklärt apt. Die Temperaturzustände haben keinen Kontext. |
| **Total** | | **25/40** | **Akzeptabel** |

Kognitive Last: 5 von 8 Checks fallen durch. Bestanden haben Fokus, Arbeitsgedächtnis und die Staffelung Button, Dialog, Konsole.

## Design Specificity Verdict

**LLM:** Der Ablauf ist für Proxora geschrieben. Die Host-Karte bleibt ein austauschbares Raster aus drei Balken. Geprüft im Code: kein Grad-Balken, Sidebar-Balken nur bei laufendem Update mit echtem Prozent, kein Nav-Badge, Dashboard-Zeile nur während des Updates.

**Deterministic scan:** `impeccable detect` auf Dashboard, Host-Upgrade, App-Shell und Hostseite: Exit 0, 0 Findings. `codex-grid-background` ist nicht aufgetaucht.

**Visual overlays:** Kein Overlay. `http://localhost:3000` antwortet unauthentifiziert mit 307 auf `/login`.

**Klickpfade:** Ein bestätigter Fehler. Auf der Hostseite springt „Keine Sensoren“ bei jedem 45-Sekunden-Refetch auf „Sensoren werden gelesen“ und zurück. Dashboard-Temperatur, Upgrade (nur die gewählte Node, offline ohne Button, veraltete Liste bleibt) und die Sidebar ohne Schein-Balken enden im Soll.

**Produktion:** 80/100, kein Blocker. Der uncommittete Stand regressiert `updates.upgrade`, `confirm: true`, den Temperatur-Cache und den konstanten hwmon-Befehl nicht. Auf dem Handy sieht man ein verfügbares Proxora-Update erst nach dem Öffnen der Seitenleiste.

## Overall Impression

Die drei P1 von 21/40 sind im Groben da, deshalb 25/40. Der verbleibende Bruch ist die Temperatur: der Lesezustand lügt, einmal 32 Sekunden lang auf dem Dashboard, und auf der Hostseite bei jedem Poll.

## What's Working

- Drei Temperaturzustände, Locale, heißester Node nur im Cluster, Schwelle aus den Einstellungen. Kein Grad-als-Prozent.
- Upgrade ist ein Outline-Button nur bei einem online Host. Node und Bestätigung liegen im Dialog, danach die Shell.
- Ein verfügbares Proxora-Update ist der Versionslink. Der Balken nutzt den echten Prozentwert nur während des Laufs.

## Priority Issues

### [P1] „Sensoren werden gelesen“ ist nicht der Lesezustand
Das Dashboard setzt fehlende Temperatur und „Cache sagt keine Sensoren“ gleich. Solange weniger als vier Versuche gelaufen sind, steht „Sensoren werden gelesen“, auch wenn die Messung schon leer war. Das sind etwa 32 Sekunden. Auf der Hostseite koppelt `reading` an `isFetching`: jeder 45-Sekunden-Poll dreht „Keine Sensoren“ zurück auf „Sensoren werden gelesen“.
Fix: `reading` nur, solange noch keine Messung da ist. Ein gecachtes `null` bleibt „Keine Sensoren“, auch während des nächsten Polls.
Suggested command: /impeccable clarify

### [P1] Die Host-Temperatur sitzt in der Balken-Zeile
CPU, RAM und Rootfs haben einen Balken. Die Temperatur ist die vierte Zelle, nur Text, und wirkt wie ein leerer Meter. Auf dem Dashboard ist derselbe Wert schon ein Satz neben der Laufzeit.
Fix: dieselbe Zeile wie auf dem Dashboard, unter den Balken, nicht als vierter Meter.
Suggested command: /impeccable layout

### [P2] Paketliste: Fehler und leere Liste sind derselbe Satz
Schlägt das Laden fehl, steht „Paketliste veraltet“ neben der alten Paketzahl. Eine erfolgreich leere Liste benutzt denselben Satz. Der Link geht auf `/updates` ohne den Host, und er sieht aus wie normaler Text.
Fix: Fehler und leere Liste trennen. Den Link als Link zeichnen. Zur Update-Seite dieses Hosts springen, wenn die Seite den Parameter kennt.
Suggested command: /impeccable clarify

### [P2] Mehrere Nodes entscheiden Wahl und Start im selben Dialog
Jede Node ist ein Button, dazu Abbrechen und der rote Start. Schließen der Konsole sagt nicht, dass apt weiterläuft.
Fix: Bei mehr als vier Nodes ein Select. Ein Satz im Konsolen-Dialog: Schließen beendet apt nicht.
Suggested command: /impeccable distill

## Persona Red Flags

**Alex:** „Sensoren werden gelesen“ über eine halbe Minute bei einem Host ohne Sensoren kostet das Vertrauen in die Zeile, die er täglich scannt. Auf der Hostseite blinkt derselbe Satz alle 45 Sekunden. Die Paketzeile landet auf der Gesamtliste.

**Jordan:** Die vierte Zelle auf der Hostseite sieht unfertig aus. Die Paketzeile wirkt wie Statustext, nicht wie ein Link.

## Minor Observations

- Ruhezustand zeigt `v2.1.16`, der Update-Akkord `2.1.16 → …` ohne `v`.
- Der Sidebar-Balken hat keine Prozentzahl daneben.
- Englische Fallback-Sätze wie „Unable to connect“ bleiben in der deutschen Karte.
- `dashboard.proxoraNotice` wird nicht mehr gerendert.

## Questions to Consider

- Soll „Keine Sensoren“ feststehen, sobald der Cache `null` sagt, und soll die Hostseite denselben Satz wie das Dashboard verwenden?
- Warum teilt sich 92 °C eine Fließtextzeile mit der Laufzeit, während 12 % CPU einen eigenen Meter bekommen?
