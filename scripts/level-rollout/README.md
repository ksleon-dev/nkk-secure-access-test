# NKK Secure Access - Massen-Rollout über Level

Idempotente RMM-Skripte, um die App auf der ganzen Flotte zero-touch zu installieren
und zu enrollen. Die im Admin-Panel angezeigten Copy-Paste-Blöcke (Keys, "Anzeigen")
sind die kompakte Variante dieser Skripte mit bereits eingebettetem Key; diese Dateien
sind die ausführliche, kommentierte Quelle der Wahrheit.

## So funktioniert das Enrollment (verifiziert)
- **Windows:** Der NSIS-Installer akzeptiert `/SETUPKEY=<key>` als Silent-Argument
  (`src-tauri/nsis/installer.nsh`) und ruft danach selbst `netbird up --setup-key ...
  --management-url https://vpn.secure.nkk-hb.de`. Ein Befehl installiert + enrollt +
  verbindet. Keine App-Änderung nötig.
- **macOS:** Die App liest den Key aus `~/.config/nkk-secure-access/setup-key`. Das
  root-Skript schreibt ihn für den per `/dev/console` ermittelten Konsolennutzer und
  chownt ihn. Beim nächsten App-Start (oder einmal "Verbinden") enrollt sie selbst.

## Einrichtung in Level
1. **Scripts → New Script**, je eins für Windows (PowerShell) und macOS (bash),
   **Run as: System**, Timeout 600 s.
2. `<SETUP_KEY>` durch den **Mehrfach-Key** (reusable) ersetzen. Einmal-Keys sind für
   Masse ungeeignet (gelten nur fürs erste Gerät).
3. `MIN_VERSION` auf die aktuelle Release setzen (oder so lassen; dient nur der
   Idempotenz, die App aktualisiert sich danach ohnehin selbst).
4. Auf die passende Gerätegruppe anwenden. Als **Script-Monitor** auf Zeitplan ist es
   zugleich Self-Heal (mehrfacher Lauf ist unschädlich).

## Eigenschaften
- Versions-Check vor Install (Win: Registry `DisplayVersion`, mac: `Info.plist`).
- Download mit Retry/Timeout von den stabilen, immer aktuellen `/download/`-Links.
- **Windows: Enrollment-Selbstheilung.** Nach dem Install zieht das Skript `netbird up`
  bis zu 3x nach, falls der einmalige Versuch des Installers fehlschlug (Mgmt-Timeout,
  AV, Netz spät). Ohne das bliebe ein Fresh-Install ohne Fallback un-enrollt.
- **macOS: Konsolennutzer-Guard.** Key wird nur geschrieben, wenn ein echter Nutzer
  eingeloggt ist (`stat -f%Su /dev/console` != root/loginwindow), sonst Exit 4 statt
  stillem grün; ein späterer Lauf zieht den Key nach.
- Key erscheint nie im Log; Dateien restriktiv (mac 0600/0700 + chown).
- Exit-Codes: **0** ok, **2** Download, **3** Install, **4** (mac) installiert aber Key
  ausstehend (kein Konsolennutzer).
- Stabiler Download wird vom serv-secure-Timer `nkk-download-sync.timer` aktuell gehalten.

## Akzeptiertes Trade-off
Der Setup-Key ist **eingebettet** (im Level-Script und kurz in der Prozessliste bei
`netbird up` / `/SETUPKEY=`). Das ist der Sinn von Zero-Touch und akzeptabel, **solange ein
Mehrfach-Key (reusable) verwendet wird**, der rotierbar ist. Einmal-Keys sind ungeeignet
(gelten nur fürs erste Gerät). Das Panel zeigt den Massen-Rollout-Block daher nur für
reusable Keys an.
