# Changelog

Alle relevanten Änderungen am NKK Secure Access Client + Installer.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Hardening Pass
- Rust Panic Audit — `expect()` durch `tracing::warn!` + graceful fallback ersetzt in `lib.rs` und `tray.rs`
- Setup Key Validierung (8-128 Zeichen, alphanumerisch + `-_`)
- RDP Target Whitelist (alphanumerisch + `.`/`-`/`:`)
- SMB Target Whitelist (UNC + alphanumerisch)
- URL Schema Whitelist (`http`/`https`/`mailto` only)
- Tray Icon Fallback (1×1 transparent statt panic wenn `default_window_icon` None)
- Tauri Runtime Crash → strukturiertes Logging + sauberer Exit Code 1

### NSIS Installer Hardening
- Reinstall Detection — überspringt NetBird MSI wenn bereits installiert
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
- README.md — komplette Projekt Übersicht
- docs/ROLLOUT.md — Distribution für NKK Admins
- docs/TROUBLESHOOTING.md — häufige Probleme + Diagnose
- CHANGELOG.md (diese Datei)

## [0.1.0] — 2026-04-09

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
- Code Signing fehlt — SmartScreen warnt einmalig bei Browser Downloads
- Auto-Updater ist Phase 2
- ESET Pause ist best-effort, funktioniert nur wenn Service `ekrn` steht
