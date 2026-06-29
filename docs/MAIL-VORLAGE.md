# NKK Secure Access Mailvorlagen

## Mail 1: Download-Link (EMPFOHLEN)

**Betreff:** Euer neuer Fernzugang ist da

---

Hallo zusammen,

wir haben einen neuen, einfacheren Fernzugang fuer euch vorbereitet. Ab sofort braucht ihr nur noch eine einzige App um auf eure Terminalserver zuzugreifen.

Hier ist der Installer:

**https://api.secure.nkk-hb.de/download/NKK-Secure-Access-Setup.exe**

So geht die Einrichtung:

1. Den Link oben anklicken und die Datei speichern
2. Die heruntergeladene Datei per Doppelklick starten
3. Falls Windows eine blaue Meldung zeigt ("Der Computer wurde geschuetzt"):
   Klickt auf **"Weitere Informationen"** und dann auf **"Trotzdem ausfuehren"**. Das kommt nur beim ersten Mal.
4. Den Installer einfach durchklicken (Weiter, Weiter, Fertig)
5. Die App oeffnet sich automatisch
6. Euren Aktivierungsschluessel eingeben (kommt gleich in einer separaten Mail)
7. Auf **Terminalserver 2** klicken und wie gewohnt arbeiten

**Wichtig:** Bitte den bisherigen VPN Client vorher beenden und deaktivieren. Deinstallieren muesst ihr ihn erstmal nicht.

Im Anhang findet ihr auch eine **Anleitung.html** mit Bildern und allen Details. Einfach im Browser oeffnen.

Updates kommen in Zukunft ganz automatisch, da muesst ihr euch um nichts kuemmern.

Falls etwas nicht klappt: In der App oben rechts auf das Kopfhoerer-Symbol klicken, dann "Diagnose kopieren" und das Ganze per Mail an support@ticket.kronsolutions.de schicken.

Wir entschuldigen uns fuer die Schwierigkeiten in dieser Woche und arbeiten daran, alles so schnell wie moeglich zu optimieren. Vielen Dank fuer eure Geduld!

Viele Gruesse
Euer IT Team
KronSolutions GmbH

---

## Mail 2: Aktivierungsschluessel (separat senden!)

**Betreff:** Euer Aktivierungsschluessel fuer NKK Secure Access

---

Hallo zusammen,

hier ist euer persoenlicher Aktivierungsschluessel fuer NKK Secure Access:

**[SETUP-KEY-HIER-EINFUEGEN]**

Einfach die App oeffnen, den Schluessel reinkopieren und auf "Aktivieren" klicken. Danach braucht ihr den Schluessel nie wieder.

Falls ihr die App noch nicht installiert habt, schaut in die andere Mail mit dem Download-Link.

Viele Gruesse
Euer IT Team
KronSolutions GmbH

---

## Hinweise fuer die Verteilung

### Warum Download-Link statt ZIP?
- Windows Explorer kann passwortgeschuetzte ZIPs NICHT oeffnen (braucht 7-Zip/WinRAR)
- Mitarbeiter scheitern am Entpacken und rufen den Support an
- Ein direkter Download-Link ist einfacher: klicken, speichern, starten

### Download-Link einrichten
Die EXE kann auf dem API Server gehostet werden:
```
scp "NKK Secure Access_X.Y.Z_x64-setup.exe" root@192.168.0.50:/opt/nkk-api/downloads/
```
Dann als Download unter `https://api.secure.nkk-hb.de/download/NKK-Secure-Access-Setup.exe` erreichbar machen.

### SmartScreen Warnung
Die blaue Windows Warnung kommt weil die EXE nicht signiert ist.
Langfristige Loesung: Windows Code Signing Zertifikat (EV, ca. 200-400 EUR/Jahr).
Kurzfristig: In der Mail und Anleitung erklaeren wie man "Trotzdem ausfuehren" klickt.

### Admin-Rechte
Der Installer braucht Admin-Rechte (fuer VPN-Treiber, Windows-Dienst, Defender-Ausnahmen).
Falls der Mitarbeiter keine Admin-Rechte hat, muss jemand vom IT-Team das Passwort eingeben.
