#!/usr/bin/env bash
# =============================================================================
#  NKK Secure Access — neues App-Release veroeffentlichen
# -----------------------------------------------------------------------------
#  EIN Befehl. Danach baut + signiert + veroeffentlicht die CI automatisch,
#  und alle Clients ziehen das Update von selbst (Auto-Update). Nichts weiter.
#
#  Nutzung:
#     ./release.sh 0.3.10 "Kurz: was ist neu in dieser Version"
#
#  Beispiel:
#     ./release.sh 0.3.10 "Schnellerer Verbindungsaufbau und kleinere Fixes"
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"

VER="${1:-}"
NOTE="${2:-Wartung und Verbesserungen.}"
if [[ ! "$VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Nutzung: ./release.sh <version x.y.z> \"<was ist neu>\""
  echo "Beispiel: ./release.sh 0.3.10 \"Schnellerer Verbindungsaufbau\""
  exit 1
fi
DATE=$(date +%Y-%m-%d)
echo "==> Release v$VER  ($DATE)"

# 1) Version in den 3 Manifesten setzen (CI erzwingt Gleichstand)
echo "  - Version setzen (package.json, tauri.conf.json, Cargo.toml)"
sed -i.bak -E "s/\"version\": \"[0-9]+\.[0-9]+\.[0-9]+\"/\"version\": \"$VER\"/" package.json src-tauri/tauri.conf.json
sed -i.bak -E "s/^version = \"[0-9]+\.[0-9]+\.[0-9]+\"/version = \"$VER\"/" src-tauri/Cargo.toml
rm -f package.json.bak src-tauri/tauri.conf.json.bak src-tauri/Cargo.toml.bak

# 2) CHANGELOG-Eintrag unter [Unreleased] einfuegen + Panel-Kopie syncen
echo "  - CHANGELOG-Eintrag einfuegen"
awk -v ver="$VER" -v date="$DATE" -v note="$NOTE" '
  /^## \[Unreleased\]/ && !d { print; print ""; print "## [" ver "] - " date; print ""; print "- " note; d=1; next } { print }
' CHANGELOG.md > CHANGELOG.md.tmp && mv CHANGELOG.md.tmp CHANGELOG.md
cp CHANGELOG.md admin-panel/src/data/changelog.md 2>/dev/null || true

# 3) Lokal pruefen (faengt Tippfehler ab, bevor die CI laeuft)
echo "  - Frontend bauen (tsc + vite)"
npm run build >/dev/null
for f in package.json src-tauri/tauri.conf.json; do
  grep -q "\"version\": \"$VER\"" "$f" || { echo "FEHLER: $f nicht gebumpt"; exit 1; }
done
grep -q "^version = \"$VER\"" src-tauri/Cargo.toml || { echo "FEHLER: Cargo.toml nicht gebumpt"; exit 1; }

# 4) Commit + Tag + Push  ->  loest die Release-CI aus
# WICHTIG: git add -A (nicht nur die Versions-Dateien!). Frueher wurden nur
# package.json/Cargo.toml/tauri.conf.json committet, der eigentliche Quellcode
# blieb uncommitted -> die CI baute aus altem Stand mit neuer Versionsnummer und
# die Fixes kamen nie beim Client an. .gitignore schuetzt Secrets (*.key, .env)
# und Artefakte (node_modules, dist, target), -A ist daher sicher.
echo "  - Commit + Tag + Push (kompletter Arbeitsstand)"
git add -A
git commit -q -m "release: v$VER — $NOTE"
git tag "v$VER"
git push -q origin main
git push -q origin "v$VER"

echo
echo "OK  v$VER ist getaggt + gepusht."
echo "    Die CI baut + signiert + veroeffentlicht jetzt (~8-10 Min)."
echo "    Status:   gh run watch --repo ksleon-dev/nkk-secure-access-test"
echo "    Danach ziehen alle Clients das Update automatisch."
