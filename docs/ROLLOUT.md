# NKK Secure Access — Rollout Anleitung

Für NKK IT Admins (oder KronSolutions). So verteilen wir den Client an die rund 20 NKK Mitarbeiter ohne dass jemand SmartScreen zu sehen bekommt oder den Setup Key händisch eingeben muss.

## Übersicht

| Schritt | Wer | Wann |
|---|---|---|
| 1. Aktuellen EXE Build holen | KronSolutions | Vor jedem Rollout |
| 2. Setup Key pro Mitarbeiter aus NetBird Dashboard | NKK Admin | Einmalig pro User |
| 3. EXE auf File Share legen ODER per GPO ausrollen | NKK IT | Einmal |
| 4. Mitarbeiter klickt → Setup → Verbunden | Mitarbeiter | 30 Sekunden |

## 1. Build holen

Das CI baut bei jedem Push auf `main` oder Tag `v*.*.*` automatisch eine Windows EXE.

```bash
# Manuell triggern
gh workflow run build-windows.yml --repo leonkro-test/nkk-secure-access-test

# Oder Tag pushen für ein Release
git tag v0.2.0
git push --tags
```

Download:
- Aus GitHub Actions: https://github.com/leonkro-test/nkk-secure-access-test/actions
- Oder bei Tag-Builds aus GitHub Releases: https://github.com/leonkro-test/nkk-secure-access-test/releases

Datei: `NKK Secure Access_X.Y.Z_x64-setup.exe` (~34 MB)

## 2. Setup Key generieren

Im selbst-gehosteten NetBird Management Dashboard auf `https://netbird.nkkhb.de` einloggen:

1. Settings → Setup Keys
2. „Create Setup Key"
3. Type: `One-off` für persönliche Keys, `Reusable` für gemeinsame
4. Group: `nkk-employees` (oder spezifischer)
5. Expires: 30 Tage
6. Key kopieren — sieht aus wie `XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`

## 3. Distribution Optionen (kein SmartScreen)

### Option A — Internes File Share (empfohlen, kostenlos)

EXE auf den NKK Fileserver legen den die Mitarbeiter sowieso schon gemappt haben:

```
\\nkk-files\Software\NKK-Secure-Access-Setup-x64.exe
```

**Vorteil:** Dateien aus internen SMB Shares haben **kein Mark-of-the-Web** → Windows zeigt **keine SmartScreen Warnung**.

**Mail an Mitarbeiter:**

> Liebe Kolleginnen, liebe Kollegen,
>
> wir stellen unsere VPN Verbindung auf eine neue Lösung um.
>
> **Was du tun musst:**
> 1. Doppelklick auf `\\nkk-files\Software\NKK-Setup.exe`
> 2. Setup läuft durch (~1 Minute, NetBird wird automatisch mit installiert)
> 3. Im Startmenü unter **KronSolutions → NKK Secure Access verbinden** klicken
> 4. Setup Key eingeben (in der separaten Mail von KronSolutions)
> 5. Verbinden klicken — fertig
>
> Bei Fragen: support@ticket.kronsolutions.de
>
> KronSolutions GmbH

### Option B — Group Policy / Intune (vollautomatisch)

Wenn NKK ein Active Directory mit Group Policy oder Microsoft Intune nutzt: silent push, kein User Click.

**GPO Software Installation (.exe Methode via Wrapper):**

`startup-script.bat`:
```batch
@echo off
\\nkk-files\Software\NKK-Setup.exe /S /SETUPKEY=%SETUPKEY%
```

**Intune Win32 App:**
- Type: EXE
- Install command: `NKK-Secure-Access-Setup-x64.exe /S /SETUPKEY=KEY_HIER`
- Detection: Registry Key `HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\NKK Secure Access` exists

### Option C — Per Mail (manuell, mit SmartScreen)

Wenn keine Infrastruktur da ist:
- EXE als Anhang oder OneDrive Link verschicken
- Mitarbeiter sieht **einmalig** die SmartScreen Warnung → klickt „Weitere Informationen" → „Trotzdem ausführen"
- Anleitung im Mail Text!

## 4. Silent Install Optionen

| Parameter | Effekt |
|---|---|
| `/S` | Komplett silent (kein Wizard, kein UI) |
| `/SETUPKEY=KEY` | NetBird Setup Key direkt im Befehl mitgeben |
| `/D=C:\Custom\Path` | Custom Install Directory (default `C:\Program Files\NKK Secure Access`) |

Beispiel für vollautomatischen Rollout:
```cmd
NKK-Secure-Access-Setup-x64.exe /S /SETUPKEY=ABCDEFGH-1234-5678-90AB-CDEFGHIJKLMN
```

Alternative: `setup.conf` Datei NEBEN der EXE legen:
```
ABCDEFGH-1234-5678-90AB-CDEFGHIJKLMN
```
Dann reicht `NKK-Setup.exe /S` ohne Parameter — der Installer liest den Key aus der Datei.

## 5. Was beim Mitarbeiter passiert

Nach dem Doppelklick (oder silent install):

1. **NSIS Wizard** öffnet sich (deutsch, KronSolutions Branding)
2. **Defender Exclusion** wird für NetBird Pfade gesetzt (verhindert Probleme bei Wintun Driver Install)
3. **ESET Network Protection** wird pausiert falls installiert (best effort, ESET kann Wintun blockieren)
4. **NKK Secure Access Binary** wird nach `C:\Program Files\NKK Secure Access\` installiert
5. **NetBird Client** wird silent mit installiert (~30 s)
6. **NetBird Service** wird auf **Automatisch** gesetzt und gestartet
7. **Setup Key** wird via `netbird up --setup-key ... --management-url https://netbird.nkkhb.de:33073` injiziert (falls übergeben)
8. **ESET** wird wieder aktiviert
9. **Startmenü Einträge** unter `KronSolutions → NKK Secure Access`
10. **Programs & Features** Eintrag für Uninstall

Logs: `C:\ProgramData\KronSolutions\NKK-Secure-Access\logs\`

## 6. Update / Re-Install

Neuer Build wird einfach nochmal ausgeführt:
- Installer erkennt vorhandene NetBird Installation und überspringt MSI
- Updates die NKK Secure Access Binary
- Bestehende Setup Keys / Anmeldedaten bleiben im OS Keystore erhalten
- Tunnel kommt nach Update sofort wieder hoch

## 7. Uninstall

Über **Systemsteuerung → Programme und Features → NKK Secure Access → Deinstallieren** (NICHT aus dem Startmenü).

Der Custom Uninstaller:
1. Trennt aktive NetBird Verbindung
2. Stoppt + entfernt NetBird Service
3. Deinstalliert gebundlete NetBird Komponente
4. Entfernt alle NetBird Reste aus Program Files / ProgramData / LocalAppData
5. Entfernt Defender Exclusions
6. **Wintun Driver bleibt erhalten** (andere WireGuard Tools könnten ihn nutzen)

## 8. Support

| Problem | Lösung |
|---|---|
| SmartScreen warnt | Verteilung über internes File Share statt Browser Download |
| ESET blockiert NetBird | Im Wizard Log nach „eset-pause" suchen, ggf. ESET Admin manuell pausieren lassen |
| Setup Key abgelaufen | Im NetBird Dashboard einen neuen erstellen, Mitarbeiter macht Re-Install |
| Mitarbeiter weiß Key nicht mehr | Aus dem Diagnose Panel der App: User-Identität ist sichtbar |
| App startet nicht | `C:\ProgramData\KronSolutions\NKK-Secure-Access\logs\` an support@ticket.kronsolutions.de schicken |

Vollständige Liste in [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
