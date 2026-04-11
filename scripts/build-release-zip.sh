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

# Anleitung als TXT (kein PDF nötig, einfach und lesbar)
cat > "$OUTDIR/ANLEITUNG.txt" << 'EOF'
╔══════════════════════════════════════════════════════════════╗
║              NKK Secure Access — Anleitung                  ║
╚══════════════════════════════════════════════════════════════╝

INSTALLATION (einmalig, 2 Minuten)

  1. Doppelklick auf "NKK Secure Access Setup.exe"
  2. Installer durchklicken (Weiter, Weiter, Fertig)
  3. App öffnen: Startmenü → KronSolutions → NKK Secure Access
  4. Aktivierungsschlüssel eingeben (kommt in separater Mail)
  5. Auf "Aktivieren" klicken — fertig!

TÄGLICHE NUTZUNG

  • App öffnen (oder Tray Icon unten rechts klicken)
  • "Terminalserver 2" klicken → Arbeitsplatz öffnet sich
  • Das wars!

EINSTELLUNGEN

  • Zahnrad Icon oben rechts → Einstellungen
  • "Beim Anmelden starten" → App startet mit Windows (optional)

BEI PROBLEMEN

  • In der App: Headphones Icon oben rechts
  • "Diagnose für Support kopieren" klicken
  • Text per Mail schicken an: support@ticket.kronsolutions.de

══════════════════════════════════════════════════════════════
  Powered by KronSolutions GmbH
  Zukunftssicher. Technologie mit Wirkung.
══════════════════════════════════════════════════════════════
EOF

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
