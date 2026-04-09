; ===========================================================================
;  NKK Secure Access — Tauri NSIS hooks
;  KronSolutions GmbH · IT Partner für Naturkost Kontor Bremen GmbH
; ===========================================================================
;
;  These macros are injected into Tauri's auto-generated NSIS template at
;  build time. They handle the setup steps that are SPECIFIC to our rollout:
;
;    1. Pause ESET Network Protection (Wintun driver interference)
;    2. Silently install the bundled NetBird Windows client
;    3. Verify the netbird service is running
;    4. Inject the optional /SETUPKEY=... command line parameter into
;       NetBird via "netbird up --setup-key <KEY> --management-url <URL>"
;    5. Resume ESET Network Protection
;    6. Log every step to %PROGRAMDATA%\KronSolutions\NKK-Secure-Access\logs\

!include "FileFunc.nsh"
!include "LogicLib.nsh"

!define NKK_LOG_DIR "$PROGRAMDATA\KronSolutions\NKK-Secure-Access\logs"
!define NKK_DATA_DIR "$PROGRAMDATA\KronSolutions\NKK-Secure-Access"
!define NKK_NETBIRD_BIN "$PROGRAMFILES64\NetBird\netbird.exe"
!define NKK_MGMT_URL "https://netbird.nkkhb.de:33073"

Var NkkSetupKey
Var NkkNetbirdInstaller
Var NkkExitCode

; Pull /SETUPKEY=... from the installer command line, fall back to setup.conf
!macro NSIS_HOOK_PREINSTALL
  CreateDirectory "${NKK_DATA_DIR}"
  CreateDirectory "${NKK_LOG_DIR}"

  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/SETUPKEY=" $NkkSetupKey

  ${If} $NkkSetupKey == ""
    IfFileExists "$EXEDIR\setup.conf" 0 +5
      ClearErrors
      FileOpen $0 "$EXEDIR\setup.conf" r
      FileRead $0 $NkkSetupKey
      FileClose $0
  ${EndIf}

  ; Strip trailing whitespace / newlines from the key
  ${If} $NkkSetupKey != ""
    Push $NkkSetupKey
    Call NkkTrim
    Pop $NkkSetupKey
  ${EndIf}

  DetailPrint "NKK: Pausiere ESET Network Protection (5 Minuten) ..."
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "try { & netsh advfirewall set allprofiles state on | Out-Null } catch {}; Start-Sleep -Milliseconds 100"'
!macroend

; After Tauri has finished installing the NKK Secure Access binary itself,
; install NetBird and apply the optional setup key.
!macro NSIS_HOOK_POSTINSTALL
  StrCpy $NkkNetbirdInstaller "$INSTDIR\resources\bin\netbird-installer.exe"

  IfFileExists "$NkkNetbirdInstaller" NkkNetbirdFound NkkNetbirdMissing

NkkNetbirdFound:
  DetailPrint "NKK: Installiere NetBird Client (silent) ..."
  nsExec::ExecToLog '"$NkkNetbirdInstaller" /S'
  Pop $NkkExitCode
  ${If} $NkkExitCode == 0
    DetailPrint "NKK: NetBird Client installiert."
  ${Else}
    DetailPrint "NKK: NetBird Installer Exit Code $NkkExitCode (nicht blockierend)."
  ${EndIf}

  ; Wait briefly for the netbird service to register
  Sleep 3000

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
    DetailPrint "NKK: Kein /SETUPKEY= übergeben — User aktiviert später aus der App heraus."
  ${EndIf}

  Goto NkkPostDone

NkkNetbirdMissing:
  DetailPrint "NKK: Kein NetBird Paket im Bundle — bitte separat installieren."
  Goto NkkPostDone

NkkPostDone:
  DetailPrint "NKK: ESET Network Protection wieder aktiv."
  DetailPrint ""
  DetailPrint "================================================================"
  DetailPrint "  NKK Secure Access — Setup abgeschlossen."
  DetailPrint "  Logs: ${NKK_LOG_DIR}"
  DetailPrint "  Support: support@kronsolutions.de"
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

  ; Find and run the NetBird uninstaller (NSIS based, in Program Files)
  IfFileExists "$PROGRAMFILES64\NetBird\Uninstall.exe" NkkNbUninstFound NkkNbUninstSkip
NkkNbUninstFound:
  DetailPrint "NKK: Deinstalliere gebundlete NetBird Komponente ..."
  nsExec::ExecToLog '"$PROGRAMFILES64\NetBird\Uninstall.exe" /S'
  Pop $NkkExitCode
  Sleep 2000
NkkNbUninstSkip:

  DetailPrint "NKK: Entferne NetBird Reste ..."
  RMDir /r "$PROGRAMFILES64\NetBird"
  RMDir /r "$PROGRAMDATA\NetBird"
  RMDir /r "$LOCALAPPDATA\NetBird"

  DetailPrint "NKK: Entferne Service Eintrag (falls noch vorhanden) ..."
  nsExec::ExecToLog 'sc.exe delete netbird'
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
