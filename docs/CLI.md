# nkk-secure — die Kommandozeile (ab v0.3.31)

Headless-Steuerung des Clients auf JEDEM Geraet: fuer IT-Admins, Level/RMM und
Automation. Ohne GUI nutzbar (Session 0, SSH, Skripte). Ein Befehl, alle
Plattformen gleich.

## Aufruf

| Plattform | Wie |
|---|---|
| Windows | `nkk-secure` in cmd/PowerShell (Sidecar `nkk-secure.exe` in INSTDIR, das der Installer in den Maschinen-PATH legt). Bereits offene Terminals sehen den PATH erst nach Neustart des Terminals. |
| macOS | `nkk-secure` im Terminal (Symlink `/usr/local/bin/nkk-secure` -> `Contents/MacOS/nkk-secure`, legt `macos-install.sh` an) |
| Linux (headless) | Standalone-Binary `nkk-secure-linux-x86_64` vom GitHub-Release (fuer Server/RMM, keine GUI-App) |

## Befehle

```
nkk-secure                     Kurzstatus (Zustand, Profil, IP, Version)
nkk-secure status [--json]     Voller Verbindungsstatus (Peers, Management)
nkk-secure connect             VPN verbinden (--setup-key fuer Erst-Enrollment, --mgmt Override)
nkk-secure disconnect          VPN trennen (Auto-Reconnect der GUI respektiert das, s.u.)
nkk-secure profile             Anzeige-Profil zeigen
nkk-secure profile <token>     Profil setzen (NUR opakes Token, wie im Onboarding-Befehl)
nkk-secure connectivity        Internet-/Captive-Portal-Check
nkk-secure inventory [--json]  Host, OS, Versionen, IP (fuer RMM-Inventar)
nkk-secure diagnose [--json]   Gesamtdiagnose in einem Aufruf
nkk-secure update              App+CLI headless aktualisieren (Level-Patchweg, s.u.)
nkk-secure version [--json]    Versionen
```

Exit-Codes (stabil, fuer Skripte): 0 ok/verbunden, 1 getrennt/Fehler,
2 verbindet/Eingabe noetig, 3 Management nicht erreichbar, 5 NetBird fehlt.

## update: der Level-Patchweg (Design, WARUM so)

- **Windows/macOS:** `update` startet das GEHOSTETE Rollout-Skript
  (`update-all-windows.ps1` bzw. `macos-install.sh` von api.secure) **detached**
  und kehrt sofort zurueck. Zwei bewusste Entscheidungen:
  1. *Gehostet statt eingebacken:* die Update-Logik wird serverseitig verbessert
     und wirkt sofort auf allen Clients, ohne CLI-/App-Release. Nichts veraltet
     beim Kunden.
  2. *Detached statt synchron:* der Installer ersetzt `nkk-secure.exe` selbst;
     liefe die CLI weiter, waere die Datei gesperrt (Self-Replace-Lock).
     Ergebnis prueft man im Folgeschritt mit `nkk-secure version`.
- **Linux:** echtes Self-Update. `latest.json` lesen, signierte CLI laden,
  **minisign-Signatur gegen den eingebackenen Updater-Pubkey pruefen** (gleiche
  Vertrauenskette wie der GUI-Updater), atomarer Self-Replace. Ohne gueltige
  Signatur wird NICHTS uebernommen.
- Unabhaengig davon aktualisiert der normale App-Auto-Updater (alle 6h) die CLI
  auf Win/Mac immer mit, weil sie Teil des signierten App-Bundles ist.

Die Update-URLs kommen aus `branding.json` (Basis von `newsUrl`), nicht
hartkodiert: white-label-faehig fuer weitere Kunden.

## Sicherheit

- **Profil nur per opakem Token** (identisch zum Onboarding-Befehl). Klartext
  (`it_admin` usw.) wird abgelehnt, damit sich niemand per CLI hochstuft. Das
  Token steuert ohnehin nur sichtbare Kacheln; echten Netzwerkzugriff erzwingt
  IMMER die NetBird-Gruppe (kryptografisch ueber den Setup-Key).
- Die CLI gibt niemals Setup-Keys oder Secrets aus.
- Linux-Update ist minisign-verifiziert (Pubkey identisch zu
  `tauri.conf.json plugins.updater.pubkey`).

## GUI/CLI-Konsistenz (kein Kampf der Werkzeuge)

`disconnect` schreibt denselben persistenten "bewusst getrennt"-Marker wie die
GUI (`user-disconnected.flag` im App-Datenverzeichnis); der Status-Poller der
GUI liest ihn pro Tick zurueck. Ein CLI-Trennen wird also NICHT vom
Auto-Reconnect der laufenden App ueberstimmt, ein CLI-Connect gibt ihn wieder
frei. Profil-Aenderungen landen in der Bootstrap-Datei und greifen beim
naechsten App-Start (die CLI sagt das an).

## Architektur (patchbar, driftfrei)

```
nkk-core (Tauri-frei)      <- EINE Wahrheit: NetbirdClient, Branding, Profil-
  |         |                 Logik, Pfade, Updater-Konstanten
GUI (src-tauri)   nkk-cli  <- beide bauen gegen nkk-core, koennen nicht driften
```

- `crates/nkk-core/src/profile.rs`: Token-Mapping, App-Datenpfade (identifier-
  basiert), Marker. **Drift-Guard-Test** erzwingt Identifier == tauri.conf.json.
- `crates/nkk-core/src/updater.rs`: Updater-Pubkey + Manifest-URL.
  **Drift-Guard-Test** erzwingt Gleichstand mit tauri.conf.json. Beide Tests
  laufen in der CI (`cargo test --workspace --lib`).
- Profil-Tokens muessen synchron bleiben mit
  `admin-panel/src/lib/profiles.ts` (PROFILE_TOKENS).

## CI / Bundling (wie die CLI zum Kunden kommt)

- `tauri.conf.json bundle.externalBin: ["binaries/nkk-secure"]` (Sidecar).
- CI Windows: baut `nkk-cli`, legt `binaries/nkk-secure-x86_64-pc-windows-msvc.exe`
  ab (VOR jedem Compile des App-Crates - `generate_context!` validiert die Datei).
  NSIS legt INSTDIR in den Maschinen-PATH (PowerShell-.NET-API, keine
  1024-Zeichen-Truncation) und raeumt ihn beim Uninstall.
- CI macOS: baut beide Arches, `lipo` zu `nkk-secure-universal-apple-darwin`,
  danach **zwingend `codesign --force --sign -`** (lipo bricht die Signatur;
  ohne Re-Sign killt Apple Silicon das Binary). `macos-install.sh` signiert
  inside-out (erst Sidecar, dann Bundle) und setzt den Symlink.
- CI Linux (Tag-Build): CLI wird mit dem TAURI_SIGNING-Key signiert
  (`tauri signer sign`), als Release-Asset `nkk-secure-linux-x86_64` (+`.sig`)
  publiziert und von `patch-manifest` als `linux-x86_64` in `latest.json`
  gemerged. Fehlt das Asset, degradiert `update` (Linux) sauber mit klarer
  Meldung; Win/Mac sind nie betroffen.
- Lokal (frischer Clone): `release.sh` baut das Host-Sidecar selbst nach;
  `src-tauri/binaries/` ist gitignored.

## Download-Robustheit (die NSIS-Integritaets-Lehre)

Alle Download-Pfade (Installer-One-Liner, install-windows.ps1,
update-all-windows.ps1, macos-install.sh) sind auf dieselbe Weise gehaertet:
**kein `curl -C -` Resume** (Resume auf stale Teildatei = Frankenstein-EXE ->
NSIS "integrity check failed"), kein `--retry-all-errors` (kennt altes
Windows-10-curl nicht), `--fail`, TLS 1.2 erzwungen, GUID-Temp-Namen,
**Content-Length exakt gegenpruefen**. Wenn ein Kunde den Fehler trotzdem
meldet: alte Teildatei loeschen und mit dem FRISCHEN Befehl von der
Releases-Seite laden; Hash-Kontrolle mit `certutil -hashfile <exe> SHA256`.
