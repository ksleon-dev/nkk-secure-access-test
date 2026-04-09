# NKK Secure Access — Troubleshooting

## Diagnose Bundle erstellen

Bevor du ein Ticket aufmachst:

1. NKK Secure Access öffnen
2. Oben rechts auf das **(i)** Info Icon klicken → Diagnose Panel öffnet sich
3. Unten auf **„Diagnose für Support kopieren"** klicken
4. Den kopierten Text in eine Mail an `support@ticket.kronsolutions.de` einfügen

Der Block enthält:
- OS User, Hostname, Betriebssystem Version
- Public IP, WireGuard IP, Peer Status
- Internet / VPN / Firmennetz Ampeln
- Letzte 15 Ereignisse aus dem App Log
- Detected Issue mit Klartext Diagnose

## Häufige Probleme

### „SmartScreen — Der Computer wurde geschützt"

**Symptom:** Beim Doppelklick auf den Installer kommt eine blaue Warnung von Windows Defender SmartScreen.

**Ursache:** Der Installer ist nicht mit einem EV Code Signing Zertifikat signiert. SmartScreen warnt bei jeder unbekannten EXE die direkt aus dem Browser oder Mail Anhang kommt (Mark-of-the-Web).

**Lösung A (User):** Auf „Weitere Informationen" klicken → „Trotzdem ausführen". Einmalig nötig.

**Lösung B (Admin):** EXE über internes File Share verteilen statt Browser Download. Dateien aus SMB Shares haben kein Mark-of-the-Web und triggern SmartScreen nicht.

---

### „NetBird Client nicht gefunden"

**Symptom:** Status Badge in der App zeigt „Netbird Client fehlt", grauer Status Punkt.

**Ursache:** Der NetBird Client wurde nicht installiert oder seine PATH Variable ist kaputt.

**Diagnose:**
```powershell
Get-Service netbird
& "C:\Program Files\NetBird\netbird.exe" --version
```

**Lösung:** Installer erneut ausführen — er erkennt das fehlende NetBird und installiert es nach.

---

### Tunnel kommt nicht hoch

**Symptom:** Status bleibt auf „Verbinde …" oder springt sofort auf „Getrennt".

**Diagnose:**
1. Diagnose Panel öffnen (i Icon)
2. Auf Refresh klicken
3. Internet Ampel: muss grün sein. Wenn rot → kein Internet → WLAN/Ethernet prüfen
4. VPN Ampel: wenn rot → NetBird Service prüfen
5. Firmennetz Ampel: wenn rot → Setup Key abgelaufen oder ACL falsch

**Lösung:**
```powershell
# NetBird Service neu starten
sc.exe stop netbird
sc.exe start netbird

# Logs ansehen
Get-Content "C:\ProgramData\NetBird\Logs\netbird.log" -Tail 50
```

Wenn das nicht hilft: Setup Key im NetBird Dashboard prüfen, ggf. neuen erstellen und in der App über „Einrichtung zurücksetzen" → Re-Enrollment.

---

### ESET blockiert die Installation

**Symptom:** NetBird Installation friert während des Wintun Driver Setups ein.

**Ursache:** ESET Network Protection blockiert die Wintun Treiber Installation als verdächtige Aktivität.

**Lösung:**

1. ESET Console öffnen
2. „Schutz pausieren für 5 Minuten"
3. NKK Installer erneut starten
4. Nach Abschluss ESET wieder aktivieren

Der Installer versucht das automatisch via PowerShell — falls ESET aber im „Strict Mode" läuft braucht es manuelle Admin Erlaubnis.

---

### Anmeldedaten Modal ist leer / Username springt zurück

**Symptom:** Im Profil Modal kannst du den Benutzernamen nicht löschen, er kommt sofort wieder.

**Ursache:** War ein Bug in v0.1.0, gefixt in v0.1.1+. Die Auto-Prefill aus `$USER` sollte nur einmal beim ersten Öffnen passieren.

**Lösung:** Update auf neueste Version.

---

### macOS Schlüsselbund Prompt bei jedem Öffnen der Settings

**Symptom:** Bei jedem Öffnen der Einstellungen kommt ein macOS Dialog der nach dem Schlüsselbund Passwort fragt.

**Ursache:** App ist nicht mit einem Apple Developer ID Zertifikat signiert, deshalb fragt macOS bei jedem Keychain Access nach Erlaubnis.

**Lösung:**
- Im Dialog auf **„Immer erlauben"** klicken — danach kommt der Prompt nicht mehr für diesen Binary
- In v0.1.1+ ist der Keyring Test in Settings opt-in (Button) statt automatisch beim Mount

---

### App startet nicht nach Windows Login

**Symptom:** Autostart ist in den Settings aktiviert, aber nach Login startet die App nicht.

**Diagnose:**
```powershell
# Run Key prüfen
Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" | Select-Object NKK*
```

**Lösung:** Autostart Toggle in den Settings einmal aus- und wieder einschalten — das schreibt den Run Key sauber neu.

---

### „Verbindung gestört" — keine Peers sichtbar

**Symptom:** App zeigt verbunden, aber `nb_status` liefert 0 Peers.

**Ursache:** NetBird Management Server hat den Client noch nicht autorisiert oder die Gruppe ist falsch konfiguriert.

**Diagnose:**
```powershell
& "C:\Program Files\NetBird\netbird.exe" status --json
```

**Lösung:** Im NetBird Dashboard prüfen ob der Peer in der richtigen Gruppe ist und ACLs Zugriff erlauben.

---

### RDP zu Terminalserver schlägt fehl

**Symptom:** Klick auf „Terminalserver 2 öffnen" startet `mstsc`, aber Verbindung schlägt fehl.

**Diagnose:**
1. Diagnose Panel → ist die LAN Ampel grün?
2. Wenn rot → NetBird liefert die Route nicht aus → ACL im Dashboard prüfen
3. Wenn grün → Firewall auf dem Terminalserver prüft RDP Port 3389

**Lösung:** Im NetBird Dashboard das Routing Profil prüfen, sicherstellen dass die NKK Subnets (`192.168.0.0/24`) ausgespielt werden.

---

### Uninstall lässt Reste zurück

**Symptom:** Nach Deinstallation existiert `C:\Program Files\NetBird\` noch.

**Diagnose:**
```powershell
Test-Path "C:\Program Files\NetBird"
Get-Service netbird -ErrorAction SilentlyContinue
```

**Lösung (manuell aufräumen):**
```powershell
sc.exe stop netbird
sc.exe delete netbird
Remove-Item -Recurse -Force "C:\Program Files\NetBird" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "C:\ProgramData\NetBird" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\NetBird" -ErrorAction SilentlyContinue
```

Wintun Treiber bleibt absichtlich erhalten — wenn du den auch entfernen willst:
```powershell
pnputil /enum-drivers | Select-String -Pattern "wintun"
pnputil /delete-driver oem<NUMMER>.inf /uninstall /force
```

---

## Logs einsehen

| OS | Pfad |
|---|---|
| Windows | `C:\ProgramData\KronSolutions\NKK-Secure-Access\logs\` |
| macOS | `~/Library/Application Support/NKK Secure Access/logs/` |
| Linux | `~/.local/share/NKK Secure Access/logs/` |

Plus die NetBird eigenen Logs:
| OS | Pfad |
|---|---|
| Windows | `C:\ProgramData\NetBird\Logs\netbird.log` |
| macOS | `/var/log/netbird.log` |
| Linux | `/var/log/netbird.log` oder via `journalctl -u netbird` |

## Eskalation

Wenn nichts hilft:
1. Diagnose Bundle aus der App kopieren
2. Letzte 100 Zeilen aus `netbird.log`
3. Screenshot der App + Screenshot vom Diagnose Panel
4. Mail an `support@ticket.kronsolutions.de` mit allem im Anhang

KronSolutions Reaktionszeit: innerhalb 4 Stunden Werktags.
