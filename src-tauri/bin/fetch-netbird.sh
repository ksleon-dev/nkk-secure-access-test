#!/usr/bin/env bash
# Download the latest Netbird Windows MSI so the NSIS bundler can embed it
# into the NKK Secure Access installer.
#
# Run this once before building on Windows:
#   bash src-tauri/bin/fetch-netbird.sh
#
# On GitHub Actions this is triggered automatically in the workflow.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="$SCRIPT_DIR/netbird-installer.exe"

# Netbird publishes the x64 Windows client (NSIS .exe self-installer) here.
URL="${NETBIRD_INSTALLER_URL:-https://pkgs.netbird.io/windows/x64}"

echo "NKK: Lade Netbird Windows Installer von $URL ..."
if command -v curl >/dev/null 2>&1; then
  curl -fL --retry 3 --retry-delay 2 -o "$TARGET" "$URL"
elif command -v wget >/dev/null 2>&1; then
  wget -q -O "$TARGET" "$URL"
else
  echo "Fehler: weder curl noch wget gefunden." >&2
  exit 1
fi

SIZE=$(stat -f%z "$TARGET" 2>/dev/null || stat -c%s "$TARGET" 2>/dev/null || echo 0)
if [ "$SIZE" -lt 500000 ]; then
  echo "Fehler: Download ist zu klein ($SIZE Bytes) — vermutlich kein gültiger Installer." >&2
  exit 1
fi

echo "NKK: Netbird Installer heruntergeladen ($(numfmt --to=iec-i --suffix=B "$SIZE" 2>/dev/null || echo "${SIZE} Bytes"))"
echo "     → $TARGET"
