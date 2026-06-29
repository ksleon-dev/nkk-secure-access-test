# Changelog

Alle relevanten Änderungen am NKK Secure Access Client + Installer.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
