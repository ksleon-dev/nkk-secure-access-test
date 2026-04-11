# NKK API Server

Micro-Service fuer NKK Secure Access Clients. Laeuft als Docker Container
auf **nkk-secure** (Debian 12 VM, 142.132.143.129).

## Architektur

```
Client (NKK Secure Access)
    ↓ HTTPS
api.secure.nkk-hb.de (A Record → 142.132.143.129)
    ↓
Nginx Reverse Proxy (SSL Termination, Rate Limiting)
    ↓ HTTP :9876
Docker Container (Python/Flask/Gunicorn)
    ↓
Docker Volume (nkk-data) → /data/enrollments/ + /data/news.json
```

## Endpoints

| Endpoint | Methode | Beschreibung | Auth |
|---|---|---|---|
| `/api/enrollment` | POST | Enrollment Diagnostic empfangen | Keine (Rate Limited) |
| `/api/enrollments` | GET | Alle Reports als JSON Liste | Keine |
| `/api/news` | GET | News JSON fuer Clients | Keine |
| `/api/news` | POST | News JSON updaten (Admin) | Keine* |
| `/api/health` | GET | Status Check | Keine |

*TODO: API Key Auth fuer POST /api/news in Zukunft

## Schnell Deployment (vom Host via RDP)

Per RDP auf NKK-MULTIVM verbinden, PowerShell als Admin:

```powershell
# Dateien nach C:\Umbau\nkk-api\ kopieren, dann:
.\deploy-from-host.ps1
```

Das macht alles: SSH auf nkk-secure, Dateien hochladen, Docker bauen, Nginx, Firewall, SSL.

## Manuelles Setup (direkt auf nkk-secure)

```bash
ssh root@142.132.143.129
cd /opt/kronsolutions/nkk-api
chmod +x deploy-debian.sh
./deploy-debian.sh
```

## DNS Voraussetzung

Bevor SSL funktioniert, muessen diese A Records gesetzt sein:

| Domain | Typ | Wert |
|---|---|---|
| api.secure.nkk-hb.de | A | 142.132.143.129 |
| vpn.secure.nkk-hb.de | A | 142.132.143.129 |

## Dateien

| Datei | Beschreibung |
|---|---|
| `server.py` | Flask API Server (5 Endpoints) |
| `Dockerfile` | Python 3.11 slim + Gunicorn |
| `docker-compose.yml` | Container Config mit Volume |
| `deploy-debian.sh` | Komplettes Setup auf der VM (Nginx, UFW, SSL) |
| `deploy-from-host.ps1` | Ein-Befehl Deploy vom NKK-MULTIVM Host (PowerShell) |
| `deploy-from-mac.sh` | Ein-Befehl Deploy vom Mac (alternativ) |
| `nginx-vpn.conf` | Extra Nginx Config fuer vpn.secure.nkk-hb.de |

## News aktualisieren

```bash
curl -X POST https://api.secure.nkk-hb.de/api/news \
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

## Logs & Debugging

```bash
# Vom Host (PowerShell):
ssh root@142.132.143.129 "docker logs -f nkk-api"
ssh root@142.132.143.129 "ls /var/lib/docker/volumes/nkk-api_nkk-data/_data/enrollments/"
ssh root@142.132.143.129 "tail -f /var/log/nginx/access.log"

# Health Check (von ueberall):
curl https://api.secure.nkk-hb.de/api/health
```

## Sicherheit

- Port 9876 ist **nicht** von aussen erreichbar (UFW deny)
- Nginx macht SSL Termination + CORS Headers
- Rate Limiting auf `/api/enrollment`: max 10 Requests/Minute pro IP
- TODO: API Key Auth fuer Admin Endpoints (POST /api/news)
