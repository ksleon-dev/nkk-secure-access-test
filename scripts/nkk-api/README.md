# NKK API Server

Micro-Service fuer NKK Secure Access Clients (Enrollment-Reports, News, Installer-Downloads).
Laeuft als Docker-Container auf **serv-secure** (192.168.0.50, Debian 12), erreichbar ueber
`api.secure.nkk-hb.de` (vorgelagerter Reverse-Proxy uebernimmt TLS; Port 9876 ist nicht direkt
von aussen offen).

## WICHTIG: `app.py` ist der Live-Code (nicht `server.py`)

Der laufende Container startet mit `gunicorn app:app`, d.h. die **einzige** produktive Datei ist
**`app.py`** (schlanke Flask-App, Listen-Format). Ein frueherer Reimplementierungs-Entwurf
`server.py` (mit Bearer-Auth, Feld-Whitelist, Einzeldatei-Rotation) wurde **verworfen**, weil er
das Enrollment-Format inkompatibel aenderte: `server.py` schrieb Einzeldateien nach
`/data/enrollments/*.json`, das Panel liest aber die **Liste** `/opt/nkk-api/data/enrollments.json`
direkt. Ein Deploy von `server.py` haette die Panel-Geraeteliste eingefroren. Darum ist er hier
entfernt. Die guten Ideen daraus (siehe git-Historie) bleiben als optionale, format-kompatible
Haertung fuer `app.py` moeglich: Enrollment-Liste pro Host kappen (Wachstum), Feld-Whitelist,
`MAX_CONTENT_LENGTH`.

## Realitaet auf serv-secure (verifiziert 2026-07-06)

- Build-Context + Live-Dateien: `/opt/nkk-api/` (`app.py`, `Dockerfile`, `sync-downloads.sh`).
- Image `nkk-api:latest`, gestartet per `docker run` mit `--restart unless-stopped`
  (KEIN docker-compose, KEIN systemd-Unit fuer den Container selbst).
- Bind-Mounts: `/opt/nkk-api/data:/data` und `/opt/nkk-api/downloads:/downloads`
  (Named-Volume wird NICHT genutzt).
- `enrollments.json` = **JSON-Liste** aller Reports (das Panel-Backend liest sie direkt).
- Downloads liegen in `/opt/nkk-api/downloads/`, werden per `sync-downloads.sh` +
  systemd-Timer `nkk-download-sync.timer` aktuell gehalten.

## Endpoints (`app.py`)

| Endpoint | Methode | Beschreibung |
|---|---|---|
| `/api/enrollment` | POST | Report der App empfangen, an `enrollments.json`-Liste anhaengen |
| `/api/enrollments` | GET | Alle Reports als Liste |
| `/api/news` | GET | News-JSON fuer die App |
| `/api/news` | POST | News-JSON setzen |
| `/api/health` | GET | Statuscheck |
| `/download/<datei>` | GET | Installer-Download (App-Auto-Update zieht hierueber) |
| `/download` | GET | Liste der verfuegbaren Downloads |

Hinweis: Das **Panel** schreibt News und liest Enrollments NICHT ueber diese HTTP-Endpunkte,
sondern direkt ueber den Datei-Bind-Mount (`/opt/nkk-api/data/{news.json,enrollments.json}`).

## Deploy (nur `app.py`/`Dockerfile` betroffen)

```bash
# app.py / Dockerfile nach /opt/nkk-api/ kopieren, dann auf serv-secure:
cd /opt/nkk-api
docker build -t nkk-api:latest .
docker rm -f nkk-api
docker run -d --name nkk-api --restart unless-stopped \
  -p 9876:9876 \
  -v /opt/nkk-api/data:/data -v /opt/nkk-api/downloads:/downloads \
  nkk-api:latest
docker logs --tail 20 nkk-api
curl -s localhost:9876/api/health
```

Die Daten (`data/`, `downloads/`) liegen als Bind-Mount auf dem Host und ueberleben den Rebuild.

## Dateien

| Datei | Beschreibung |
|---|---|
| `app.py` | **Live** Flask-API (schlank, Listen-Format) |
| `Dockerfile` | python:3.11-alpine + gunicorn, `COPY app.py`, `app:app` |
| `deploy-debian.sh` / `deploy-from-*.{sh,ps1}` | Aeltere Setup-Skripte (Stand April, ggf. veraltet) |
| `nginx-vpn.conf` | Aeltere Reverse-Proxy-Config (Referenz) |
