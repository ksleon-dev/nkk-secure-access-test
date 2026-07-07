# Changelog

Alle relevanten Änderungen am NKK Secure Access Client + Installer.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.29] - 2026-07-07

- Windows-Benachrichtigungen zeigen jetzt das NKK-App-Symbol statt eines generischen Icons; der Webshop-Server ist jetzt auch im InFact-Profil als Kachel verfuegbar

## [0.3.28] - 2026-07-07

- Remote Desktop laeuft fluessiger: der schnellere UDP-Transport ist jetzt garantiert aktiv, mit TCP als zuverlaessigem Fallback

## [0.3.27] - 2026-07-07

- Fuer das InFact-Profil ist der DB-Server (serv-db) jetzt direkt per Fernzugriff erreichbar; der Ein/Aus-Schalter in den Einstellungen sitzt sauber rechts neben der Beschreibung

## [0.3.26] - 2026-07-07

- Aktuelles zeigt unten einen aufklappbaren Update-Verlauf mit den Aenderungen je Version (immer aktuell aus der Cloud); Ein/Aus-Schalter in den Einstellungen sauberer und klarer gestaltet

## [0.3.25] - 2026-07-07

- Aktuelles zieht jetzt garantiert den neuesten Panel-Stand und laesst sich per Knopf sofort aktualisieren (nie wieder alte Meldungen); kleinere interne Verbesserungen und Haertungen

## [0.3.24] - 2026-07-07

- RDP oeffnet ohne Warnung und ohne Passwort-Prompt (die richtige Anmeldung ist hinterlegt; maschinenweit sauber gesetzt und bei Deinstallation wieder zurueckgeraeumt); das InFact-Profil erreicht die Datenbank und oeffnet die Dateiablage direkt auf serv-db; das Profil im Installations-Befehl ist nicht mehr lesbar oder auf eine hoehere Rolle umschreibbar; Aktuelles laedt immer sofort den neuesten Stand ohne haengenden Ladekreis

## [0.3.23] - 2026-07-06

- macOS-Dateiablage oeffnet ohne Passwort-Prompt (Zugangsdaten aus dem Profil werden in die Verbindung eingebettet); Status-Punkt der Kacheln nicht mehr faelschlich rot bei Servern mit mehreren IP-Adressen (parallele Erreichbarkeitspruefung); InFact-Profil zeigt beim App-Server nur 'Serv-App' statt 'Serv-App, InFact'; Aktuelles laedt wieder zuverlaessig die Live-Meldungen (CORS am News-Feed)

## [0.3.22] - 2026-07-06

- InFact-Profil: eigenes App-Profil fuer den Dienstleister InFact (sieht nur Terminalserver 2, Dateiablage und App-Server), Profil ab sofort bei der Installation waehlbar und im Panel je Setup-Key vorbelegt (Releases-Seite: Geraet onboarden mit Key und Profil in einem Schritt); Windows-Installation mit Terminal-Feedback und automatischem App-Start nach Erfolg; Dateiablage oeffnet ohne Passwort-Prompt (Zugangsdaten werden kurzzeitig vorbelegt) und verwaiste SMB-Zugangsdaten werden beim naechsten Start aufgeraeumt; interaktives Windows-Installationsskript install-windows.ps1; Aktuelles-Meldungen bereinigt. Release-Gate: kompletter Diff adversarial geprueft (5 Pruefpakete), 8 Funde vor dem Release behoben

## [0.3.21] - 2026-07-06

- Install-Pfad komplett gehaertet (nach Audit mit 29 Funden): die Ersteinrichtung laeuft nie mehr stumm in eine Sackgasse. Enrollment meldet Erfolg nur bei echter Verbindung statt am Exit-Code; macOS findet NetBird nach der Installation zuverlaessig (Binary-Pfad wird neu aufgeloest, GUI-PATH-Falle behoben); Windows meldet fehlendes NetBird ehrlich statt falsch 'fertig'; der Verbindungsaufbau faellt bei unbekanntem NetBird-Flag auf Kern-Optionen zurueck (Versions-Robustheit); Fehler werden klar unterschieden (Dienst fehlt / Key abgelehnt / Netz) mit konkretem naechsten Schritt; der macOS-One-Liner nutzt den hinterlegten Setup-Key automatisch (zero-touch); Sicherheit: das Installations-Skript laeuft nicht mehr an einem vorhersagbaren Temp-Pfad (TOCTOU-Luecke geschlossen). 18 neue Unit-Tests sichern jede dieser Laufzeit-Annahmen ab, damit solche Regressionen kuenftig im CI fallen statt beim Nutzer

## [0.3.20] - 2026-07-06

- Hotfix: Ersteinrichtung auf frischen Macs repariert. Der in 0.3.19 verschaerfte Sanity-Check des NetBird-Installations-Skripts lehnte das echte install.sh faelschlich ab (es beginnt mit einem Kommentar, nicht mit einem Shebang) und brach die Installation ab. Jetzt werden Kommentar- und Code-beginnende Skripte korrekt akzeptiert, leere oder HTML-Antworten weiter abgelehnt

## [0.3.19] - 2026-07-06

- Grosses Veredelungs-Release: neuer IT-Admin-Modus (Server-Gruppen, Live-Status, SSH-Fenster Shift+8/9, direkter Panel-Knopf, smarte Rechtsklick-Menues); 12 Bugfixes aus adversarialem Audit (serverseitige Ziel-Allowlist, Admin-Panel-Link Shift+7, Live-Status pro Host und Port, korrektes RDP-Profil, ehrliche macOS-SSH-Fehler, Doppelklick-Schutz); haertere Live-Flows (klare Update-Meldung bei fehlenden Rechten, kein Fehlreport vor Enrollment, kein Auto-Connect gegen abgelaufene Sitzung); 25 Feinschliffe (Bestaetigungsdialoge, klarere Meldungen, Finder/Explorer + Cmd/Strg getrennt, Kontrast, Tastatur-Fokus); Kabel/WLAN-Bevorzugung mit Rueckgaengig; App-Symbol im korrekten Apple-Format

## [0.3.18] - 2026-06-30

- Audit-Fixes (8 Bugs aus dem Komplett-Check): Enrollment-Regression behoben (Connect MIT Key wird nie verschluckt); Admin 'Nach Update suchen' startet korrekt neu (relaunch_app statt nicht-registriertem Plugin); Auto-Update-Hinweisbox auch bei passive-Install (/P) unterdrueckt; RDP cmdkey-Credential 60->15s; Profil-Loeschen + NewsScreen ruhige/robuste Behandlung; Auto-Reconnect-Abbruch-Race geschlossen; open_rdp blockiert den Async-Worker nicht mehr (spawn_blocking). Feature-Vollstaendigkeit im Audit bestaetigt (50/50 Befehle verdrahtet)

## [0.3.17] - 2026-06-30

- Letzte Sammelversion: Admin-Menue Windows zusaetzlich gehaertet (Tasten-Handler auf window UND document, 5x-Logo-Tap mit großzuegigem 2s-Fenster als garantierter, WebView2-sicherer Weg). Enthaelt alle 0.3.16-Fixes (Auto-Update passiv ohne Wizard, keine NB-FOREIGN-Box)

## [0.3.16] - 2026-06-30

- Update-/Installer-Politur (stabile Sammelversion): Auto-Update laeuft passiv ohne Wizard; KEINE erschreckende Hinweis-Box mehr beim Update (NB-FOREIGN und NB-UP sind nur Infos, nicht mehr in der Support-Box); Foreign-NetBird-Check nur noch bei echtem Enrollment mit Key (Ursache der NB-FOREIGN-Meldung beim Update behoben); NetBird-Server-Erkennung via status -d zuverlaessig; Hinweis-Box wird im Silent-Update unterdrueckt

## [0.3.15] - 2026-06-30

- Sammel-Release: alle Fixes seit 0.3.9 landen jetzt WIRKLICH im Build (RDP-Signierung+Trust, Admin-Menue, schneller idiotensicherer Erst-Connect, keine rohen Fehlertexte mehr, Tray-Hinweis, sanfte Update-Abfrage). Ursache war ein Release-Skript das den Quellcode nie mit committet hat - jetzt behoben (git add -A)

## [0.3.14] - 2026-06-30

- Endnutzer-Feinschliff: keine rohen Fehlertexte mehr (Tray-Verbinden/Trennen, Statusfehler, Installation, Schnellzugriff, Sitzung abgelaufen) sondern ruhige Klartext-Meldungen; Schliessen-zu-Tray zeigt einmaligen Hinweis dass die App im Hintergrund weiterlaeuft; Update-Abfrage (UAC) sanft statt Fehler; Stil-Feinschliff (keine Gedankenstriche)

## [0.3.13] - 2026-06-30

- Erst-Connect schneller und gefuehrt: wartet auf Dienst-Bereitschaft statt blind, verhindert Doppelverbindung, weniger Wartezeit, klarer Hinweis statt stillem Haenger

## [0.3.12] - 2026-06-30

- RDP-Warnungen weg: App signiert .rdp und richtet das Vertrauen automatisch ein; Admin-Menue oeffnet auf Windows zuverlaessig (Strg+Shift+0 robust + Logo-5x-Klick)

## [0.3.11] - 2026-06-30

- Installer richtet den NetBird-Dienst zuverlaessig ein (kein FEHLER 1060 bei vorhandenem oder fremdem NetBird)

## [0.3.10] - 2026-06-30

- Viel kleinerer Windows-Installer (WebView2 als Bootstrapper) und abbruchsicherer Download (Resume + Retry)

## [0.3.9] - 2026-06-29

- Die App schickt direkt beim Start einen leichten Report (Version, IPs) an die Verwaltung. So zeigt das Admin-Panel die neue Version sofort nach einem Update, ohne auf den naechsten Connect zu warten. Der Server fuehrt die Reports pro Geraet zusammen, sodass der leichte Startup-Report Ping und Speed aus dem letzten vollen Report nicht ueberschreibt.

## [0.3.8] - 2026-06-29

- Die App meldet ihren Stand (Version, IPs, Ping, Speed) jetzt bei JEDEM Connect an die Verwaltung, nicht mehr nur beim ersten Enrollment. Dadurch zeigt das Admin-Panel die echte aktuelle App-Version nach einem Update statt fuer immer der Version vom Einrichtungszeitpunkt.

## [0.3.7] - 2026-06-29

- Update-Pruefung laeuft jetzt nicht nur beim Start, sondern alle 6 Stunden weiter: eine dauerhaft laufende App bemerkt ein neues Update von selbst und zeigt den Banner, ganz ohne Neustart und ohne dass jemand etwas anstossen muss. Ein laufender Download wird dabei nicht unterbrochen.

## [0.3.6] - 2026-06-29

- Autostart auf macOS zeigt bei fehlenden Rechten jetzt einen ruhigen Hinweis (Tipp: App nach Programme verschieben) statt eines rohen Systemfehlers. Die vollstaendige Loesung bleibt die App-Signierung.

## [0.3.5] - 2026-06-29

Update-Neustart funktioniert jetzt wirklich und ist ueberspringbar.

- "Jetzt neu starten" nach einem Update startet die App jetzt zuverlaessig: nativer App-Neustart statt eines nie registrierten Prozess-Plugins, dessen Aufruf vorher still ins Leere lief. Gilt fuer den Update-Banner und den Pruefer in den Einstellungen.
- Der Update-Banner laesst sich mit "Spaeter" wegklicken — das Update bleibt installiert und greift beim naechsten Start der App.

## [0.3.4] - 2026-06-29

Haertung nach internem Review.

- Update-Pruefer in den Einstellungen abgehaertet: ein fehlgeschlagener Neustart verliert das installierte Update nicht (wiederholbar), Schutz gegen Doppelklick auf Installieren/Neustarten, "Spaeter"-Knopf zum Abbrechen, unbekannte Downloadgroesse zeigt einen laufenden statt eingefrorenen Balken, und Verbindungsfehler erscheinen als ruhige deutsche Meldung statt als roher Fehlertext.
- Release-Pipeline gehaertet: die Windows-Updater-URL spiegelt jetzt die GitHub-Namensnormalisierung (Leerzeichen zu Punkten), sonst lief der Auto-Update-Download in einen 404 bei gruenem Check. Die CHANGELOG-Pruefung ist an echte Versionsueberschriften gebunden und der Zeitstempel ist echtes UTC.

## [0.3.3] - 2026-06-29

Auto-Update fuer jedes OS und ein Update-Pruefer in den Einstellungen.

- macOS aktualisiert sich jetzt automatisch wie Windows: der Build erzeugt ein signiertes Updater-Artefakt (.app.tar.gz) und traegt darwin in die latest.json ein (eine universale Datei fuer Intel und Apple Silicon). Updates erreichen damit jede Plattform.
- Einstellungen: "Nach Updates suchen" mit klarem Status (aktuell / Update verfuegbar / laedt mit Fortschritt / neu starten). Man muss nicht mehr auf den automatischen Start-Check warten, und jeder Fehler wird ruhig angezeigt statt zu haengen.

## [0.3.2] - 2026-06-29

Feinschliff: Service-Menue, Fernzugriff-Haertung und plattformuebergreifende Stabilitaet.

- Installer pausiert jetzt Bitdefender (statt ESET) waehrend der NetBird-Treiberinstallation und startet den Echtzeitschutz danach wieder. NKK setzt Bitdefender ein. Best effort und auf zentral verwalteten Endpoints per Selbstschutz ggf. blockiert; dann muss NetBird in der Bitdefender-Policy freigegeben werden.
- Service-Menue: alle laufzeitseitigen Einstellungen direkt umschaltbar (Auto-Reconnect, Beim Start verbinden, Benachrichtigungen, Autostart, RDP-Optionen) und die Aktionen sind durchnummeriert (00, 01, 02 ...), damit man sie schnell per Nummer durchgeben kann.
- Windows-Haertung: korrektes PowerShell-Quoting (lief sonst bei Pfaden mit Leerzeichen ins Leere), hartes Timeout fuer das Enrollment (kein haengender Installer), und ein locale-unabhaengiges Credential-Cleanup, das auch auf deutschem Windows greift.
- Kopieren laeuft ueber einen WebView2-sicheren Fallback, und das Rechtsklick-Menue blendet mit einer ruhigen Animation ein.
- Verbinden ist jetzt ehrlich: die Erfolgsmeldung kommt erst, wenn der Tunnel WIRKLICH steht (nicht mehr beim Klick), und die Server-Erreichbarkeit wird doppelt geprueft und nach dem Routen-Settle nochmal gemessen. Kein zu frueher Fehlmesswert mehr.
- Hauptansicht: Hinweis sitzt unter dem Button und springt nicht mehr, Fenster scrollt bei viel Inhalt, Windows-Symbol auf der Terminalserver-Karte, animierte Hilfe mit Ein-Tipp "Problem automatisch beheben". Abgelaufene Anmeldung zeigt einen ruhigen, dauerhaften Hinweis statt nur kurz aufzublitzen.
- Headless Linux-CLI (nkk-secure-access-cli) auf gemeinsamem, Tauri-freiem Core: connect/disconnect/status/connectivity/inventory/diagnose/version, --json fuers RMM. GUI und CLI teilen eine Implementierung und koennen nicht driften.
- Laeuft sauber von Windows 10 (1809+) bis 11 und Server 2019+: VC-Runtime fest eingelinkt (crt-static), NetBird architektur-bewusst (ARM64). Status-Poller drosselt im Ruhezustand und schont so den Akku.
- TS2-Desktop-Verknuepfung ist auf Windows eine echte .lnk mit eigenem Apfel-Icon. Versionierte Build-Ablage (Version + Build-Nummer als Patch).

## [0.3.1] - 2026-06-25

Komfort und Netz-Intelligenz.

- Smart Network: erkennt Büro-LAN, WLAN und Remote und warnt, wenn zwei Netze gleichzeitig laufen. Genau das macht eine Verbindung sonst still langsam.
- Terminalserver 1 ist aus der Hauptansicht raus und liegt jetzt auf Shift+1.
- Support-Paket fragt vor dem Export, in welchen Ordner es soll.
- RDP-Einstellungen direkt in den Einstellungen: Zwischenablage, Laufwerke, Drucker und mehr an- und abschaltbar. Laufwerke sind aus Sicherheitsgründen standardmäßig aus.
- Optionale Desktop-Verknüpfung zum Terminalserver, auch nutzbar ohne die App vorher zu öffnen.
- NetBird lässt sich aus dem Service-Menü auf jeder Plattform sauber aktualisieren, mit Versionsprüfung.
- Sicherheits-Update (Tauri 2.11.3) und ein Wächter um den Status-Poller, damit die Verbindung im Dauerbetrieb stabil bleibt.

## [0.3.0] - 2026-06-18

Das große Komfort- und Diagnose-Release.

- Remote Desktop nutzt jetzt alle Bildschirme, und Copy/Paste samt Dateien klappt zuverlässig (Windows, macOS, Linux).
- Vor-Ort-Erkennung: im Firmennetz gehen die Server-Buttons ohne VPN, die App sagt klar Bescheid. Remote verbindet das VPN automatisch.
- Diagnose-Panel kräftig ausgebaut: Verbindungs-Verlauf, Geräte-Übersicht, durchsuchbarer Log-Viewer, Ein-Klick-Support-Paket.
- Captive-Portal-Erkennung (WLAN-Anmeldeseite) statt blindem Reconnect.
- Verstecktes Service-Menü für KronSolutions: NetBird reparieren und neu starten, Inventar, Reset.
- Installer überarbeitet: WebView2 als Offline-Variante, klare Fehlercodes zum Abfotografieren, kein NetBird-Icon mehr im Startmenü.

## [0.2.8] - 2026-05-12

- Trennen bleibt jetzt auch nach Neustart getrennt, und der Auto-Reconnect dreht bei Wartung nicht mehr durch (Backoff statt Dauerversuch).
- Latenz-Anzeige korrigiert (NetBird 0.7x liefert Nanosekunden), robusteres Status-Parsing.
- White-Label sauber gezogen: Tray, Meldungen, Domäne und Farben kommen aus der Konfiguration.

## [0.2.7] - 2026-05-02

- Auto-Update repariert: der Build signiert die Artefakte jetzt richtig, eine einzige Versionsquelle. Vorher kam bei installierten Clients nie ein Update an.
- Abgelaufene Sitzung wird als "neu anmelden" angezeigt, statt still zu hängen.
- "Was ist neu" wird vor dem Update gezeigt.

## [0.2.6] - 2026-04-28

### Fixed
- VPN Disconnect - Trennen Knopf setzt `user_disconnected` Flag, Auto-Reconnect respektiert es
- Alle Exit Pfade (Quit, Tray Beenden, Window Close) rufen `netbird down` mit 5s Timeout
- RDP Clipboard + Files: `.rdp` mit `\r\n` Line Endings, `redirectclipboard`/`drivestoredirect`/`redirectprinters` aktiv
- Old Install Cleanup: Setup Key bleibt im Credential Manager beim Upgrade
- Installer entfernt alte Per-User Installationen vor Upgrade

### Hardening Pass
- Rust Panic Audit - `expect()` durch `tracing::warn!` + graceful fallback ersetzt in `lib.rs` und `tray.rs`
- Setup Key Validierung (8-128 Zeichen, alphanumerisch + `-_`)
- RDP Target Whitelist (alphanumerisch + `.`/`-`/`:`)
- SMB Target Whitelist (UNC + alphanumerisch)
- URL Schema Whitelist (`http`/`https`/`mailto` only)
- Tray Icon Fallback (1×1 transparent statt panic wenn `default_window_icon` None)
- Tauri Runtime Crash → strukturiertes Logging + sauberer Exit Code 1

### NSIS Installer Hardening
- Reinstall Detection - überspringt NetBird MSI wenn bereits installiert
- NetBird Install Retry (1× Retry bei Exit Code != 0)
- Defender Exclusion für `NetBird` Programmpfad und Prozesse (verhindert Wintun Driver Block)
- ESET Network Protection Pause/Resume via `Stop-Service ekrn` (best effort)
- NetBird Service auf `start= auto` setzen + sofort starten (Autostart Chain)
- Defender Exclusions werden beim Uninstall sauber entfernt

### CI/CD
- GitHub Actions: Concurrency Group (alte Builds werden gecancelt)
- Rust Cache via `swatinem/rust-cache@v2`
- `cargo test` Step (continue-on-error während Pilot)
- GitHub Release auf Tag `v*.*.*` mit deutscher Release Note

### Dokumentation
- README.md - komplette Projekt Übersicht
- docs/ROLLOUT.md - Distribution für NKK Admins
- docs/TROUBLESHOOTING.md - häufige Probleme + Diagnose
- CHANGELOG.md (diese Datei)

## [0.1.0] - 2026-04-09

### Added
- Initiales MVP für NKK Pilot
- Tauri 2.x + React 18 + TypeScript Frontend
- Multi-Profile Credential Storage (macOS Keychain / Windows Credential Manager)
- NetBird CLI Wrapper mit Status JSON Parser
- Custom Tray Icon mit Right-Click Menü
- Diagnose Panel mit 4 Ampeln + Diagnose Bundle Copy
- NSIS Installer mit eingebettetem NetBird Client
- GitHub Actions Workflow für Windows Build
- Demo Modus für UI Testing ohne NetBird
- Real NKK Brand Identity (Cherry Logo, Cream BG, Italic Tagline)
- Click-to-copy Support Email
- KronSolutions Footer Branding

### Known Issues
- Code Signing fehlt - SmartScreen warnt einmalig bei Browser Downloads
- Auto-Updater ist Phase 2
- ESET Pause ist best-effort, funktioniert nur wenn Service `ekrn` steht
