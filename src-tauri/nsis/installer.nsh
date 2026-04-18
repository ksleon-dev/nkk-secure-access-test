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
!define NKK_MGMT_URL "https://vpn.secure.nkk-hb.de"

Var NkkSetupKey
Var NkkNetbirdInstaller
Var NkkExitCode

!macro NSIS_HOOK_PREINSTALL
  ; --- Kill any running instance first ----------------------------------------
  nsExec::ExecToLog 'taskkill /f /im "NKK Secure Access.exe"'
  Pop $NkkExitCode

  ; --- Remove old per-user installations (v0.1.x was installMode "both") ------
  ; Without this, old versions in $LOCALAPPDATA stay around forever and the
  ; Start Menu shortcut / autostart keeps launching the OLD version even after
  ; the new per-machine version is installed.
  ; IMPORTANT: Do NOT run the old uninstaller — it would delete the setup key
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
  ; not here — $INSTDIR\resources\ does not exist yet during PREINSTALL.

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

  ; --- Install VC++ Runtime if missing (VCRUNTIME140.dll) -------------------
  ; Bundled in the installer — no internet needed at customer site.
  IfFileExists "$SYSDIR\vcruntime140.dll" nkk_vcpp_ok nkk_vcpp_install
nkk_vcpp_install:
  DetailPrint "NKK: Visual C++ Runtime fehlt — installiere aus Bundle ..."
  IfFileExists "$INSTDIR\resources\bin\vc_redist.x64.exe" nkk_vcpp_run nkk_vcpp_missing
nkk_vcpp_run:
  nsExec::ExecToLog '"$INSTDIR\resources\bin\vc_redist.x64.exe" /install /quiet /norestart'
  Pop $NkkExitCode
  DetailPrint "NKK: VC++ Runtime Exit Code: $NkkExitCode"
  Goto nkk_vcpp_ok
nkk_vcpp_missing:
  DetailPrint "NKK: WARNUNG — vc_redist.x64.exe nicht im Bundle gefunden."
nkk_vcpp_ok:

  ; --- Install wintun.dll if missing ----------------------------------------
  ; Bundled in the installer — no internet needed at customer site.
  IfFileExists "$SYSDIR\wintun.dll" nkk_wintun_ok nkk_wintun_install
nkk_wintun_install:
  DetailPrint "NKK: wintun.dll fehlt — kopiere aus Bundle ..."
  IfFileExists "$INSTDIR\resources\bin\wintun.dll" nkk_wintun_copy nkk_wintun_missing
nkk_wintun_copy:
  CopyFiles /SILENT "$INSTDIR\resources\bin\wintun.dll" "$SYSDIR\wintun.dll"
  DetailPrint "NKK: wintun.dll nach System32 kopiert."
  Goto nkk_wintun_ok
nkk_wintun_missing:
  DetailPrint "NKK: WARNUNG — wintun.dll nicht im Bundle gefunden."
nkk_wintun_ok:

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

  ; --- Wait for the netbird service to register (poll up to 30s) ------------
  DetailPrint "NKK: Warte auf NetBird Service ..."
  StrCpy $0 0
nkk_svc_wait:
  nsExec::ExecToStack 'sc.exe query netbird'
  Pop $1
  ${If} $1 == 0
    Goto nkk_svc_ready
  ${EndIf}
  IntOp $0 $0 + 1
  ${If} $0 > 10
    DetailPrint "NKK: NetBird Service nicht gefunden nach 30s — fahre trotzdem fort."
    Goto nkk_svc_ready
  ${EndIf}
  Sleep 3000
  Goto nkk_svc_wait
nkk_svc_ready:

  ; --- Force the NetBird service to start automatically on boot -------------
  ; (Required so the tunnel is up BEFORE the user logs in and our app starts.)
  DetailPrint "NKK: Setze NetBird Service auf Autostart ..."
  nsExec::ExecToLog 'sc.exe config netbird start= auto'
  Pop $NkkExitCode
  nsExec::ExecToLog 'sc.exe start netbird'
  Pop $NkkExitCode

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

  ; Remove NKK app data (enrolled marker, logs, cached data)
  DetailPrint "NKK: Entferne App Daten ..."
  RMDir /r "${NKK_DATA_DIR}"
  RMDir /r "${NKK_LOG_DIR}"

  ; Remove Start Menu shortcuts (both per-user and per-machine)
  DetailPrint "NKK: Entferne Startmenu Eintraege ..."
  RMDir /r "$SMPROGRAMS\KronSolutions"
  RMDir /r "$SMPROGRAMS\NKK Secure Access"

  ; Remove old per-user install leftovers
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
