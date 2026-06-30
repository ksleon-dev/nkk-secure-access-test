# Production-Readiness — NKK Secure Access

Stand: v0.3.18 + committetes Hardening (HEAD nach 0.3.18). Ergebnis aus drei
adversarial gegengeprueften Audits (Bug-Audit, Feature-Vollstaendigkeit,
Production-Readiness).

## Verdikt

**Funktional production-ready für die verwaltete ~20-Geräte-Flotte.** Feature-Set
vollständig (50/50 Backend-Befehle verdrahtet + erreichbar, 0 Waisen), alle im
Audit bestätigten Bugs behoben (0.3.18), 24/7-Hardening committet. Der einzige
echte Rest für „warnungsfrei auf JEDEM Gerät (auch BYOD/Heim)" ist **Code-Signing** —
das kostet Geld/Account und ist bewusst zurückgestellt.

## Erledigt

- **Features:** komplett (Connect/Status/Reconnect, RDP/SMB/URL + Credentials,
  Diagnose-Suite, Vor-Ort-Erkennung, Dual-Homing, Tray/Autostart, News,
  Versions-Report, vollständiges Admin-Menü). Keine Lücken.
- **Bugs (0.3.18):** 8 bestätigte Audit-Bugs gefixt (Enrollment-Regression,
  Admin-Update-Relaunch, passive-Update-Box, cmdkey-Persistenz, Reconnect-Race,
  open_rdp-Blockierung, Profil-/News-Robustheit).
- **Hardening (committet):** Rust-Panic-Hook (Backend-Panics ins Log),
  Log-Retention-Cap (14 Tagesdateien), toter Code entfernt (PeerList).
- **RDP-April-2026-Fix:** im Code vollständig (Self-Signed-Cert + Trust +
  rdpsign + Consent/LowRisk-Registry). Final nur am Live-Gerät bestätigbar.

## Offen — braucht dich (Entscheidung/Account/Live-Test)

### 1. Code-Signing (der eine echte Production-Punkt)

Ohne Signatur: Windows zeigt auf fremden/neuen Geräten SmartScreen; macOS
verlässt sich auf den xattr/ad-hoc-Workaround (einmaliger „Dennoch öffnen"-Dialog
möglich). Für die Flotte via SMB-/GPO-Verteilung praktisch umgangen; BYOD/Heim bleibt
exponiert.

**Windows — Empfehlung: Azure Trusted Signing (~10 EUR/Monat).** Echte
Microsoft-Reputation → SmartScreen verschwindet sofort, auch auf Heimgeräten.
(Self-signed löst SmartScreen NICHT, nur den UAC-Herausgeber — von der Gegenprüfung
bestätigt.) Secrets: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`,
`AZURE_SUBSCRIPTION_ID`, `AZURE_TS_ENDPOINT`, `AZURE_TS_ACCOUNT`, `AZURE_TS_PROFILE`.

**macOS — Apple Developer ID + Notarisierung (99 USD/Jahr).** Macht den
xattr/ad-hoc-Workaround überflüssig. Secrets: `APPLE_CERTIFICATE` (base64 .p12),
`APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`
(app-spezifisch), `APPLE_TEAM_ID`, `KEYCHAIN_PASSWORD`.

**Umsetzungs-Hinweise (für wenn ihr's wollt):**
- Die .exe MUSS signiert sein, BEVOR `latest.json`/`.sig` erzeugt wird (sonst
  bricht der Updater-Integritätscheck).
- Gating NICHT über `if: ${{ secrets.X != '' }}` (in GitHub Actions verboten →
  CI-Syntaxfehler). Stattdessen Secrets auf `env` mappen und auf `env` prüfen.
- `TAURI_SIGNING_PRIVATE_KEY` (minisign, Updater) bleibt unverändert nötig.

→ Sag Bescheid, wenn ihr ein Zertifikat/Account beschafft; dann baue ich die
CI-Signierung sauber + verifiziert ein.

### 2. Live-Test am Windows-Gerät
- RDP-April-2026: am echten Client prüfen, dass keine „Unbekannter Herausgeber"/
  „RDP-Datei öffnen"-Warnung mehr kommt. Falls doch: Screenshot → exaktes Registry-
  Detail nachziehen.
- Windows-Firewall: prüfen, ob beim ersten `netbird up` ein Firewall-Dialog kommt
  (als SYSTEM-Dienst meist unterdrückt). Falls ja: proaktive Firewall-Regel im
  NSIS-Postinstall nachrüsten.

### 3. Admin-Schritt (Bitdefender)
GravityZone-Policy: `%PROGRAMFILES%\NetBird` (netbird.exe, wintun) dauerhaft
whitelisten, damit Bitdefender den Wintun-Treiber nicht später erneut quarantänt.
(Der Installer pausiert Bitdefender nur während der Installation.)

## Bewusst nicht geändert (kein Problem)
- Updater-Endpoint zeigt auf `-test`-Repo: das IST euer Live-Update-Kanal (die CI
  pinnt es ohnehin pro Build). Kein Drift.
- Admin-„Level installieren"-Sektion ist dormant (leeres `levels`): harmlos,
  erscheint in der UI nie, bis ihr lokale Befehls-Bundles befüllt.
