#!/bin/bash
# ══════════════════════════════════════════════════════════════
# NKK API Server — Deployment auf nkk-secure (Debian 12)
# Ziel: api.secure.nkk-hb.de auf 142.132.143.129
# ══════════════════════════════════════════════════════════════
set -euo pipefail

# ── Farben ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }
step() { echo -e "\n${CYAN}══ $1 ══${NC}"; }

# ── Pruefen ob root ──
[[ $EUID -ne 0 ]] && err "Bitte als root ausfuehren: sudo bash deploy-debian.sh"

# ══════════════════════════════════════════════════════════════
step "1/7 — System Update & Pakete"
# ══════════════════════════════════════════════════════════════

apt-get update -qq
apt-get install -y -qq nginx certbot python3-certbot-nginx curl ufw docker.io docker-compose-plugin > /dev/null 2>&1
log "Pakete installiert (nginx, certbot, docker, ufw)"

# Docker aktivieren
systemctl enable --now docker > /dev/null 2>&1
log "Docker laeuft"

# ══════════════════════════════════════════════════════════════
step "2/7 — Verzeichnisse anlegen"
# ══════════════════════════════════════════════════════════════

mkdir -p /opt/kronsolutions/nkk-api
log "Verzeichnis /opt/kronsolutions/nkk-api erstellt"

# ══════════════════════════════════════════════════════════════
step "3/7 — API Server Dateien kopieren"
# ══════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cp "$SCRIPT_DIR/server.py" /opt/kronsolutions/nkk-api/server.py
cp "$SCRIPT_DIR/Dockerfile" /opt/kronsolutions/nkk-api/Dockerfile
cp "$SCRIPT_DIR/docker-compose.yml" /opt/kronsolutions/nkk-api/docker-compose.yml

log "server.py, Dockerfile, docker-compose.yml kopiert"

# ══════════════════════════════════════════════════════════════
step "4/7 — Docker Container bauen & starten"
# ══════════════════════════════════════════════════════════════

cd /opt/kronsolutions/nkk-api

# Falls alter Container laeuft, stoppen
docker compose down 2>/dev/null || true

docker compose up -d --build
log "NKK API Container laeuft auf Port 9876"

# Kurz warten und Health Check
sleep 3
if curl -sf http://localhost:9876/api/health > /dev/null 2>&1; then
    log "Health Check OK"
else
    warn "Health Check noch nicht erreichbar, Container startet evtl. noch..."
fi

# ══════════════════════════════════════════════════════════════
step "5/7 — Nginx Reverse Proxy"
# ══════════════════════════════════════════════════════════════

cat > /etc/nginx/sites-available/nkk-api <<'NGINX'
# NKK API Server — api.secure.nkk-hb.de
# Reverse Proxy zu Docker Container auf Port 9876

server {
    listen 80;
    server_name api.secure.nkk-hb.de;

    # Certbot ACME Challenge
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        proxy_pass http://127.0.0.1:9876;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # CORS fuer NKK Clients
        add_header Access-Control-Allow-Origin "*" always;
        add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type" always;

        if ($request_method = OPTIONS) {
            return 204;
        }
    }

    # Rate Limiting fuer Enrollment (max 10 pro Minute pro IP)
    location /api/enrollment {
        limit_req zone=enrollment burst=5 nodelay;
        proxy_pass http://127.0.0.1:9876;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX

# Rate Limit Zone in nginx.conf einfuegen (falls nicht vorhanden)
if ! grep -q "limit_req_zone.*enrollment" /etc/nginx/nginx.conf; then
    sed -i '/http {/a\    limit_req_zone $binary_remote_addr zone=enrollment:10m rate=10r/m;' /etc/nginx/nginx.conf
    log "Rate Limiting Zone in nginx.conf eingefuegt"
fi

# Aktivieren
ln -sf /etc/nginx/sites-available/nkk-api /etc/nginx/sites-enabled/nkk-api

# Default Site deaktivieren (optional)
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

# Nginx Config testen
nginx -t 2>/dev/null && log "Nginx Config OK" || err "Nginx Config fehlerhaft!"
systemctl reload nginx
log "Nginx Reverse Proxy aktiv fuer api.secure.nkk-hb.de"

# ══════════════════════════════════════════════════════════════
step "6/7 — Firewall (UFW)"
# ══════════════════════════════════════════════════════════════

# Grundregeln
ufw allow 22/tcp comment "SSH" > /dev/null 2>&1
ufw allow 80/tcp comment "HTTP (Certbot)" > /dev/null 2>&1
ufw allow 443/tcp comment "HTTPS" > /dev/null 2>&1

# NetBird Ports (falls NetBird auf gleicher VM)
ufw allow 51820/udp comment "WireGuard/NetBird" > /dev/null 2>&1
ufw allow 3478/udp comment "NetBird STUN" > /dev/null 2>&1

# Port 9876 NICHT nach aussen oeffnen (nur ueber Nginx)
ufw deny 9876/tcp comment "NKK API nur intern via Nginx" > /dev/null 2>&1

# UFW aktivieren
echo "y" | ufw enable > /dev/null 2>&1
log "Firewall konfiguriert (22, 80, 443 offen, 9876 nur lokal)"

# ══════════════════════════════════════════════════════════════
step "7/7 — Let's Encrypt SSL"
# ══════════════════════════════════════════════════════════════

echo ""
warn "WICHTIG: DNS muss ZUERST gesetzt sein!"
echo -e "  ${CYAN}api.secure.nkk-hb.de${NC} → ${CYAN}142.132.143.129${NC} (A Record)"
echo ""
read -p "DNS schon gesetzt? SSL Zertifikat jetzt holen? [j/N] " -n 1 -r
echo ""

if [[ $REPLY =~ ^[jJyY]$ ]]; then
    certbot --nginx -d api.secure.nkk-hb.de --non-interactive --agree-tos --email oliverkronhardt@icloud.com --redirect
    if [ $? -eq 0 ]; then
        log "SSL Zertifikat installiert!"
        log "Auto-Renewal aktiv (certbot timer)"
    else
        warn "Certbot fehlgeschlagen. DNS pruefen, dann manuell: certbot --nginx -d api.secure.nkk-hb.de"
    fi
else
    warn "SSL uebersprungen. Spaeter ausfuehren:"
    echo -e "  ${CYAN}certbot --nginx -d api.secure.nkk-hb.de --redirect${NC}"
fi

# ══════════════════════════════════════════════════════════════
echo ""
step "FERTIG — Zusammenfassung"
# ══════════════════════════════════════════════════════════════

echo ""
echo -e "  ${GREEN}API Server:${NC}     http://localhost:9876/api/health"
echo -e "  ${GREEN}Nginx Proxy:${NC}    https://api.secure.nkk-hb.de"
echo -e "  ${GREEN}Container:${NC}      docker compose -f /opt/kronsolutions/nkk-api/docker-compose.yml logs -f"
echo ""
echo -e "  ${CYAN}Endpoints:${NC}"
echo -e "    POST /api/enrollment   — Client Diagnostics empfangen"
echo -e "    GET  /api/enrollments  — Alle Reports auflisten"
echo -e "    GET  /api/news         — News fuer Clients"
echo -e "    POST /api/news         — News aktualisieren"
echo -e "    GET  /api/health       — Health Check"
echo ""
echo -e "  ${CYAN}Logs:${NC}  docker compose -f /opt/kronsolutions/nkk-api/docker-compose.yml logs -f"
echo -e "  ${CYAN}Data:${NC}  docker volume inspect nkk-api_nkk-data"
echo ""
log "Deployment abgeschlossen!"
