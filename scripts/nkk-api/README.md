# NKK API Server

Micro-Service für NKK Secure Access Clients. Läuft als Docker Container
auf der NetBird Debian 12 VM neben dem bestehenden Stack.

## Funktionen

| Endpoint | Methode | Beschreibung |
|---|---|---|
| `/api/enrollment` | POST | Enrollment Diagnostic empfangen |
| `/api/enrollments` | GET | Alle Reports als JSON Liste |
| `/api/news` | GET | News JSON für Clients |
| `/api/news` | POST | News JSON updaten (Admin) |
| `/api/health` | GET | Status Check |

## Setup auf der Debian VM

```bash
# Dateien auf die VM kopieren
scp -r scripts/nkk-api/ root@142.132.143.129:/opt/kronsolutions/nkk-api/

# Auf der VM:
ssh root@142.132.143.129
cd /opt/kronsolutions/nkk-api
docker compose up -d --build

# Firewall Port öffnen
ufw allow 9876/tcp

# Testen
curl http://localhost:9876/api/health
```

## News aktualisieren (von deinem Mac aus)

```bash
curl -X POST http://142.132.143.129:9876/api/news \
  -H "Content-Type: application/json" \
  -d '[
    {
      "id": "wartung",
      "date": "15. April 2026",
      "type": "announcement",
      "title": "Server Wartung am Samstag",
      "body": "Am 19. April ist der Server von 22-23 Uhr nicht erreichbar."
    }
  ]'
```

## Enrollments ansehen

```bash
# Alle Reports als JSON
curl http://142.132.143.129:9876/api/enrollments | python3 -m json.tool

# Oder direkt auf der VM
ls /var/lib/docker/volumes/nkk-api_nkk-data/_data/enrollments/
```

## Daten

Alles persistent im Docker Volume `nkk-data`:
- `/data/enrollments/*.json` — ein File pro Enrollment
- `/data/news.json` — aktuelle News für alle Clients
