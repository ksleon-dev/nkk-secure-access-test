#!/bin/bash
# =============================================================================
#  NKK Secure Access - Massen-Rollout (macOS, Level "Run as: System"/root)
# -----------------------------------------------------------------------------
#  Duenner Wrapper auf das EINE gehaertete, gegengepruefte und serverseitig
#  gehostete Install/Update-Skript (scripts/macos-install.sh). So gibt es genau
#  eine macOS-Quelle = kein Drift, und Level zieht automatisch immer die aktuelle
#  Fassung (Bugfixes ohne Skript-Neuverteilung).
#
#  Eigenschaften des Skripts: idempotent (NKK_MIN_VERSION ueberspringt aktuelle
#  Installationen), selbstheilend (alter/kaputter Stand wird komplett ersetzt),
#  Gatekeeper entschaerft (xattr + Ad-hoc-Signatur), Universal (Intel + Apple
#  Silicon), und legt den Setup-Key beim Konsolennutzer ab = Zero-Touch.
#
#  Vor dem Anlegen in Level: <SETUP_KEY> durch den Mehrfach-Key ersetzen und
#  MIN_VERSION auf das gewuenschte Ziel-Release setzen.
# =============================================================================
export NKK_SETUP_KEY='<SETUP_KEY>'     # Mehrfach-Key (reusable), NIE loggen
export NKK_MIN_VERSION='0.3.15'        # Zielversion; auf neues Release anpassen
bash -c "$(curl -fsSL 'https://api.secure.nkk-hb.de/download/macos-install.sh')"
