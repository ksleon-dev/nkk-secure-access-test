#!/bin/bash
# =============================================================================
#  NKK Secure Access - Massen-Rollout (macOS, Level "Run as: System"/root)
# -----------------------------------------------------------------------------
#  Idempotent: installiert nur wenn fehlend oder aelter; hinterlegt den Setup-Key
#  beim Konsolennutzer (~/.config/nkk-secure-access/setup-key), den die App beim
#  Start liest = Zero-Touch. <SETUP_KEY> vorab durch den Mehrfach-Key ersetzen.
#  Exit 0 = ok/aktuell/installiert+Key gesetzt, 2 = Downloadfehler, 3 = Installfehler,
#  4 = installiert, aber kein Konsolennutzer aktiv (Key ausstehend, naechster Lauf setzt ihn).
#  Hinweis: der Key erreicht beim App-Start kurz die netbird-Prozessliste (akzeptiert,
#  da Mehrfach-Key und rotierbar).
# =============================================================================
set -u
SETUP_KEY='<SETUP_KEY>'        # Mehrfach-Key, NIE loggen
MIN_VERSION='0.3.9'            # Zielversion; auf neue Release anpassen
URL='https://api.secure.nkk-hb.de/download/NKK-Secure-Access.dmg'
APP='/Applications/NKK Secure Access.app'
VOL='/Volumes/NKK Secure Access'
log(){ echo "[NKK] $1"; }      # Key NIE in $1

# 1) Version pruefen (Idempotenz)
NEED=1
if [ -d "$APP" ]; then
  V=$(/usr/bin/defaults read "$APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null)
  if [ -n "$V" ] && [ "$(printf '%s\n%s\n' "$V" "$MIN_VERSION" | sort -V | tail -1)" = "$V" ]; then
    log "Bereits aktuell (v$V), Installation uebersprungen"; NEED=0
  fi
fi

# 2) Installieren wenn noetig
if [ "$NEED" = 1 ]; then
  DMG="$(mktemp /tmp/nkk.XXXXXX).dmg"
  OK=0
  for i in 1 2 3; do
    if curl -fsSL --connect-timeout 20 --max-time 180 -o "$DMG" "$URL" \
       && [ "$(stat -f%z "$DMG" 2>/dev/null || echo 0)" -gt 1000000 ]; then OK=1; break; fi
    log "Downloadversuch $i fehlgeschlagen"; sleep $((5 * i))
  done
  [ "$OK" -ne 1 ] && { log "Download endgueltig fehlgeschlagen"; rm -f "$DMG"; exit 2; }

  hdiutil detach "$VOL" >/dev/null 2>&1 || true
  hdiutil attach "$DMG" -nobrowse -quiet || { log "Mount fehlgeschlagen"; rm -f "$DMG"; exit 3; }
  if [ ! -d "$VOL/NKK Secure Access.app" ]; then
    log "App im DMG nicht gefunden"; hdiutil detach "$VOL" >/dev/null 2>&1; rm -f "$DMG"; exit 3
  fi
  rm -rf "$APP"
  if ! /usr/bin/ditto "$VOL/NKK Secure Access.app" "$APP"; then
    log "Kopieren fehlgeschlagen"; hdiutil detach "$VOL" >/dev/null 2>&1; rm -f "$DMG"; exit 3
  fi
  hdiutil detach "$VOL" >/dev/null 2>&1 || true
  rm -f "$DMG"
  /usr/bin/xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
  log "Installiert/aktualisiert"
fi

# 3) Setup-Key beim Konsolennutzer hinterlegen (Zero-Touch)
U=$(stat -f%Su /dev/console 2>/dev/null)
if [ -n "$U" ] && [ "$U" != "root" ] && [ "$U" != "loginwindow" ]; then
  H=$(dscl . -read "/Users/$U" NFSHomeDirectory 2>/dev/null | awk '{print $2}'); [ -z "$H" ] && H="/Users/$U"
  KDIR="$H/.config/nkk-secure-access"
  mkdir -p "$KDIR"
  printf '%s' "$SETUP_KEY" > "$KDIR/setup-key"
  chmod 700 "$KDIR"; chmod 600 "$KDIR/setup-key"; chown -R "$U" "$KDIR"
  log "Setup-Key fuer $U hinterlegt"
else
  log "Kein interaktiver Konsolennutzer, Key ausstehend (naechster Lauf setzt ihn)"
  exit 4
fi
exit 0
