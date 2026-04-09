; ===========================================================================
;  NKK Secure Access — Tauri NSIS hooks
;  KronSolutions GmbH · IT Partner für Naturkost Kontor Bremen GmbH
; ===========================================================================
;
;  Production-grade hooks injected into Tauri's NSIS template:
;
;    PRE-INSTALL:
;      1. Create logging directory under %PROGRAMDATA%\KronSolutions
;      2. Read /SETUPKEY=... from command line OR setup.conf
;      3. Add NetBird program dirs to Windows Defender exclusion list
;      4. Pause ESET Network Protection (best effort, idempotent)
;
;    POST-INSTALL:
;      5. Detect existing NetBird install and skip MSI if present
;      6. Otherwise silently install bundled NetBird .exe
;      7. Wait for the netbird Windows Service, set it to AUTOMATIC start
;      8. Inject /SETUPKEY into "netbird up" if provided
;      9. Resume ESET Network Protection
;
;    PRE-UNINSTALL:
;      10. netbird down — close the active tunnel
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

!define NKK_LOG_DIR "$PROGRAMDATA\KronSolutions\NKK-Secure-Access\logs"
!define NKK_DATA_DIR "$PROGRAMDATA\KronSolutions\NKK-Secure-Access"
!define NKK_NETBIRD_BIN "$PROGRAMFILES64\NetBird\netbird.exe"
!define NKK_NETBIRD_UNINST "$PROGRAMFILES64\NetBird\Uninstall.exe"
!define NKK_MGMT_URL "https://netbird.nkkhb.de:33073"

Var NkkSetupKey
Var NkkNetbirdInstaller
Var NkkExitCode

!macro NSIS_HOOK_PREINSTALL
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

  ; --- Last resort: setup.conf BAKED into the installer by CI ---------------
  ; The CI step "Bake setup key" writes the secret into src-tauri/bin/setup.conf
  ; which Tauri bundles into $INSTDIR\resources\bin\setup.conf. If the user
  ; didn't pass /SETUPKEY= and there's no file next to the EXE, we fall back
  ; to that baked-in value.
  ${If} $NkkSetupKey == ""
    IfFileExists "$INSTDIR\resources\bin\setup.conf" 0 nkk_no_baked
      ClearErrors
      FileOpen $0 "$INSTDIR\resources\bin\setup.conf" r
      FileRead $0 $NkkSetupKey
      FileClose $0
    nkk_no_baked:
  ${EndIf}

  ; Strip trailing whitespace / CR / LF / tabs from the key
  ${If} $NkkSetupKey != ""
    Push $NkkSetupKey
    Call NkkTrim
    Pop $NkkSetupKey
  ${EndIf}

  ; --- Add Defender exclusions for NetBird directories ----------------------
  ; Wintun driver registration triggers Defender real-time scanning which can
  ; block the NetBird MSI from finishing. Adding the install path as exclusion
  ; before triggering the install prevents that. Best effort — silent on fail.
  DetailPrint "NKK: Defender Exclusion fuer NetBird ..."
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "try { Add-MpPreference -ExclusionPath $\"$PROGRAMFILES64\NetBird$\" -ErrorAction SilentlyContinue; Add-MpPreference -ExclusionProcess $\"netbird.exe$\" -ErrorAction SilentlyContinue; Add-MpPreference -ExclusionProcess $\"netbird-ui.exe$\" -ErrorAction SilentlyContinue } catch {}"'
  Pop $NkkExitCode

  ; --- Pause ESET (best effort, two strategies) -----------------------------
  ; Strategy 1: official ESET ecmd CLI — works in managed environments
  ;             where the service can't be stopped manually.
  ; Strategy 2: Stop-Service ekrn — fallback for unmanaged installs.
  DetailPrint "NKK: Pausiere ESET Network Protection (falls installiert) ..."
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "try { $ecmd = Get-ChildItem -Path $\"$PROGRAMFILES\ESET$\" -Recurse -Filter $\"ecmd.exe$\" -ErrorAction SilentlyContinue | Select-Object -First 1; if ($ecmd) { & $ecmd.FullName -pauseprotection 5 } else { $svc = Get-Service -Name $\"ekrn$\" -ErrorAction SilentlyContinue; if ($svc) { Stop-Service -Name $\"ekrn$\" -Force -ErrorAction SilentlyContinue } } } catch {}"'
  Pop $NkkExitCode
!macroend

!macro NSIS_HOOK_POSTINSTALL
  StrCpy $NkkNetbirdInstaller "$INSTDIR\resources\bin\netbird-installer.exe"

  ; --- Detect existing NetBird install --------------------------------------
  IfFileExists "${NKK_NETBIRD_BIN}" nkk_netbird_already nkk_netbird_install

nkk_netbird_already:
  DetailPrint "NKK: NetBird ist bereits installiert — ueberspringe MSI."
  Goto nkk_netbird_done

nkk_netbird_install:
  IfFileExists "$NkkNetbirdInstaller" nkk_netbird_run nkk_netbird_missing

nkk_netbird_run:
  DetailPrint "NKK: Installiere NetBird Client (silent) ..."
  nsExec::ExecToLog '"$NkkNetbirdInstaller" /S'
  Pop $NkkExitCode
  ${If} $NkkExitCode != 0
    DetailPrint "NKK: NetBird Installer Exit Code $NkkExitCode — versuche Retry ..."
    Sleep 2000
    nsExec::ExecToLog '"$NkkNetbirdInstaller" /S'
    Pop $NkkExitCode
  ${EndIf}
  ${If} $NkkExitCode == 0
    DetailPrint "NKK: NetBird Client erfolgreich installiert."
  ${Else}
    DetailPrint "NKK: NetBird Installer Exit Code $NkkExitCode (nicht blockierend)."
  ${EndIf}
  Goto nkk_netbird_done

nkk_netbird_missing:
  DetailPrint "NKK: WARNUNG — kein NetBird Bundle gefunden, bitte separat installieren!"
  Goto nkk_netbird_done

nkk_netbird_done:

  ; --- Wait for the netbird service to register -----------------------------
  Sleep 3000

  ; --- Force the NetBird service to start automatically on boot -------------
  ; (Required so the tunnel is up BEFORE the user logs in and our app starts.)
  DetailPrint "NKK: Setze NetBird Service auf Autostart ..."
  nsExec::ExecToLog 'sc.exe config netbird start= auto'
  Pop $NkkExitCode
  nsExec::ExecToLog 'sc.exe start netbird'
  Pop $NkkExitCode

  ; --- Inject the setup key + management URL --------------------------------
  ${If} $NkkSetupKey != ""
    DetailPrint "NKK: Konfiguriere NetBird mit NKK Management Server ..."
    nsExec::ExecToLog '"${NKK_NETBIRD_BIN}" up --setup-key $NkkSetupKey --management-url ${NKK_MGMT_URL}'
    Pop $NkkExitCode
    ${If} $NkkExitCode == 0
      DetailPrint "NKK: NetBird Enrollment erfolgreich."
    ${Else}
      DetailPrint "NKK: NetBird Enrollment Exit Code $NkkExitCode (nicht blockierend)."
    ${EndIf}
  ${Else}
    DetailPrint "NKK: Kein /SETUPKEY= uebergeben — User aktiviert spaeter aus der App."
  ${EndIf}

  ; --- Resume ESET ----------------------------------------------------------
  ; ecmd -pauseprotection auto-resumes after the timeout, but we explicitly
  ; resume too in case the install finished faster than the pause window.
  DetailPrint "NKK: Reaktiviere ESET Network Protection ..."
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "try { $ecmd = Get-ChildItem -Path $\"$PROGRAMFILES\ESET$\" -Recurse -Filter $\"ecmd.exe$\" -ErrorAction SilentlyContinue | Select-Object -First 1; if ($ecmd) { & $ecmd.FullName -resumeprotection } else { $svc = Get-Service -Name $\"ekrn$\" -ErrorAction SilentlyContinue; if ($svc -and $svc.Status -ne $\"Running$\") { Start-Service -Name $\"ekrn$\" -ErrorAction SilentlyContinue } } } catch {}"'
  Pop $NkkExitCode

  DetailPrint ""
  DetailPrint "================================================================"
  DetailPrint "  NKK Secure Access — Setup abgeschlossen."
  DetailPrint "  Logs: ${NKK_LOG_DIR}"
  DetailPrint "  Support: support@ticket.kronsolutions.de"
  DetailPrint "================================================================"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  CreateDirectory "${NKK_DATA_DIR}"
  CreateDirectory "${NKK_LOG_DIR}"

  DetailPrint "NKK: Trenne aktive NetBird Verbindung ..."
  nsExec::ExecToLog '"${NKK_NETBIRD_BIN}" down'
  Pop $NkkExitCode
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DetailPrint "NKK: Stoppe NetBird Service ..."
  nsExec::ExecToLog 'sc.exe stop netbird'
  Pop $NkkExitCode

  ; Run NetBird's own NSIS uninstaller silently
  IfFileExists "${NKK_NETBIRD_UNINST}" nkk_unb_found nkk_unb_skip
nkk_unb_found:
  DetailPrint "NKK: Deinstalliere gebundlete NetBird Komponente ..."
  nsExec::ExecToLog '"${NKK_NETBIRD_UNINST}" /S'
  Pop $NkkExitCode
  Sleep 2000
nkk_unb_skip:

  DetailPrint "NKK: Entferne NetBird Reste ..."
  RMDir /r "$PROGRAMFILES64\NetBird"
  RMDir /r "$PROGRAMDATA\NetBird"
  RMDir /r "$LOCALAPPDATA\NetBird"

  DetailPrint "NKK: Entferne Service Eintrag (falls noch vorhanden) ..."
  nsExec::ExecToLog 'sc.exe delete netbird'
  Pop $NkkExitCode

  ; Remove the Defender exclusions we added during install
  DetailPrint "NKK: Entferne Defender Exclusions ..."
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "try { Remove-MpPreference -ExclusionPath $\"$PROGRAMFILES64\NetBird$\" -ErrorAction SilentlyContinue; Remove-MpPreference -ExclusionProcess $\"netbird.exe$\" -ErrorAction SilentlyContinue; Remove-MpPreference -ExclusionProcess $\"netbird-ui.exe$\" -ErrorAction SilentlyContinue } catch {}"'
  Pop $NkkExitCode

  DetailPrint ""
  DetailPrint "================================================================"
  DetailPrint "  NKK Secure Access wurde entfernt."
  DetailPrint "  Wintun Treiber wurde absichtlich beibehalten."
  DetailPrint "================================================================"
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
