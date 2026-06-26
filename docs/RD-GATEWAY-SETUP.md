# RD Gateway - der NetBird-freie Zweitweg zu TS2

Ziel: Der Geschäftsführer (und nur der) bekommt in der App eine zweite Kachel
"Terminalserver 2 (Direktzugang)", die **ohne NetBird/VPN** funktioniert. Falls
die VPN-Schicht einmal klemmt, ist die Leitung trotzdem nie ausgesperrt.

Technik: Ein RD Gateway nimmt RDP über **HTTPS auf Port 443** entgegen (immer
offen, durch jede Firewall) und reicht es intern an TS2 weiter. Es wird **kein
RDP offen ins Internet gestellt**, alles ist TLS-verschlüsselt und authentifiziert.

Die App-Seite ist bereits fertig. Sobald das Gateway steht, fehlt nur **ein
Eintrag in `branding.json`** (Schritt 4), dann erscheint die Kachel automatisch
beim Geschäftsführer-Profil.

---

## Voraussetzungen

- Ein Windows Server (z. B. einer der Terminalserver oder ein kleiner separater),
  der TS2 intern erreicht.
- Ein öffentlicher DNS-Name, z. B. `gw.nkk-hb.de`, der auf eine öffentliche IP
  zeigt (eine vorhandene Hetzner-Public-IP mit DNAT 443 -> Gateway-Server).
- Ein gültiges TLS-Zertifikat für genau diesen Namen (Let's Encrypt oder das
  vorhandene Wildcard `*.nkk-hb.de`). **Kein Self-Signed** - sonst meckert mstsc.

## Schritt 1 - Rolle installieren

```powershell
Install-WindowsFeature RDS-Gateway -IncludeManagementTools
```

Das zieht IIS + NPS automatisch mit. Danach gibt es die Konsole
"Remotedesktopgateway-Manager" (`tsgateway.msc`).

## Schritt 2 - Zertifikat binden

Im RD-Gateway-Manager -> Server-Rechtsklick -> Eigenschaften -> Reiter
"SSL-Zertifikat" -> vorhandenes Zertifikat für `gw.nkk-hb.de` importieren/auswählen.
Der Zertifikatsname muss exakt dem DNS-Namen entsprechen, den der Client nutzt.

## Schritt 3 - Wer darf was (CAP + RAP)

Zwei Richtlinien legen fest, **wer** sich verbinden darf und **wohin**.

- **CAP (Connection Authorization Policy)** - wer:
  - "Richtlinien" -> "Verbindungsautorisierungsrichtlinien" -> Neu.
  - Mitgliedschaft auf eine AD-Gruppe begrenzen, z. B. `RDG-Geschaeftsfuehrung`
    (lege diese Gruppe an und nimm nur den GF-Account auf).
  - Authentifizierung: Passwort. Gerät-Umleitungen nach Bedarf erlauben.
- **RAP (Resource Authorization Policy)** - wohin:
  - "Ressourcenautorisierungsrichtlinien" -> Neu.
  - Gleiche Gruppe `RDG-Geschaeftsfuehrung`.
  - Erlaubte Computer: **nur TS2** (eine eigene AD-Gruppe `RDG-Ziel-TS2` mit nur
    TS2 drin, statt "alle Computer" - so bleibt der Zugang minimal).
  - Erlaubte Ports: nur 3389.

> Prinzip der minimalen Rechte: eine Person (GF), ein Ziel (TS2), ein Port (3389).

## Schritt 4 - Firewall / DNAT

- Hetzner/Edge: öffentliche IP, **TCP 443 -> Gateway-Server** (DNAT).
- Auf dem Gateway-Server: eingehend TCP 443 erlauben.
- TS2: muss vom Gateway-Server intern auf 3389 erreichbar sein (ist es im LAN
  ohnehin).
- **Wichtig:** Port 3389 niemals direkt aus dem Internet auf TS2 freigeben. Nur
  443 auf das Gateway.

## Schritt 5 - App scharfschalten

In `resources/branding.json` unter `quickLaunch` diesen Eintrag ergänzen
(Reihenfolge egal). `target` = interne Adresse von TS2 wie bei der bestehenden
TS2-Kachel, `gateway` = der öffentliche Gateway-Name:

```json
{
  "label": "Terminalserver 2 (Direktzugang)",
  "type": "rdp",
  "target": "<interne TS2-Adresse, identisch zur normalen TS2-Kachel>",
  "description": "Ohne VPN, über gesichertes Gateway",
  "role": "manager",
  "gateway": "gw.nkk-hb.de"
}
```

Was die App damit automatisch tut:
- Die Kachel sieht **nur** das Geschäftsführer-Profil (`role: "manager"`).
- Die erzeugte `.rdp` bekommt die Gateway-Direktiven
  (`gatewayhostname`, `gatewayusagemethod:i:1`, ...), mstsc verbindet sich also
  über 443 zum Gateway und von dort zu TS2.
- Der sonst übliche **VPN-Reconnect wird für diese Kachel übersprungen** - der
  Weg ist bewusst NetBird-frei.

## Schritt 6 - Test

1. Auf einem Client **NetBird/VPN trennen** (oder einen Rechner ganz ohne NetBird
   nehmen).
2. App im Geschäftsführer-Profil öffnen -> "Terminalserver 2 (Direktzugang)".
3. mstsc fragt nach den Zugangsdaten, verbindet über das Gateway, TS2 erscheint.
4. Gegenprobe: ohne Gateway-Eintrag (normale TS2-Kachel) und ohne VPN darf TS2
   **nicht** erreichbar sein - so ist bewiesen, dass wirklich der Gateway-Weg griff.

---

## Warum diese Lösung

- **Sicher:** TLS auf 443, AD-authentifiziert, minimaler RAP (nur GF -> nur TS2),
  kein offenes RDP im Internet.
- **Einfach:** eine Standard-Windows-Rolle, einmal eingerichtet, wartungsarm
  (nur Zertifikatsverlängerung beachten).
- **Perfekt für den Fall:** der GF bleibt im gewohnten Ablauf (App-Kachel ->
  mstsc), kein zweiter VPN-Client, keine zweite App, keine geänderte Bedienung.
