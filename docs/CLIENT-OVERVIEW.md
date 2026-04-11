# NKK Secure Access — Client Übersicht für Entwickler

**Stand:** April 2026
**Erstellt von:** KronSolutions GmbH
**Repo:** https://github.com/leonkro-test/nkk-secure-access-test

---

## 1. Was ist das

Ein Desktop VPN Client für Naturkost Kontor Bremen GmbH (NKK). Ersetzt den alten Securepoint SSL VPN Client durch eine gebrandete, einfache Oberfläche über dem NetBird WireGuard Tunnel.

Der Mitarbeiter sieht: NKK Logo, zwei große Buttons für Terminalserver, Status Bar. Vom VPN/WireGuard/NetBird merkt er nichts.

## 2. Tech Stack

| Schicht | Technologie | Version |
|---|---|---|
| Framework | Tauri 2.x | 2.10+ |
| Backend | Rust (Edition 2021) | stable |
| Frontend | React 18 + TypeScript | 18.3 |
| Bundler | Vite 5 | 5.4 |
| Styling | Tailwind CSS 3 | 3.4 |
| Icons | lucide-react | 0.460 |
| VPN | NetBird (WireGuard) | latest |
| Installer | NSIS (via Tauri Bundle) | — |
| CI/CD | GitHub Actions | windows-latest |
| Keystore | OS-native (Keychain/DPAPI/SecretService) | keyring 3.6 |

## 3. Architektur

```
┌──────────────────────────────────────────┐
│  React UI (WebView2)                     │
│  ├── MainScreen (Logo, TS Buttons, VPN)  │
│  ├── EnrollmentScreen (Setup Key)        │
│  ├── SettingsScreen (Profile, Autostart) │
│  ├── DiagnosePanel (Debug, Speed, Ping)  │
│  ├── NewsScreen (Remote JSON)            │
│  └── UpdateBanner (Auto Updater)         │
│           │ invoke / events              │
│  Rust Core (Tauri Commands)              │
│  ├── commands.rs (30+ Commands)          │
│  ├── netbird.rs (CLI Wrapper)            │
│  ├── branding.rs (White Label Config)    │
│  ├── tray.rs (System Tray)              │
│  ├── logging.rs (Rolling File Logger)    │
│  └── error.rs (AppError Enum)            │
└──────────────────────────────────────────┘
         │ spawn (CREATE_NO_WINDOW)
         ▼
┌──────────────────┐
│ netbird CLI      │──► netbird daemon (Windows Service)
└──────────────────┘         │ WireGuard UDP
                             ▼
                    netbird.nkkhb.de:33073
```

## 4. Projektstruktur

```
nkk-secure-access/
├── src/                          React Frontend (~1800 Zeilen)
│   ├── App.tsx                   Routing + State + Event Listeners
│   ├── main.tsx                  Entry + Context Menu Block
│   ├── index.css                 Tailwind + Brand Vars + Animationen
│   ├── demo.ts                   [GELÖSCHT] Demo Mode
│   ├── components/
│   │   ├── Avatar.tsx            Initialen-Avatar für Profile
│   │   ├── ConnectButton.tsx     [GELÖSCHT] Alter Connect Button
│   │   ├── CherryDivider.tsx     Brand Divider SVG
│   │   ├── Decor.tsx             Background Blob SVGs
│   │   ├── Logo.tsx              NKK Logo (traced SVG Import)
│   │   ├── PeerList.tsx          Peer Liste (nur in Diagnose)
│   │   ├── StatusBadge.tsx       Status Pill Component
│   │   ├── TaglineMark.tsx       "Dein Bio-Großhandel" SVG
│   │   ├── Toast.tsx             Custom Toast System (click dismiss)
│   │   └── UpdateBanner.tsx      Auto Update Modal
│   ├── screens/
│   │   ├── MainScreen.tsx        Hero + Greeting + Launch Cards
│   │   ├── EnrollmentScreen.tsx  Setup Key Eingabe + Animationen
│   │   ├── SettingsScreen.tsx    Profile CRUD + Autostart + Logs
│   │   ├── DiagnosePanel.tsx     Debug Info + Ping + Speed + Actions
│   │   ├── NewsScreen.tsx        Remote News (JSON Fetch)
│   │   ├── CredentialsModal.tsx  Profile Add/Edit Modal
│   │   └── AboutDialog.tsx       [UNUSED] Version Info
│   ├── hooks/
│   │   └── useUpdater.ts         Tauri Auto Updater Hook
│   ├── lib/
│   │   └── greeting.ts           Tageszeit-Greeting + Bio Footnotes
│   ├── types/
│   │   ├── branding.ts           BrandingDto TypeScript Interface
│   │   ├── credentials.ts        Profile Types + Helper Functions
│   │   ├── debug.ts              DebugInfo + SpeedResult + PingResult
│   │   └── netbird.ts            StatusDto + ConnectionState
│   ├── i18n/
│   │   └── de.ts                 Deutsche UI Strings
│   └── assets/
│       ├── nkk-logo.svg          Traced VPN Icon (potrace)
│       └── dein-grosshandel.svg  Brand Tagline Vector
│
├── src-tauri/                    Rust Backend (~1100 Zeilen)
│   ├── src/
│   │   ├── main.rs               Binary Entry
│   │   ├── lib.rs                Tauri Builder + Plugin Registration
│   │   ├── commands.rs           ALLE Tauri Commands (~900 Zeilen)
│   │   ├── netbird.rs            CLI Wrapper + JSON Parser + Tests
│   │   ├── branding.rs           branding.json Loader (OnceLock Cache)
│   │   ├── tray.rs               System Tray + Right-Click Menu
│   │   ├── logging.rs            tracing + Rolling File Appender
│   │   └── error.rs              AppError Enum + Serialize
│   ├── nsis/
│   │   ├── installer.nsh         NSIS Hooks (ESET, Defender, NetBird)
│   │   ├── header.bmp            Installer Header (150x57)
│   │   └── sidebar.bmp           Installer Sidebar (164x314)
│   ├── bin/
│   │   ├── fetch-netbird.sh      macOS/Linux Fetch Script
│   │   ├── fetch-netbird.ps1     Windows Fetch Script
│   │   ├── setup.conf            [gitignored or empty] Baked Setup Key
│   │   └── netbird-installer.exe [gitignored] NetBird Installer
│   ├── resources/
│   │   ├── branding.json         White Label Config (Farben, URLs, etc)
│   │   └── assets/nkk-logo.svg   Bundled Logo
│   ├── keys/                     [gitignored] Updater Signing Keys
│   ├── icons/                    Multi-Resolution App Icons
│   ├── capabilities/default.json Tauri Permission Scoping
│   ├── tauri.conf.json           App + Bundle + NSIS + Updater Config
│   └── Cargo.toml                Rust Dependencies
│
├── .github/workflows/
│   └── build-windows.yml         CI: Build + Sign + Release
├── docs/
│   ├── CLIENT-OVERVIEW.md        [DIESE DATEI]
│   ├── ROLLOUT.md                Distribution für NKK Admins
│   └── TROUBLESHOOTING.md        Häufige Probleme + Fixes
├── news.json                     Remote News (clients fetchen das)
├── CHANGELOG.md                  Version History
├── README.md                     Projekt Übersicht
└── package.json                  Node Dependencies
```

## 5. Tauri Commands (Rust → Frontend IPC)

### VPN
| Command | Params | Return | Beschreibung |
|---|---|---|---|
| `nb_connect` | `setup_key?: String` | `()` | Validiert Key, speichert in Keyring, ruft `netbird up`, sendet Enrollment Diagnostic |
| `nb_disconnect` | — | `()` | `netbird down` |
| `nb_status` | — | `StatusDto` | `netbird status --json` parsen |
| `nb_is_enrolled` | — | `bool` | Lokale Marker Datei + netbird Status Check |
| `nb_reset_enrollment` | — | `()` | Marker + Keyring löschen, Tunnel down |
| `nb_logs` | `lines: usize` | `Vec<String>` | In-Memory Log Buffer (500 max) |

### Launcher
| Command | Params | Return | Beschreibung |
|---|---|---|---|
| `open_rdp` | `target: String` | `()` | Smart: VPN reconnect background + cmdkey inject + mstsc |
| `open_smb` | `target: String` | `()` | UNC SMB Mount öffnen |
| `open_url` | `url: String` | `()` | Whitelist https/http/mailto |

### Credentials
| Command | Params | Return | Beschreibung |
|---|---|---|---|
| `creds_list` | — | `Vec<ProfileMeta>` | Cached aus AppState |
| `creds_save` | `id?, label, username, password, domain` | `ProfileMeta` | Upsert, leeres PW bei Edit = keep |
| `creds_delete` | `id: String` | `()` | Profil löschen |
| `creds_test` | — | `KeyringTestResult` | Keyring Roundtrip Diagnostic |
| `creds_default_username` | — | `String` | OS $USER |

### Diagnose
| Command | Params | Return | Beschreibung |
|---|---|---|---|
| `get_debug_info` | — | `DebugInfo` | Parallel: ping, status, hostname, public IP, OS |
| `run_ping_test` | — | `Vec<PingResult>` | 4x Ping avg zu LAN + Internet Referenz |
| `run_speed_test` | — | `SpeedResult` | 10 MB Download via Cloudflare CDN |
| `smart_debug` | — | `SmartDebugResult` | Sequentielle Checks + Auto-Fix |

### System
| Command | Params | Return | Beschreibung |
|---|---|---|---|
| `get_branding` | — | `BrandingDto` | branding.json aus Resources |
| `set_autostart` | `enable: bool` | `()` | OS Login Item |
| `is_autostart_enabled` | — | `bool` | Status abfragen |
| `quit_app` | — | `()` | Hard Exit |

## 6. Branding System (White Label)

Alles Brand-spezifische steht in `src-tauri/resources/branding.json`:

```json
{
  "product": { "name", "shortName", "tagline", "logoText", "version" },
  "vendor": { "name", "footer", "supportEmail", "supportUrl" },
  "theme": { "primary", "primaryHover", "accent", "background", "foreground" },
  "netbird": { "managementUrl", "adminUrl" },
  "quickLaunch": [{ "label", "description", "type", "target", "default" }],
  "newsUrl": "https://...",
  "webhookUrl": "https://..."
}
```

Für einen neuen Kunden: branding.json + Logo SVG + Icons austauschen. Null Code Änderung.

## 7. Stabilität & Sicherheit

### Was läuft im Hintergrund
- **Status Polling:** alle 30s `netbird status --json` (Anti-Stacking Guard, 10s Timeout)
- **Auto Update Check:** 5s nach Start, einmal pro Session
- **Tray Icon:** Tooltip wird bei Statusänderung aktualisiert

### Absicherungen
| Risiko | Schutz |
|---|---|
| Rust Panic | 0 `.unwrap()` in Prod Code |
| CMD Windows (Win) | `CREATE_NO_WINDOW` auf jedem Subprozess |
| Zombie Prozesse | 10s Hard Timeout auf jeden CLI Call |
| Poll Stacking | AtomicBool Guard (max 1 gleichzeitig) |
| Memory Leak | LogBuffer 500 max, Profile Cache lazy |
| Keychain Spam (Mac) | Lokale enrolled.flag + Lazy Profile Load |
| Hängende Verbindung | Non-blocking RDP Launch, Background VPN Reconnect |
| ESET/Defender | NSIS: ecmd pause + Defender Exclusion pre-install |
| Unsicherer Input | Setup Key + Host + URL Validierung |
| Error Jargon | Alle Meldungen deutsch, kein "Daemon" |

### Was NICHT abgesichert ist (Phase 2)
- Code Signing Zertifikat (SmartScreen warnt einmalig)
- Automatischer VPN Reconnect nach WiFi Drop (nur manuell)
- macOS Keychain "Immer erlauben" vergisst nach Rebuild (Dev only)

## 8. Build & Deploy

### Lokale Entwicklung
```bash
npm install
npm run tauri dev
```

### Windows Build (via GitHub Actions)
```bash
git tag v0.3.0
git push --tags
# → CI baut signierte EXE + latest.json für Auto Updater
```

### Manueller Windows Build
```powershell
npm ci
pwsh src-tauri\bin\fetch-netbird.ps1
npm run tauri build -- --bundles nsis
```

### Release Artefakte
- `NKK Secure Access_X.Y.Z_x64-setup.exe` (~35 MB)
- `latest.json` (Auto Updater Manifest)
- `.sig` (Signatur für Update Verification)

### GitHub Secrets
| Secret | Zweck |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Signiert den Updater Build |
| `NKK_SETUP_KEY` | Optional: baked ins Installer Bundle |

## 9. NSIS Installer Ablauf

```
1. OS Version Check (< Win 10 → Fehler mit exakter Version)
2. WebView2 Check (fehlt → eingebetteter Bootstrapper installiert)
3. Defender Exclusion für NetBird Pfade
4. ESET Pause (ecmd -pauseprotection 5 || Stop-Service ekrn)
5. NKK Secure Access Binary installieren
6. NetBird Client silent installieren (/S Flag)
7. NetBird Service auf Automatic + Start
8. Setup Key injizieren (aus /SETUPKEY= || setup.conf || baked)
9. ESET Resume
10. Programs & Features Eintrag
11. Startmenü Einträge unter KronSolutions
```

Uninstall: Programs & Features → NetBird down + Uninstall + Cleanup + Defender Exclusion entfernen. Wintun Driver bleibt.

## 10. Remote News & Enrollment Webhook

### News pushen (ohne App Update)
1. `news.json` im Repo editieren
2. `git push`
3. Clients laden die Datei beim Öffnen der News Seite

### Enrollment Diagnostic
Bei jedem erfolgreichen Setup Key Enrollment sendet die App automatisch einen POST an `branding.webhookUrl` mit:
- Hostname, OS User, OS Version
- Public IP, WireGuard IP
- App Version, Management URL, Timestamp

Webhook Beispiel: Discord, Slack, eigener Endpoint, oder leer lassen zum Deaktivieren.

## 11. Datei Pfade zur Laufzeit

| Was | Windows | macOS |
|---|---|---|
| App Binary | `C:\Program Files\NKK Secure Access\` | `/Applications/` |
| App Logs | `%PROGRAMDATA%\KronSolutions\NKK-Secure-Access\logs\` | `~/Library/Application Support/NKK Secure Access/logs/` |
| Enrolled Marker | `%APPDATA%\de.kronsolutions.nkksecureaccess\enrolled.flag` | `~/Library/Application Support/de.kronsolutions.nkksecureaccess/enrolled.flag` |
| Branding JSON | `$INSTDIR\resources\branding.json` | `Contents/Resources/branding.json` |
| NetBird Binary | `C:\Program Files\NetBird\netbird.exe` | `/usr/local/bin/netbird` |
| NetBird Logs | `C:\ProgramData\NetBird\Logs\netbird.log` | `/var/log/netbird.log` |
| RDP Temp Files | — | `/tmp/nkk-*.rdp` |
| Keyring | Windows Credential Manager (DPAPI) | macOS Keychain |

## 12. Bekannte Limitierungen

1. **Windows 7/8:** nicht unterstützt (kein WebView2)
2. **32-bit:** nicht unterstützt (x64 only)
3. **ARM Windows:** nicht getestet
4. **Linux:** läuft technisch, aber nicht im Scope
5. **Multi-User Windows:** nicht getestet (per-machine Install, aber Keyring ist per-user)
6. **Citrix/RDS:** nicht getestet

## 13. Kontakt

- **Entwicklung:** KronSolutions GmbH
- **Support:** support@ticket.kronsolutions.de
- **Website:** https://kronsolutions.de

---

*Zukunftssicher. Technologie mit Wirkung.*
