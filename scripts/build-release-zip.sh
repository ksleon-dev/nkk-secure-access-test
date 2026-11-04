#!/usr/bin/env bash
# Baut die Release ZIP für den Mitarbeiter Rollout.
# Die ZIP ist passwortgeschützt (nkk) → kein SmartScreen!
#
# Aufruf:
#   bash scripts/build-release-zip.sh /pfad/zur/setup.exe
#
# Output:
#   NKK-Secure-Access.zip (passwort: nkk)

set -euo pipefail

EXE="${1:-}"
if [ -z "$EXE" ] || [ ! -f "$EXE" ]; then
  echo "Usage: bash scripts/build-release-zip.sh /pfad/zur/setup.exe"
  exit 1
fi

OUTDIR="/tmp/nkk-release"
rm -rf "$OUTDIR"
mkdir -p "$OUTDIR"

# EXE kopieren mit sauberem Namen
cp "$EXE" "$OUTDIR/NKK Secure Access Setup.exe"

# Anleitung als HTML (schönes Brand Design, druckbar als PDF via Browser)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp "$SCRIPT_DIR/../docs/anleitung.html" "$OUTDIR/Anleitung.html"

# ZIP mit Passwort bauen
ZIPFILE="$(pwd)/NKK-Secure-Access.zip"
rm -f "$ZIPFILE"

if command -v 7z >/dev/null 2>&1; then
  7z a -p"nkk" -tzip "$ZIPFILE" "$OUTDIR/*" >/dev/null
elif command -v zip >/dev/null 2>&1; then
  cd "$OUTDIR" && zip -P "nkk" "$ZIPFILE" * && cd -
else
  echo "Fehler: weder 7z noch zip gefunden. Bitte installieren: brew install p7zip"
  exit 1
fi

SIZE=$(du -h "$ZIPFILE" | cut -f1)
echo ""
echo "✓ Release ZIP erstellt: $ZIPFILE ($SIZE)"
echo "  Passwort: nkk"
echo "  Inhalt:"
echo "    - NKK Secure Access Setup.exe"
echo "    - ANLEITUNG.txt"
echo ""
echo "  Dem Mitarbeiter schicken + Setup Key in separater Mail."

rm -rf "$OUTDIR"
