# NKK Secure Access — Admin Console

> Interaktives Admin-Dashboard zum Verwalten der Flotte (Geräte, Peers, Setup-Keys,
> News, Status). Läuft auf **serv-secure**, **nur Loopback** — Zugriff ausschließlich
> per SSH-Tunnel. Stand: 2026-06-29.

## Aufrufen
- **Bequem:** Doppelklick auf `~/Desktop/NKK-Admin-Console.command` → öffnet SSH-Tunnel + Browser.
- **Manuell:**
  ```bash
  ssh -i ~/.ssh/id_ed25519 -L 8899:127.0.0.1:8899 -N root@192.168.0.50
  # dann im Browser: http://localhost:8899
  ```
- Tunnel beenden: `pkill -f '8899:127.0.0.1:8899'`

## Warum das sicher ist (Design)
- Der Dienst bindet **nur an `127.0.0.1:8899`** auf serv-secure → nicht im Netz, nicht im
  NetBird-Overlay, **nicht öffentlich**. Erreichbar einzig über einen SSH-Tunnel.
- **Der Gate ist SSH** (Key/Passwort), den nur KS-Admins haben. Kein zweites Passwort, keine
  neue Angriffsfläche, kein öffentlicher Endpoint (anders als das alte `/api/enrollments`-Leck).
- **NetBird-Token bleibt serverseitig** (`/etc/nkk-admin/netbird.token`, `chmod 600`), nie im
  Browser. Eigener Service-Account `nkk-dashboard` (nicht der geleakte Admin-PAT).
- Eigener Dienst — fasst die produktive `nkk-api` (Download/Backend) **nicht** an.

## Funktionen
| Tab | Aktion |
|---|---|
| Übersicht | KPIs, App-Versions-Verteilung, Handlungs-Callout |
| Geräte | Enrollment-Inventar (Suche): Hostname, User, OS, App-Version, Ping, Speed, IP |
| Peers | live; **Umbenennen**, **Offboarden** (löschen, Tipp-Bestätigung) |
| Setup-Keys | live; **neuen Key erstellen** (Wert einmalig), **widerrufen** |
| News-Broadcast | Meldung an alle Apps pushen (`/api/news`) |
| Status | Download-Version, Auto-Update-Kanal, Backup-Frische, Token-Lage |

Destruktive Aktionen sind hinter Bestätigung; alles mit Erfolg/Fehler-Feedback.

## Betrieb
- Dienst: `nkk-admin.service` (systemd, `Restart=always`, `enabled` → übersteht Reboot).
  - Status: `systemctl status nkk-admin` · Logs: `journalctl -u nkk-admin -f`
- Code: `/opt/nkk-admin/server.py` (stdlib-Python, keine Dependencies).
  - Quelle/Generator-Stand: `scratchpad/nkk-admin-server.py` (diese Session).
  - Ändern: Datei ersetzen → `systemctl restart nkk-admin`.
- Token rotieren: neuen Token für Service-User `nkk-dashboard` (ID `d7c4c600-…`) erzeugen,
  in `/etc/nkk-admin/netbird.token` schreiben (600), Dienst neu starten.

## Datenquellen
- Geräte: `/opt/nkk-api/data/enrollments.json` (lokal, read).
- Peers/Keys/Gruppen: NetBird-Management-API (`vpn.secure.nkk-hb.de/api`, Service-Token).
- News: `/opt/nkk-api/data/news.json` (read/write).

## Offen / Hinweise
- **DSGVO:** Enthält Mitarbeiter-Inventar (Hostnames/User/IPs) — bewusst nur intern, kein
  öffentlicher Zugang.
- Der **geleakte Admin-PAT** (`nbp_TLgl…`) sollte im NetBird-Dashboard gelöscht werden; die
  Console nutzt den eigenen Service-Token.
