# NKK Secure Access

Whitelabel-fähiger Tauri Desktop Client + Windows Installer für **NetBird WireGuard VPN**. Pilotkunde **Naturkost Kontor Bremen GmbH (NKK)**, gebaut von **KronSolutions GmbH**.

Der Client ist ein dünnes UX-Layer über dem NetBird Daemon. Er ersetzt die generische Securepoint Client UI durch ein gebrandetes Mitarbeiter Interface mit Cherry Logo, Quick Launch Buttons für Terminalserver, Status Indikator, Diagnose Panel für Support und systemweitem Tray Icon.

Der Windows Installer bündelt den offiziellen NetBird Client und installiert ihn beim Setup automatisch silent mit — der Mitarbeiter klickt nur auf die EXE.

## Architektur

```
┌──────────────────────────────────────────┐
│   NKK Secure Access (Tauri 2.x)          │
│   ┌─────────────┐    invoke    ┌───────┐ │
│   │ React UI    │ ────────────►│ Rust  │ │
│   │ TypeScript  │ ◄────────────│ Core  │ │
│   └─────────────┘    events    └───┬───┘ │
└──────────────────────────────────────┼───┘
                                       │ spawn
                                       ▼
                              ┌────────────────┐
                              │ netbird CLI    │
                              └────────┬───────┘
                                       │ local socket
                                       ▼
                              ┌────────────────┐
                              │ NetBird Daemon │  Windows Service / launchd
                              │ (WireGuard)    │
                              └────────┬───────┘
                                       │ WireGuard UDP
                                       ▼
                              netbird.nkkhb.de:33073
```

## Features

| | |
|---|---|
| **Tech Stack** | Tauri 2.x + Rust + React 18 + TypeScript + Vite + Tailwind 3 |
| **Branding** | Externe `branding.json` — white-label per Kunde austauschbar |
| **Multi Profile Credentials** | OS Keystore (macOS Keychain / Windows Credential Manager / Linux Secret Service) |
| **Status Polling** | 30 s Hintergrund Loop, on-demand Refresh im Diagnose Panel |
| **Quick Launch** | RDP zu Terminalservern (TS1/TS2) — frischer Login Prompt jedes Mal |
| **Tray Icon** | Custom Right-Click Menü, dynamischer Tooltip nach VPN Status |
| **Autostart** | OS-native (LaunchAgent / Run Key) — opt-in über Settings |
| **Diagnose Panel** | 4 Ampeln + Public IP / WireGuard IP / OS / Hostname / Logs / „Diagnose kopieren" |
| **NSIS Installer** | Bundled NetBird Silent Install + Defender Exclusion + ESET Pause + Autostart Service |
| **Custom Uninstaller** | Programs & Features Eintrag, NetBird Cleanup, Wintun Driver bleibt erhalten |
| **Setup Key Injection** | `/SETUPKEY=...` CLI Param oder `setup.conf` neben EXE |
| **Logging** | `%PROGRAMDATA%\KronSolutions\NKK-Secure-Access\logs\` (Windows), `~/Library/Application Support/NKK Secure Access/logs/` (macOS) |

## Schnellstart für Mitarbeiter (Windows)

1. **Installer doppelklicken** → `NKK Secure Access_X.Y.Z_x64-setup.exe`
2. SmartScreen Warnung → „Weitere Informationen" → „Trotzdem ausführen" (einmalig, weil unsigned)
3. Wizard durchklicken (3× Weiter) — der NetBird Client wird im Hintergrund silent mitinstalliert
4. **Startmenü** → `KronSolutions → NKK Secure Access verbinden`
5. Setup Key eingeben (falls nicht via Installer Parameter mitgegeben)
6. **Verbinden** klicken → fertig

## Voraussetzungen für Entwicklung

- **Node.js** 20+
- **Rust** stable (`rustup default stable`)
- **NetBird Client** (für lokales Testen — Tauri-Build holt sich die Windows Variante automatisch via `fetch-netbird.sh`)
- macOS: Xcode Command Line Tools
- Windows: Visual Studio Build Tools („Desktop development with C++") + WebView2 Runtime (in Win11 vorinstalliert)
- Linux: `libwebkit2gtk-4.1-dev`, `librsvg2-dev`, `patchelf`

## Lokale Entwicklung

```bash
git clone https://github.com/ksleon-dev/nkk-secure-access-test.git
cd nkk-secure-access-test
npm install
npm run tauri dev
```

Beim ersten Start dauert der Rust Compile mehrere Minuten. Vite HMR + Tauri's File Watcher reload alles live während du arbeitest.

## Build (lokal)

### macOS DMG
```bash
npm run tauri build
# Output: src-tauri/target/release/bundle/dmg/*.dmg
```

### Windows EXE (auf Windows!)
```powershell
npm ci
pwsh src-tauri\bin\fetch-netbird.ps1   # lädt Netbird Installer ins bin/
npm run tauri build -- --bundles nsis
# Output: src-tauri\target\release\bundle\nsis\*.exe
```

### Linux .deb / .AppImage
```bash
npm run tauri build
```

## Build via GitHub Actions (empfohlen für Windows)

Push auf `main` oder Tag `v*.*.*` triggert automatisch den Workflow `.github/workflows/build-windows.yml`:

1. Checkout
2. Node + Rust + Cache
3. `npm ci`
4. `pwsh src-tauri/bin/fetch-netbird.ps1` — pinnt aktuelle NetBird Version
5. `npm run tauri build -- --bundles nsis`
6. Upload Artifact `nkk-secure-access-windows`
7. Bei Tag → automatisches GitHub Release

Manuelles Triggern:
```bash
gh workflow run build-windows.yml
```

## Branding anpassen (White Label)

Alle Brand-spezifischen Werte stehen in `src-tauri/resources/branding.json`. Beispiel für einen anderen Kunden:

```json
{
  "product": {
    "name": "Acme Secure Access",
    "shortName": "ACME",
    "version": "0.1.0",
    "tagline": "Dein Großhandel",
    "logoText": ["Acme", "Inc"],
    "networkName": "Acme Netz"
  },
  "vendor": {
    "name": "KronSolutions GmbH",
    "footer": "Powered by KronSolutions",
    "supportEmail": "support@ticket.kronsolutions.de",
    "supportUrl": "https://kronsolutions.de"
  },
  "theme": {
    "primary": "#1E40AF",
    "primaryHover": "#1E3A8A",
    "accent": "#60A5FA",
    "background": "#F5F5F5",
    "foreground": "#1A1A1A"
  },
  "netbird": {
    "managementUrl": "https://vpn.acme.example",
    "adminUrl": "https://vpn.acme.example",
    "defaultDomain": "ACME",
    "internalDomainSuffix": "acme.internal"
  },
  "quickLaunch": [
    { "label": "Terminalserver", "type": "rdp", "target": "ts.acme.internal", "default": true }
  ]
}
```

Die Laufzeit-Texte (Produktname, Netzname, Tagline-Text, Domäne, Farben) kommen aus `branding.json`. Folgende Dinge sind **Build-Zeit-Identität** und müssen pro Mandant beim Build getauscht werden, nicht nur in der JSON:

- Logo SVG (`src-tauri/resources/assets/nkk-logo.svg` und `src/assets/nkk-logo.svg`)
- Tagline-Wortmarke (`src/assets/dein-grosshandel.svg`)
- Tray/Bundle Icons in `src-tauri/icons/`
- `tauri.conf.json`: `productName`, `identifier`, `plugins.updater.endpoints`
- `package.json` / `Cargo.toml`: `name`

Damit bekommt jeder Mandant eine eigene App-Identität, eigenen Keystore-Namespace und einen eigenen Update-Kanal (so gewollt).

## Projektstruktur

```
nkk-secure-access/
├── src/                                   React Frontend
│   ├── App.tsx                            Top-Level Routing + State
│   ├── main.tsx                           React Entry + Context Menu Block
│   ├── index.css                          Tailwind + Brand CSS Variables
│   ├── vite-env.d.ts                      SVG/PNG Module Declarations
│   ├── components/
│   │   ├── Avatar.tsx                     Initialen Avatar für Profile
│   │   ├── CherryDivider.tsx              Brand Divider mit Mini-Cherry SVG
│   │   ├── ConnectButton.tsx              Pill Style Connect/Disconnect
│   │   ├── Decor.tsx                      Cream Blob + Bio Sprig SVG Background
│   │   ├── Logo.tsx                       NKK Logo (traced SVG)
│   │   ├── PeerList.tsx                   NetBird Peer List (Diagnose only)
│   │   ├── StatusBadge.tsx                Status Pill (Verbunden / Verbinde / Fehler)
│   │   ├── TaglineMark.tsx                "Dein Bio-Großhandel" Vector
│   │   └── Toast.tsx                      Custom Toast System
│   ├── screens/
│   │   ├── EnrollmentScreen.tsx           First-Run Setup Key Eingabe
│   │   ├── MainScreen.tsx                 Hero + Greeting + Launch Cards
│   │   ├── SettingsScreen.tsx             Profile / Autostart / Logs / Reset
│   │   ├── DiagnosePanel.tsx              KronSolutions Support Diagnose
│   │   ├── CredentialsModal.tsx           Profile CRUD Modal
│   │   └── AboutDialog.tsx                Version + Vendor + Support Links
│   ├── types/
│   │   ├── branding.ts
│   │   ├── credentials.ts
│   │   ├── debug.ts
│   │   └── netbird.ts
│   ├── lib/greeting.ts                    Time-of-day greeting helpers
│   ├── i18n/de.ts                         German strings
│   ├── demo.ts                            Demo Mode (kein NetBird)
│   └── assets/
│       ├── nkk-logo.svg                   Traced VPN Icon (in-app)
│       └── dein-grosshandel.svg           Brand Tagline Vector
├── src-tauri/
│   ├── src/
│   │   ├── main.rs                        Binary Entry
│   │   ├── lib.rs                         Tauri Builder, Plugin Registration
│   │   ├── error.rs                       AppError + AppResult + Serialize
│   │   ├── branding.rs                    branding.json Loader (cached)
│   │   ├── netbird.rs                     CLI Wrapper + Status JSON Parser + tests
│   │   ├── commands.rs                    Tauri Commands + Polling + Validators
│   │   ├── tray.rs                        Systray Icon + Right-Click Menu
│   │   └── logging.rs                     tracing + rolling file appender
│   ├── nsis/installer.nsh                 NSIS Hooks (Defender / NetBird / ESET)
│   ├── bin/
│   │   ├── fetch-netbird.sh               macOS/Linux fetch script
│   │   ├── fetch-netbird.ps1              Windows fetch script
│   │   ├── netbird-installer.exe          [gitignored] aktueller NetBird Installer
│   │   └── README.md
│   ├── resources/
│   │   ├── branding.json                  White-label Config
│   │   └── assets/nkk-logo.svg            Bundled vector logo
│   ├── icons/                             Multi-Resolution App Icons
│   ├── capabilities/default.json
│   ├── tauri.conf.json
│   ├── build.rs
│   └── Cargo.toml
├── .github/workflows/
│   └── build-windows.yml                  CI Build + Release on tag
├── docs/
│   ├── ROLLOUT.md                         NKK Admin Distribution Anleitung
│   ├── TROUBLESHOOTING.md                 Häufige Probleme + Fixes
│   ├── HOW-TO-UPDATE.md                   Release + Auto-Updater Checkliste
│   ├── CLIENT-OVERVIEW.md                 Funktionsüberblick
│   └── MAIL-VORLAGE.md                    Rollout Mail Vorlage
├── CHANGELOG.md
├── README.md
├── package.json
├── tsconfig.json
├── tailwind.config.js
└── vite.config.ts
```

## Tauri Commands (Rust ↔ Frontend)

| Command | Zweck |
|---|---|
| `nb_connect(setup_key?)` | Validiert Setup Key, persistiert in Keyring, ruft `netbird up` |
| `nb_disconnect()` | `netbird down` |
| `nb_status()` | `netbird status --json` parsen, mit Schema-Toleranz |
| `nb_is_enrolled()` | Prüft Setup Key in Keyring |
| `nb_reset_enrollment()` | Tunnel down + Key löschen |
| `nb_logs(lines)` | In-Memory Log Buffer (max 500 Zeilen) |
| `open_rdp(target)` | Smart Launcher: Auto-Connect VPN if offline → mstsc / open rdp |
| `open_smb(target)` | UNC SMB Mount öffnen |
| `open_url(url)` | Whitelist (https/http/mailto) → Default Browser |
| `get_branding()` | branding.json zurückgeben |
| `set_autostart(enable)` | Login Item ein/aus |
| `is_autostart_enabled()` | Status Login Item |
| `quit_app()` | Hard Exit |
| `creds_list()` | Alle Profile (ohne Passwörter) |
| `creds_save({id?, label, username, password, domain})` | Upsert mit Round-Trip Verify |
| `creds_delete(id)` | Profil löschen |
| `creds_test()` | Keyring Roundtrip Diagnostic |
| `creds_default_username()` | OS User Name |
| `get_debug_info()` | Vollständiger Diagnose Snapshot (parallel checks) |
| `run_ping_test()` | 4× Ping LAN + Referenz |
| `run_speed_test()` | Cloudflare CDN Durchsatz |
| `smart_debug()` | Self-Healing Diagnose (prüft und repariert) |
| `check_netbird_setup()` / `install_netbird()` | NetBird Setup, macOS Auto-Install |
| `get_inventory()` | Lokale Geräte-/System-Karte (RMM-Fundament) |
| `get_health_history(limit)` | Lokale Verbindungs-Historie |
| `export_support_bundle()` | Support-Paket als Datei, zeigt es im Dateimanager |
| `check_connectivity()` | Online / Captive Portal / Offline |

## Rollout / Distribution

Siehe [`docs/ROLLOUT.md`](docs/ROLLOUT.md) für detaillierte Anleitung zur Verteilung an NKK Mitarbeiter (GPO, File Share, Mail, etc.).

## Troubleshooting

Siehe [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

## Lizenz

Proprietär — KronSolutions GmbH. Alle Rechte vorbehalten.

---

KronSolutions GmbH · Zukunftssicher. Technologie mit Wirkung.
