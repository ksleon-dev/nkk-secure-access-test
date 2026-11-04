#!/bin/bash
# ══════════════════════════════════════════════════════════════
# NKK API Server — Deploy vom Mac auf nkk-secure
# Ein Befehl, alles erledigt
# ══════════════════════════════════════════════════════════════
set -euo pipefail

SERVER="142.132.143.129"
USER="root"
REMOTE_DIR="/opt/kronsolutions/nkk-api"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "═══ NKK API Server Deploy auf nkk-secure ($SERVER) ═══"
echo ""

# 1. Dateien hochladen
echo "[1/3] Dateien auf Server kopieren..."
ssh $USER@$SERVER "mkdir -p $REMOTE_DIR"
scp -q "$SCRIPT_DIR/server.py" "$SCRIPT_DIR/Dockerfile" "$SCRIPT_DIR/docker-compose.yml" "$SCRIPT_DIR/deploy-debian.sh" $USER@$SERVER:$REMOTE_DIR/
echo "  ✓ 4 Dateien kopiert"

# 2. Deploy Script ausfuehren
echo "[2/3] Deployment starten..."
ssh -t $USER@$SERVER "chmod +x $REMOTE_DIR/deploy-debian.sh && bash $REMOTE_DIR/deploy-debian.sh"

# 3. Finaler Health Check
echo ""
echo "[3/3] Remote Health Check..."
sleep 2
HEALTH=$(ssh $USER@$SERVER "curl -sf http://localhost:9876/api/health" 2>/dev/null || echo "FAILED")
echo "  Health: $HEALTH"

echo ""
echo "═══ Fertig! ═══"
echo "  https://api.secure.nkk-hb.de/api/health"
