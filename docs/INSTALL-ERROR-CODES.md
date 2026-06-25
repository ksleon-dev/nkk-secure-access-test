# Installer Fehlercodes

Der Windows-Installer bricht nicht still ab. Wenn etwas hakt, zeigt er am Ende
eine MessageBox mit einem oder mehreren Codes plus Logpfad und schreibt
`install-status.log` nach `%PROGRAMDATA%\KronSolutions\NKK-Secure-Access\logs\`.
Mitarbeiter machen einfach ein Foto der Meldung und schicken es an den Support.

| Code | Bedeutung | Erste Maßnahme |
|------|-----------|----------------|
| `ELEV` | Keine Administratorrechte (UAC abgelehnt). | Installer per Rechtsklick als Administrator starten. |
| `OS01` | Windows zu alt (vor Windows 10). | Gerät bzw. OS prüfen. Mindestens Windows 10. |
| `WV2` | WebView2 Runtime fehlt, App kann nicht starten. | Sollte mit dem Offline-Installer nicht auftreten. WebView2 manuell nachinstallieren. |
| `VCPP` | Visual C++ Runtime ließ sich nicht installieren. | `vc_redist.x64` manuell ausführen, AV-Block prüfen. |
| `NB-INST` | NetBird-Setup mit Fehlercode beendet. | AV/Defender-Block prüfen, Installer erneut ausführen. |
| `NB-BUNDLE` | NetBird-Bundle fehlt im Installer (Build-Problem). | Anderen Installer-Build verwenden. |
| `NB-SVC` | NetBird-Dienst nach 30 Sekunden nicht registriert. | Auf langsamer Hardware erneut starten, Dienst `netbird` prüfen. |
| `NB-UP` | Enrollment fehlgeschlagen (Setup Key falsch/abgelaufen oder Management nicht erreichbar). Tunnel steht nicht. | Setup Key und Erreichbarkeit des Management-Servers prüfen. |
| `WTUN` | Mitgelieferte `wintun.dll` war fehlerhaft (leer). | Installer-Build prüfen (fetch-netbird hat den Treiber nicht korrekt geholt). |

Hinweis: `[VCPP]` mit Exit-Code 3010 ist kein Fehler, sondern nur ein
ausstehender Neustart (der Installer setzt das Reboot-Flag).

Die Codes erscheinen auch im Detail-Log des Installers und in
`install-status.log`. Mehrere Codes können gleichzeitig auftreten.
