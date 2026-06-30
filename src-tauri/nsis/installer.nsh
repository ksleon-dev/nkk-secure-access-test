; ===========================================================================
;  NKK Secure Access - Tauri NSIS hooks
;  KronSolutions GmbH · IT Partner für Naturkost Kontor Bremen GmbH
; ===========================================================================
;
;  Production-grade hooks injected into Tauri's NSIS template:
;
;    PRE-INSTALL:
;      1. Create logging directory under %PROGRAMDATA%\KronSolutions
;      2. Read /SETUPKEY=... from command line OR setup.conf
;      3. Add NetBird program dirs to Windows Defender exclusion list
;      4. Pause Bitdefender real-time protection (best effort, idempotent)
;
;    POST-INSTALL:
;      5. Detect existing NetBird install and skip MSI if present
;      6. Otherwise silently install bundled NetBird .exe
;      7. Wait for the netbird Windows Service, set it to AUTOMATIC start
;      8. Inject /SETUPKEY into "netbird up" if provided
;      9. Resume Bitdefender real-time protection
;
;    PRE-UNINSTALL:
;      10. netbird down - close the active tunnel
;
;    POST-UNINSTALL:
;      11. Stop and delete netbird service
;      12. Run NetBird's own NSIS uninstaller silently
;      13. Remove leftover Program Files / ProgramData / LocalAppData dirs
;      14. Wintun driver is intentionally KEPT (other WG tools may use it)
;
;  Logs: %PROGRAMDATA%\KronSolutions\NKK-Secure-Access\logs\

!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "WinVer.nsh"

!define NKK_LOG_DIR "$PROGRAMDATA\KronSolutions\NKK-Secure-Access\logs"
!define NKK_DATA_DIR "$PROGRAMDATA\KronSolutions\NKK-Secure-Access"
!define NKK_NETBIRD_BIN "$PROGRAMFILES64\NetBird\netbird.exe"
!define NKK_NETBIRD_UNINST "$PROGRAMFILES64\NetBird\Uninstall.exe"
!define NKK_MGMT_URL "https://vpn.secure.nkk-hb.de"

Var NkkSetupKey
Var NkkNetbirdInstaller
Var NkkExitCode
; Collects non-fatal problems with an ID each; shown as one photographable
; MessageBox at the end so KronSolutions sees instantly what went wrong.
Var NkkErrors

!macro NSIS_HOOK_PREINSTALL
  StrCpy $NkkErrors ""

  ; --- Require admin rights (perMachine). Clearest message if UAC was declined.
  UserInfo::GetAccountType
  Pop $0
  ${If} $0 != "Admin"
    MessageBox MB_ICONSTOP|MB_OK "Bitte den Installer mit Administratorrechten ausfuehren.$\r$\nRechtsklick auf die Datei, dann 'Als Administrator ausfuehren'.$\r$\n$\r$\nCode: ELEV$\r$\nSupport: support@ticket.kronsolutions.de"
    Abort
  ${EndIf}

  ; --- Kill any running instance first ----------------------------------------
  nsExec::ExecToLog 'taskkill /f /im "NKK Secure Access.exe"'
  Pop $NkkExitCode

  ; --- Remove old per-user installations (v0.1.x was installMode "both") ------
  ; Without this, old versions in $LOCALAPPDATA stay around forever and the
  ; Start Menu shortcut / autostart keeps launching the OLD version even after
  ; the new per-machine version is installed.
  ; IMPORTANT: Do NOT run the old uninstaller - it would delete the setup key
  ; from Windows Credential Manager. Only remove the files and registry entries.
  DetailPrint "NKK: Raeume alte per-User Installation auf ..."
  RMDir /r "$LOCALAPPDATA\NKK Secure Access"
  RMDir /r "$LOCALAPPDATA\Programs\NKK Secure Access"
  ; Remove old per-user registry entries
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\NKK Secure Access"
  ; Remove old per-user autostart
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "NKK Secure Access"
  ; Remove old Start Menu shortcuts (per-user)
  RMDir /r "$SMPROGRAMS\NKK Secure Access"
  RMDir /r "$SMPROGRAMS\KronSolutions"

  ; --- Set up data + log directory under ProgramData (per-machine, persistent) -
  CreateDirectory "${NKK_DATA_DIR}"
  CreateDirectory "${NKK_LOG_DIR}"

  ; --- Read /SETUPKEY=... from command line ---------------------------------
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/SETUPKEY=" $NkkSetupKey

  ; --- Fall back to setup.conf next to the installer EXE --------------------
  ${If} $NkkSetupKey == ""
    IfFileExists "$EXEDIR\setup.conf" 0 nkk_no_conf
      ClearErrors
      FileOpen $0 "$EXEDIR\setup.conf" r
      FileRead $0 $NkkSetupKey
      FileClose $0
    nkk_no_conf:
  ${EndIf}

  ; NOTE: Baked-in setup.conf is read in POSTINSTALL (after file extraction),
  ; not here - $INSTDIR\resources\ does not exist yet during PREINSTALL.

  ; Strip trailing whitespace / CR / LF / tabs from the key
  ${If} $NkkSetupKey != ""
    Push $NkkSetupKey
    Call NkkTrim
    Pop $NkkSetupKey
  ${EndIf}

  ; --- Add Defender exclusions for NetBird directories ----------------------
  ; Wintun driver registration triggers Defender real-time scanning which can
  ; block the NetBird MSI from finishing. Adding the install path as exclusion
  ; before triggering the install prevents that. Best effort - silent on fail.
  ; --- OS Version Check with detailed error message ----------------------------
  ; Show exact OS version so the employee can just screenshot the error.
  ${IfNot} ${AtLeastWin10}
    StrCpy $0 ""
    nsExec::ExecToStack 'cmd /c ver'
    Pop $0
    Pop $1
    MessageBox MB_ICONSTOP|MB_OK "Dein Betriebssystem wird leider nicht unterstützt.$\r$\n$\r$\nMindestvoraussetzung: Windows 10$\r$\nDein System: $1$\r$\n$\r$\nBitte mach ein Foto von dieser Meldung und schicke es an:$\r$\nsupport@ticket.kronsolutions.de$\r$\n$\r$\nWir helfen dir weiter."
    Abort
  ${EndIf}

  DetailPrint "NKK: Defender Exclusion fuer NetBird ..."
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -inputformat none -ExecutionPolicy Bypass -WindowStyle Hidden -Command "try { Add-MpPreference -ExclusionPath \"$PROGRAMFILES64\NetBird\" -ErrorAction SilentlyContinue; Add-MpPreference -ExclusionProcess \"netbird.exe\" -ErrorAction SilentlyContinue; Add-MpPreference -ExclusionProcess \"netbird-ui.exe\" -ErrorAction SilentlyContinue } catch {}"'
  Pop $NkkExitCode

  ; Verify the exclusion took. It can silently fail under tamper protection, and
  ; Defender would then quarantine the NetBird driver, surfacing only a generic
  ; [NB-INST] error. We exit 7 ONLY when Defender real-time protection is truly
  ; active and the path is still not excluded - so a passive Defender behind a
  ; third-party AV never raises a false alarm. Exit code only, no string parsing.
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -inputformat none -ExecutionPolicy Bypass -WindowStyle Hidden -Command "try { if ((Get-MpComputerStatus).RealTimeProtectionEnabled -and -not ((Get-MpPreference).ExclusionPath -contains \"$PROGRAMFILES64\NetBird\")) { exit 7 } } catch {} exit 0"'
  Pop $NkkExitCode
  ${If} $NkkExitCode == 7
    StrCpy $NkkErrors "$NkkErrors[DEF-EXCL] Defender Exclusion fuer NetBird nicht aktiv (evtl. Tamper Protection)$\r$\n"
  ${EndIf}

  ; --- Pause Bitdefender real-time protection (best effort) -----------------
  ; NKK runs Bitdefender. Stop the common consumer + GravityZone real-time
  ; services so they do not quarantine the NetBird wintun driver during install;
  ; POSTINSTALL starts them again. On a centrally managed endpoint the self
  ; protection usually refuses the stop - that is fine, this is best effort and
  ; wrapped in try/catch. If Bitdefender still blocks the driver, IT has to
  ; whitelist %PROGRAMFILES%\NetBird (netbird.exe, netbird-ui.exe, wintun) in the
  ; Bitdefender policy; there is no reliable local CLI for that.
  DetailPrint "NKK: Pausiere Bitdefender Echtzeitschutz (falls moeglich) ..."
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -inputformat none -ExecutionPolicy Bypass -WindowStyle Hidden -Command "try { foreach ($n in @(\"vsserv\",\"EPProtectedService\",\"EPSecurityService\",\"EPRedline\",\"bdredline\",\"EPIntegrationService\")) { $svc = Get-Service -Name $n -ErrorAction SilentlyContinue; if ($svc -and $svc.Status -eq \"Running\") { Stop-Service -Name $n -Force -ErrorAction SilentlyContinue } } } catch {}"'
  Pop $NkkExitCode

  ; Self-heal: if the install aborts before POSTINSTALL re-enables it, a detached
  ; helper restarts Bitdefender after 90s, so the endpoint is NEVER left
  ; unprotected. POSTINSTALL also re-enables immediately; starting an already
  ; running service is a harmless no-op.
  Exec 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-Sleep -Seconds 90; try { foreach ($n in @(\"vsserv\",\"EPProtectedService\",\"EPSecurityService\",\"EPRedline\",\"bdredline\",\"EPIntegrationService\")) { $svc = Get-Service -Name $n -ErrorAction SilentlyContinue; if ($svc -and $svc.Status -ne \"Running\") { Start-Service -Name $n -ErrorAction SilentlyContinue } } } catch {}"'
!macroend

!macro NSIS_HOOK_POSTINSTALL
  StrCpy $NkkNetbirdInstaller "$INSTDIR\resources\bin\netbird-installer.exe"

  ; --- Install VC++ Runtime if missing (VCRUNTIME140.dll) -------------------
  ; Bundled in the installer - no internet needed at customer site.
  IfFileExists "$SYSDIR\vcruntime140.dll" nkk_vcpp_ok nkk_vcpp_install
nkk_vcpp_install:
  DetailPrint "NKK: Visual C++ Runtime fehlt - installiere aus Bundle ..."
  IfFileExists "$INSTDIR\resources\bin\vc_redist.x64.exe" nkk_vcpp_run nkk_vcpp_missing
nkk_vcpp_run:
  ; Guard against a 0-byte placeholder bundle (would just error out).
  ClearErrors
  FileOpen $2 "$INSTDIR\resources\bin\vc_redist.x64.exe" r
  ${IfNot} ${Errors}
    FileSeek $2 0 END $3
    FileClose $2
  ${Else}
    StrCpy $3 0
  ${EndIf}
  ${If} $3 < 100000
    DetailPrint "NKK: vc_redist im Bundle leer/zu klein - ueberspringe."
    StrCpy $NkkErrors "$NkkErrors[VCPP] vc_redist im Bundle fehlerhaft (leer)$\r$\n"
    Goto nkk_vcpp_ok
  ${EndIf}
  nsExec::ExecToLog '"$INSTDIR\resources\bin\vc_redist.x64.exe" /install /quiet /norestart'
  Pop $NkkExitCode
  ; 0 = OK, 1638 = newer version already present, 3010 = OK but reboot needed.
  ${If} $NkkExitCode == 0
  ${OrIf} $NkkExitCode == 1638
  ${OrIf} $NkkExitCode == 3010
    DetailPrint "NKK: VC++ Runtime OK (Exit $NkkExitCode)."
    ${If} $NkkExitCode == 3010
      SetRebootFlag true
    ${EndIf}
  ${Else}
    DetailPrint "NKK: VC++ Runtime Exit $NkkExitCode."
    StrCpy $NkkErrors "$NkkErrors[VCPP] VC++ Runtime Exit $NkkExitCode$\r$\n"
  ${EndIf}
  Goto nkk_vcpp_ok
nkk_vcpp_missing:
  DetailPrint "NKK: WARNUNG - vc_redist.x64.exe nicht im Bundle gefunden."
  StrCpy $NkkErrors "$NkkErrors[VCPP] vc_redist nicht im Bundle$\r$\n"
nkk_vcpp_ok:

  ; --- Install wintun.dll if missing ----------------------------------------
  ; Bundled in the installer - no internet needed at customer site.
  IfFileExists "$SYSDIR\wintun.dll" nkk_wintun_ok nkk_wintun_install
nkk_wintun_install:
  DetailPrint "NKK: wintun.dll fehlt - kopiere aus Bundle ..."
  IfFileExists "$INSTDIR\resources\bin\wintun.dll" nkk_wintun_copy nkk_wintun_missing
nkk_wintun_copy:
  ; Guard: never drop a 0-byte placeholder into System32 - an empty wintun.dll
  ; is unloadable and would silently break the WireGuard adapter (no tunnel).
  ClearErrors
  FileOpen $2 "$INSTDIR\resources\bin\wintun.dll" r
  ${IfNot} ${Errors}
    FileSeek $2 0 END $3
    FileClose $2
  ${Else}
    StrCpy $3 0
  ${EndIf}
  ${If} $3 < 50000
    DetailPrint "NKK: wintun.dll im Bundle leer/zu klein - kopiere NICHT."
    StrCpy $NkkErrors "$NkkErrors[WTUN] wintun.dll im Bundle fehlerhaft (leer)$\r$\n"
    Goto nkk_wintun_ok
  ${EndIf}
  CopyFiles /SILENT "$INSTDIR\resources\bin\wintun.dll" "$SYSDIR\wintun.dll"
  DetailPrint "NKK: wintun.dll nach System32 kopiert."
  Goto nkk_wintun_ok
nkk_wintun_missing:
  DetailPrint "NKK: WARNUNG - wintun.dll nicht im Bundle gefunden."
nkk_wintun_ok:

  ; --- Detect existing NetBird install --------------------------------------
  IfFileExists "${NKK_NETBIRD_BIN}" nkk_netbird_already nkk_netbird_install

nkk_netbird_already:
  DetailPrint "NKK: NetBird ist bereits installiert - ueberspringe MSI."
  ; Binary da, aber evtl. kein Windows-Dienst (portables/fremdes NetBird ohne
  ; Service). Dann den Dienst nachinstallieren, damit der Tunnel als Dienst laeuft.
  nsExec::Exec 'sc.exe query netbird'
  Pop $1
  ${If} $1 != 0
    DetailPrint "NKK: NetBird-Binary ohne Dienst - installiere Windows-Dienst ..."
    nsExec::ExecToLog '"${NKK_NETBIRD_BIN}" service install'
    Pop $NkkExitCode
  ${EndIf}
  Goto nkk_netbird_done

nkk_netbird_install:
  IfFileExists "$NkkNetbirdInstaller" nkk_netbird_run nkk_netbird_missing

nkk_netbird_run:
  DetailPrint "NKK: Installiere NetBird Client (silent) ..."
  nsExec::ExecToLog '"$NkkNetbirdInstaller" /S'
  Pop $NkkExitCode
  ${If} $NkkExitCode != 0
    DetailPrint "NKK: NetBird Installer Exit Code $NkkExitCode - versuche Retry ..."
    Sleep 2000
    nsExec::ExecToLog '"$NkkNetbirdInstaller" /S'
    Pop $NkkExitCode
  ${EndIf}
  ${If} $NkkExitCode == 0
    DetailPrint "NKK: NetBird Client erfolgreich installiert."
  ${Else}
    DetailPrint "NKK: NetBird Installer Exit Code $NkkExitCode (nicht blockierend)."
    StrCpy $NkkErrors "$NkkErrors[NB-INST] NetBird Installation Exit $NkkExitCode$\r$\n"
  ${EndIf}
  ; Mark NetBird as installed BY US whenever the binary is now present after our
  ; install attempt - even if a retry reported a non-zero exit. Otherwise a
  ; successful-but-non-zero retry would leave NetBird unowned and orphaned on
  ; uninstall. This runs ONLY in the install branch, never when NetBird was
  ; already present, so a pre-existing (shared) NetBird is never claimed.
  IfFileExists "${NKK_NETBIRD_BIN}" nkk_write_owned nkk_netbird_done
nkk_write_owned:
  ClearErrors
  FileOpen $9 "${NKK_DATA_DIR}\netbird-owned.flag" w
  ${IfNot} ${Errors}
    FileWrite $9 "owned-by-nkk-secure-access"
    FileClose $9
  ${EndIf}
  Goto nkk_netbird_done

nkk_netbird_missing:
  DetailPrint "NKK: WARNUNG - kein NetBird Bundle gefunden, bitte separat installieren!"
  StrCpy $NkkErrors "$NkkErrors[NB-BUNDLE] NetBird Bundle fehlt im Installer$\r$\n"
  Goto nkk_netbird_done

nkk_netbird_done:

  ; --- Wait for the netbird service to register (poll up to 30s) ------------
  DetailPrint "NKK: Warte auf NetBird Service ..."
  StrCpy $0 0
nkk_svc_wait:
  ; nsExec::Exec pushes only the exit code (one Pop). sc query returns 0 when
  ; the service exists. (ExecToStack would push code + output = two items.)
  nsExec::Exec 'sc.exe query netbird'
  Pop $1
  ${If} $1 == 0
    Goto nkk_svc_ready
  ${EndIf}
  IntOp $0 $0 + 1
  ${If} $0 > 10
    DetailPrint "NKK: NetBird Service nicht gefunden nach 30s - fahre trotzdem fort."
    StrCpy $NkkErrors "$NkkErrors[NB-SVC] NetBird Dienst nach 30s nicht gefunden$\r$\n"
    Goto nkk_svc_ready
  ${EndIf}
  Sleep 3000
  Goto nkk_svc_wait
nkk_svc_ready:

  ; --- Force the NetBird service to start automatically on boot -------------
  ; (Required so the tunnel is up BEFORE the user logs in and our app starts.)
  ; Nur wenn der Dienst existiert - sonst FEHLER-1060-Rauschen; die App richtet
  ; ihn beim ersten Start ohnehin selbst ein.
  nsExec::Exec 'sc.exe query netbird'
  Pop $1
  ${If} $1 == 0
    DetailPrint "NKK: Setze NetBird Service auf Autostart ..."
    nsExec::ExecToLog 'sc.exe config netbird start= auto'
    Pop $NkkExitCode
    nsExec::ExecToLog 'sc.exe start netbird'
    Pop $NkkExitCode
  ${Else}
    DetailPrint "NKK: Kein NetBird-Dienst aktiv - App richtet ihn beim ersten Start ein."
  ${EndIf}

  ; --- Read baked-in setup key (now that files are extracted) ----------------
  ${If} $NkkSetupKey == ""
    IfFileExists "$INSTDIR\resources\bin\setup.conf" 0 nkk_no_baked_post
      ClearErrors
      FileOpen $0 "$INSTDIR\resources\bin\setup.conf" r
      FileRead $0 $NkkSetupKey
      FileClose $0
      ; Strip trailing whitespace
      ${If} $NkkSetupKey != ""
        Push $NkkSetupKey
        Call NkkTrim
        Pop $NkkSetupKey
      ${EndIf}
      ${If} $NkkSetupKey != ""
        DetailPrint "NKK: Baked Setup Key gefunden."
      ${EndIf}
    nkk_no_baked_post:
  ${EndIf}

  ; --- NetBird Enrollment (NUR mit Setup-Key) -------------------------------
  ; Ohne Key gibt es nichts zu enrollen (z.B. ein Auto-Update): der gesamte Block
  ; wird uebersprungen - KEIN Foreign-Check, KEINE Warnung. Das war die Ursache
  ; der NB-FOREIGN-Meldung beim Update. Der Key existiert nur bei einer echten
  ; Erstaufnahme (/SETUPKEY= oder baked setup.conf).
  ${If} $NkkSetupKey != ""
    ; Foreign-NetBird guard: wenn wir NetBird NICHT selbst installiert haben (kein
    ; owned-Flag) und das vorhandene NetBird auf einen ANDEREN Server zeigt, nicht
    ; uebernehmen (sonst wuerden wir eine fremde Verbindung kapern). "status -d"
    ; (Detail) zeigt die Management-URL zuverlaessig; der kurze "status" nicht.
    StrCpy $2 "ours"
    IfFileExists "${NKK_DATA_DIR}\netbird-owned.flag" nkk_enroll_decided 0
      nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command "try { $s = & \"${NKK_NETBIRD_BIN}\" status -d 2>$null | Out-String; if ($s -match [regex]::Escape(\"${NKK_MGMT_URL}\")) { exit 0 } else { exit 8 } } catch { exit 8 }"'
      Pop $NkkExitCode
      ${If} $NkkExitCode == 8
        StrCpy $2 "foreign"
      ${EndIf}
    nkk_enroll_decided:

    ${If} $2 == "foreign"
      ; Reine Info, KEIN Fehler und KEIN Support-Hinweis: ein fremdes NetBird
      ; lassen wir bewusst unangetastet.
      DetailPrint "NKK: Vorgefundenes NetBird mit anderem Server - bewusst nicht uebernommen."
    ${Else}
      ; Hard 45s timeout, damit ein nicht erreichbarer Server den Installer nie
      ; einfriert. Best effort - die App holt das Enrollment beim ersten Start
      ; mit eigenem Timeout nach, ein non-zero Ergebnis ist daher harmlos.
      DetailPrint "NKK: Konfiguriere NetBird mit NKK Management Server ..."
      nsExec::ExecToLog /TIMEOUT=45000 '"${NKK_NETBIRD_BIN}" up --setup-key "$NkkSetupKey" --management-url ${NKK_MGMT_URL}'
      Pop $NkkExitCode
      ${If} $NkkExitCode == 0
        DetailPrint "NKK: NetBird Enrollment erfolgreich."
      ${Else}
        DetailPrint "NKK: NetBird Enrollment Exit $NkkExitCode (nicht blockierend, App holt es nach)."
      ${EndIf}
    ${EndIf}
  ${Else}
    DetailPrint "NKK: Kein /SETUPKEY= - Update oder spaetere Aktivierung aus der App."
  ${EndIf}

  ; --- Hide the bundled NetBird UI: employees use the NKK app, not NetBird ----
  ; The NetBird SERVICE (the tunnel) stays. Only NetBird's own Start Menu /
  ; Desktop shortcuts and autostart are removed, so no NetBird icon appears and
  ; the NetBird tray UI does not launch alongside ours.
  DetailPrint "NKK: Entferne NetBird UI Verknuepfungen (Mitarbeiter nutzen NKK)."
  RMDir /r "$SMPROGRAMS\NetBird"
  RMDir /r "$SMPROGRAMS\Netbird"
  Delete "$DESKTOP\NetBird.lnk"
  Delete "$DESKTOP\Netbird.lnk"
  Delete "$SMSTARTUP\NetBird.lnk"
  Delete "$SMSTARTUP\Netbird.lnk"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Netbird"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "NetBird"
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "Netbird"
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "NetBird"
  nsExec::Exec 'taskkill /f /im netbird-ui.exe'
  Pop $NkkExitCode

  ; --- Resume Bitdefender real-time protection ------------------------------
  ; Start back any of the Bitdefender services we may have stopped in PREINSTALL.
  ; Idempotent: only services that exist and are not already running are started.
  DetailPrint "NKK: Reaktiviere Bitdefender Echtzeitschutz ..."
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -inputformat none -ExecutionPolicy Bypass -WindowStyle Hidden -Command "try { foreach ($n in @(\"vsserv\",\"EPProtectedService\",\"EPSecurityService\",\"EPRedline\",\"bdredline\",\"EPIntegrationService\")) { $svc = Get-Service -Name $n -ErrorAction SilentlyContinue; if ($svc -and $svc.Status -ne \"Running\") { Start-Service -Name $n -ErrorAction SilentlyContinue } } } catch {}"'
  Pop $NkkExitCode

  ; --- Verify WebView2 runtime (the app cannot render without it) -----------
  ; Check both the per-machine and per-user EdgeUpdate client keys.
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $0 == ""
    ReadRegStr $0 HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    DetailPrint "NKK: WebView2 Runtime fehlt."
    StrCpy $NkkErrors "$NkkErrors[WV2] WebView2 Runtime fehlt (App startet nicht)$\r$\n"
  ${Else}
    DetailPrint "NKK: WebView2 Runtime OK ($0)."
  ${EndIf}

  DetailPrint ""
  DetailPrint "================================================================"
  DetailPrint "  NKK Secure Access - Setup abgeschlossen."
  DetailPrint "  Logs: ${NKK_LOG_DIR}"
  DetailPrint "  Support: support@ticket.kronsolutions.de"
  DetailPrint "================================================================"

  ; --- Desktop-Verknuepfung zur App, damit Mitarbeiter sie direkt finden ----
  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"

  ; --- One photographable summary if anything went wrong --------------------
  ; (NSIS standard build has no LogSet, so we mirror to a file + a MessageBox.)
  ${If} $NkkErrors != ""
    ClearErrors
    FileOpen $9 "${NKK_LOG_DIR}\install-status.log" w
    ${IfNot} ${Errors}
      FileWrite $9 "NKK Secure Access Setup Hinweise$\r$\n$NkkErrors"
      FileClose $9
    ${EndIf}
    ; Bei Silent-/Passive-Install NIE eine Box - sie wuerde das Update blockieren und
    ; den Nutzer erschrecken. IfSilent (/S, Level) reicht NICHT, weil der Tauri-Updater
    ; "passive" mit /P startet (kein /S). Daher die Kommandozeile zusaetzlich auf /P
    ; pruefen. Nur bei sichtbarer manueller Erstinstallation + ECHTEM Fehler (Defender).
    ${GetParameters} $R5
    ClearErrors
    ${GetOptions} $R5 "/P" $R6
    ${IfNot} ${Errors}
      Goto nkk_skip_msgbox
    ${EndIf}
    IfSilent nkk_skip_msgbox
    MessageBox MB_ICONEXCLAMATION|MB_OK "NKK Secure Access wurde installiert, aber mit Hinweisen:$\r$\n$\r$\n$NkkErrors$\r$\nLog: ${NKK_LOG_DIR}$\r$\n$\r$\nBitte ein Foto dieser Meldung an support@ticket.kronsolutions.de"
    nkk_skip_msgbox:
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  CreateDirectory "${NKK_DATA_DIR}"
  CreateDirectory "${NKK_LOG_DIR}"

  ; During a Tauri in-place update/reinstall the installer runs this uninstaller
  ; with the standard NSIS "_?=" flag. In that case do NOT drop the tunnel - the
  ; new version takes over. Only a real, standalone uninstall closes it.
  ${GetParameters} $R9
  ClearErrors
  ${GetOptions} $R9 "_?=" $R8
  ${IfNot} ${Errors}
    DetailPrint "NKK: Update erkannt - Tunnel bleibt aktiv."
  ${Else}
    DetailPrint "NKK: Trenne aktive NetBird Verbindung ..."
    nsExec::ExecToLog '"${NKK_NETBIRD_BIN}" down'
    Pop $NkkExitCode
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; In-place update/reinstall (NSIS passes "_?="): keep NetBird, the config and
  ; the stored credentials - the new version's POSTINSTALL takes over. Without
  ; this guard every app update would tear down the tunnel and wipe the setup
  ; key. Only a real, standalone uninstall runs the full teardown below.
  ${GetParameters} $R9
  ClearErrors
  ${GetOptions} $R9 "_?=" $R8
  ${IfNot} ${Errors}
    DetailPrint "NKK: Update/Reinstall - NetBird und Konfiguration bleiben erhalten."
    Goto nkk_postuninst_done
  ${EndIf}

  ; Did WE install NetBird? Only then remove it. A NetBird that was already on
  ; the machine (shared with other WireGuard tooling) is left fully untouched.
  StrCpy $0 "0"
  IfFileExists "${NKK_DATA_DIR}\netbird-owned.flag" 0 nkk_nb_notours
    StrCpy $0 "1"
  nkk_nb_notours:

  ${If} $0 == "1"
    DetailPrint "NKK: Entferne unsere NetBird Installation ..."
    nsExec::ExecToLog 'sc.exe stop netbird'
    Pop $NkkExitCode
    IfFileExists "${NKK_NETBIRD_UNINST}" nkk_unb_found nkk_unb_skip
  nkk_unb_found:
    nsExec::ExecToLog '"${NKK_NETBIRD_UNINST}" /S'
    Pop $NkkExitCode
    Sleep 2000
  nkk_unb_skip:
    RMDir /r "$PROGRAMFILES64\NetBird"
    RMDir /r "$LOCALAPPDATA\NetBird"
    nsExec::ExecToLog 'sc.exe delete netbird'
    Pop $NkkExitCode
  ${Else}
    DetailPrint "NKK: NetBird war bereits vorhanden - bleibt erhalten."
  ${EndIf}
  ; The Defender exclusions are added in PREINSTALL for EVERY install (owned or
  ; not), so always remove them on a real uninstall - not just for our own NetBird.
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -inputformat none -ExecutionPolicy Bypass -WindowStyle Hidden -Command "try { Remove-MpPreference -ExclusionPath \"$PROGRAMFILES64\NetBird\" -ErrorAction SilentlyContinue; Remove-MpPreference -ExclusionProcess \"netbird.exe\" -ErrorAction SilentlyContinue; Remove-MpPreference -ExclusionProcess \"netbird-ui.exe\" -ErrorAction SilentlyContinue } catch {}"'
  Pop $NkkExitCode
  ; NOTE: $PROGRAMDATA\NetBird is NetBird's own config and may be shared, so it
  ; is intentionally never deleted here.

  ; Remove stored secrets from Windows Credential Manager: the keyring profiles
  ; (target contains the service name "nkk-secure-access") and the RDP creds the
  ; app injects (target "TERMSRV/<host>"). We match the NON-localized internal
  ; "target=" token, not the localized "Target:"/"Ziel:" label, so this works on
  ; German Windows too. Wrapped in try/catch so it never blocks uninstall.
  DetailPrint "NKK: Entferne gespeicherte Zugangsdaten ..."
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -inputformat none -ExecutionPolicy Bypass -WindowStyle Hidden -Command "try { cmdkey /list | ForEach-Object { if ($_ -match \"target=(\S+)\") { $t = $matches[1]; if (($t -match \"nkk-secure-access\") -or ($t -match \"TERMSRV/\")) { cmdkey /delete:$t | Out-Null } } } } catch {}"'
  Pop $NkkExitCode

  ; Remove NKK app data: ProgramData, logs, AND the Tauri roaming AppData
  ; (enrolled.flag, user-disconnected.flag, rdp.json) so a reinstall starts clean
  ; and does not falsely believe it is still enrolled.
  DetailPrint "NKK: Entferne App Daten ..."
  RMDir /r "${NKK_DATA_DIR}"
  RMDir /r "${NKK_LOG_DIR}"
  RMDir /r "$APPDATA\de.kronsolutions.nkksecureaccess"
  RMDir /r "$LOCALAPPDATA\de.kronsolutions.nkksecureaccess"

  ; Remove Start Menu + desktop shortcuts (per-user and per-machine)
  DetailPrint "NKK: Entferne Startmenu Eintraege ..."
  RMDir /r "$SMPROGRAMS\KronSolutions"
  RMDir /r "$SMPROGRAMS\NKK Secure Access"
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"

  ; Remove old per-user install leftovers + autostart
  RMDir /r "$LOCALAPPDATA\NKK Secure Access"
  RMDir /r "$LOCALAPPDATA\Programs\NKK Secure Access"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\NKK Secure Access"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "NKK Secure Access"

  ; Kill any running instance
  nsExec::ExecToLog 'taskkill /f /im "NKK Secure Access.exe"'
  Pop $NkkExitCode

  DetailPrint ""
  DetailPrint "================================================================"
  DetailPrint "  NKK Secure Access wurde vollstaendig entfernt."
  DetailPrint "================================================================"
  nkk_postuninst_done:
!macroend

Function NkkTrim
  Exch $R0
  Push $R1
NkkTrimLoop:
  StrCpy $R1 $R0 1 -1
  ${If} $R1 == "$\r"
  ${OrIf} $R1 == "$\n"
  ${OrIf} $R1 == " "
  ${OrIf} $R1 == "$\t"
    StrCpy $R0 $R0 -1
    Goto NkkTrimLoop
  ${EndIf}
  Pop $R1
  Exch $R0
FunctionEnd
