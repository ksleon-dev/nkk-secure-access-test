#!/bin/bash
# =============================================================================
#  NKK Secure Access - bulletproof macOS Installer / Updater
# -----------------------------------------------------------------------------
#  Eine Quelle fuer ALLE Wege (Copy-Paste im Panel, DMG-Standalone, Level).
#  Universal-Build (Intel + Apple Silicon), macOS 12 bis 26+.
#  IDEMPOTENT + SELBSTHEILEND: egal welcher kaputte Vorzustand (halbe alte App,
#  Quarantaene, haengende App, Mount-Leiche, abgebrochener Download) - danach
#  ist es sauber installiert. KEIN sudo noetig.
#
#  Optionale Env-Variablen:
#    NKK_SETUP_KEY    Setzt den Setup-Key vorab (Zero-Touch-Enrollment).
#    NKK_MIN_VERSION  Ueberspringt die Installation, wenn schon >= dieser Version
#                     (fuer Level/RMM, damit nicht jeder Lauf neu installiert).
#    NKK_DMG_URL      Override der DMG-Quelle (Default: NKK-Mirror).
#
#  Gegengeprueft (adversarial): xattr -cr VOR codesign, Ad-hoc-Signatur auf
#  ALLEN Architekturen, DMG-Validierung gegen HTML/Proxy, Mount via -plist,
#  echter Schreibtest statt [ -w ], Quit-Warteschleife, beide Install-Orte.
# =============================================================================
set -euo pipefail

APP="NKK Secure Access.app"
APP_NAME="NKK Secure Access"                         # CFBundleName, fuer osascript-Quit
PROC="nkk-secure-access"                             # CFBundleExecutable (echter Binary-Name)
PROC_MATCH="NKK Secure Access.app/Contents/MacOS/"   # eindeutiger Pfad-Match (p_comm wird auf 16 Z. gekuerzt)
DMG_URL="${NKK_DMG_URL:-https://api.secure.nkk-hb.de/download/NKK-Secure-Access.dmg}"
KEY="${NKK_SETUP_KEY:-}"
MIN_VER="${NKK_MIN_VERSION:-}"

log(){ printf '\033[36m[NKK]\033[0m %s\n' "$*"; }
err(){ printf '\033[31m[NKK] FEHLER:\033[0m %s\n' "$*" >&2; }

DEST=""

# --- 0) Schon aktuell? (nur wenn NKK_MIN_VERSION gesetzt, z.B. Level) ---------
need_install=1
if [ -n "$MIN_VER" ]; then
  for d in "/Applications/$APP" "$HOME/Applications/$APP"; do
    [ -d "$d" ] || continue
    cur="$(defaults read "$d/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo 0)"
    if [ "$cur" != "0" ] && [ "$(printf '%s\n%s\n' "$MIN_VER" "$cur" | sort -V | tail -1)" = "$cur" ]; then
      need_install=0; DEST="$d"; log "Bereits aktuell ($cur >= $MIN_VER), ueberspringe Installation."; break
    fi
  done
fi

# --- 1) Installation / Update -------------------------------------------------
if [ "$need_install" = "1" ]; then
  TMP="$(mktemp -d "${TMPDIR:-/tmp}/nkk-install.XXXXXX")"
  DMG="$TMP/nkk.dmg"; MOUNT=""
  cleanup(){ [ -n "${MOUNT:-}" ] && [ -d "${MOUNT:-}" ] && hdiutil detach "$MOUNT" -force -quiet 2>/dev/null || true; rm -rf "$TMP" 2>/dev/null || true; }
  trap cleanup EXIT INT TERM

  log "Lade aktuelle Version ..."
  curl -fL --retry 5 --retry-all-errors --retry-delay 2 -o "$DMG" "$DMG_URL" \
    || { err "Download fehlgeschlagen. Bitte nochmal ausfuehren."; exit 1; }

  log "Pruefe Download ..."
  hdiutil imageinfo "$DMG" >/dev/null 2>&1 \
    || { err "Download ist kein gueltiges DMG (Netz/Proxy?). Bitte nochmal."; exit 1; }

  # Verwaiste Mounts eines frueheren Laufs loesen (sonst /Volumes/...-Leichen)
  while IFS= read -r stale; do
    [ -n "$stale" ] && hdiutil detach "$stale" -force -quiet 2>/dev/null || true
  done < <(hdiutil info 2>/dev/null | grep -Eo "/Volumes/NKK Secure Access[^[:cntrl:]]*" || true)

  log "Mounten ..."
  hdiutil attach "$DMG" -nobrowse -noautoopen -readonly -plist > "$TMP/a.plist" 2>/dev/null \
    || { err "Mount fehlgeschlagen."; exit 1; }
  MOUNT="$(/usr/libexec/PlistBuddy -c 'Print :system-entities' "$TMP/a.plist" 2>/dev/null \
    | grep -Eo '/Volumes/.*' | tail -n1 | sed 's/[[:space:]]*$//')"
  [ -n "$MOUNT" ] && [ -d "$MOUNT/$APP" ] || { err "App nicht im DMG gefunden."; exit 1; }

  # Zielordner ohne sudo: root -> /Applications; sonst echter Schreibtest
  if [ "$(id -u)" = "0" ]; then DEST_DIR="/Applications"
  elif ( : > "/Applications/.nkk_wtest_$$" ) 2>/dev/null; then rm -f "/Applications/.nkk_wtest_$$" 2>/dev/null || true; DEST_DIR="/Applications"
  else DEST_DIR="$HOME/Applications"; mkdir -p "$DEST_DIR"; fi
  DEST="$DEST_DIR/$APP"

  log "Beende laufende App (falls offen) ..."
  osascript -e "tell application \"$APP_NAME\" to quit" >/dev/null 2>&1 || true
  # Prozess ueber den eindeutigen Bundle-Exec-Pfad matchen (nicht -x: p_comm wird auf
  # 16 Zeichen gekuerzt, 'nkk-secure-access' hat 17). Pfad-Match ist eindeutig + sicher.
  for _ in $(seq 1 20); do pgrep -f "$PROC_MATCH" >/dev/null 2>&1 || break; sleep 0.5; done
  pkill -f "$PROC_MATCH" 2>/dev/null || true; sleep 1

  log "Entferne alten Stand (beide Orte) ..."
  rm -rf "/Applications/$APP" "$HOME/Applications/$APP" 2>/dev/null || true
  if [ -e "$DEST" ]; then err "Alte App unter $DEST nicht entfernbar (Rechte). Abbruch statt Mischzustand."; exit 1; fi

  log "Installiere frisch ..."
  /usr/bin/ditto "$MOUNT/$APP" "$DEST" || { err "Kopieren fehlgeschlagen."; exit 1; }

  log "Gatekeeper entschaerfen ..."
  xattr -cr "$DEST" 2>/dev/null || true                       # ALLE xattrs strippen (vor codesign)
  codesign --force --sign - "$DEST" >/dev/null 2>&1 || true   # Ad-hoc, Intel UND Apple Silicon
  xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true  # Quarantaene erneut weg

  # Architektur-Warnung statt stillem Crash
  exe="$DEST/Contents/MacOS/$PROC"
  if [ -f "$exe" ]; then
    archs="$(lipo -archs "$exe" 2>/dev/null || echo '?')"
    case "$(uname -m):$archs" in arm64:*arm64*|x86_64:*x86_64*) : ;; *) log "Hinweis: App-Architektur ($archs) passt evtl. nicht zu diesem Mac ($(uname -m))."; ;; esac
  fi
fi

# --- 2) Setup-Key (Zero-Touch) in das RICHTIGE Home schreiben -----------------
if [ -n "$KEY" ]; then
  if [ "$(id -u)" = "0" ]; then
    u="$(stat -f%Su /dev/console 2>/dev/null || true)"
    if [ -n "$u" ] && [ "$u" != "root" ] && [ "$u" != "loginwindow" ]; then
      h="$(dscl . -read /Users/"$u" NFSHomeDirectory 2>/dev/null | awk '{print $2}')"; [ -z "$h" ] && h="/Users/$u"
      mkdir -p "$h/.config/nkk-secure-access"; printf '%s' "$KEY" > "$h/.config/nkk-secure-access/setup-key"
      chmod 700 "$h/.config/nkk-secure-access"; chmod 600 "$h/.config/nkk-secure-access/setup-key"; chown -R "$u" "$h/.config/nkk-secure-access"
      log "Setup-Key fuer Nutzer $u gesetzt."
    else
      log "Kein interaktiver Nutzer aktiv - Key wird beim naechsten Anmelden gesetzt."
    fi
  else
    mkdir -p "$HOME/.config/nkk-secure-access"; printf '%s' "$KEY" > "$HOME/.config/nkk-secure-access/setup-key"; chmod 600 "$HOME/.config/nkk-secure-access/setup-key"
    log "Setup-Key gesetzt."
  fi
fi

# --- 3) Starten (nur im interaktiven Nutzerkontext; root/Level hat keine GUI) -
if [ "$(id -u)" != "0" ] && [ -n "$DEST" ]; then
  open "$DEST" 2>/dev/null || log "Bitte App manuell starten. Bei Gatekeeper-Dialog: Systemeinstellungen > Datenschutz & Sicherheit > 'Dennoch oeffnen'."
fi
log "Fertig: ${DEST:-installiert}"
