#!/usr/bin/env bash
# =============================================================================
#  NKK Admin-Panel (Website) auf serv-secure ausrollen
# -----------------------------------------------------------------------------
#  Fuer Aenderungen am Panel selbst (KEIN App-Release noetig).
#  Nutzung:   cd admin-panel && ./deploy.sh
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"
KEY="${NKK_SSH_KEY:-$HOME/.ssh/id_ed25519}"
HOST="root@192.168.0.50"

echo "==> Panel bauen"
pnpm build

echo "==> dist nach serv-secure ausrollen (atomar)"
tar czf - -C dist . | ssh -i "$KEY" -o LogLevel=ERROR "$HOST" '
  rm -rf /opt/nkk-admin/dist.new && mkdir -p /opt/nkk-admin/dist.new &&
  tar xzf - -C /opt/nkk-admin/dist.new &&
  rm -rf /opt/nkk-admin/dist.old && mv /opt/nkk-admin/dist /opt/nkk-admin/dist.old &&
  mv /opt/nkk-admin/dist.new /opt/nkk-admin/dist && systemctl restart nkk-admin &&
  echo "    Dienst: $(systemctl is-active nkk-admin)"'
echo "OK  Panel ausgerollt — Browser einmal neu laden."
