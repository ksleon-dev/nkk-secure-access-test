; NSIS hooks for NKK Secure Access installer
; Tauri injects these macros into its NSIS template at build time.

Var NetbirdExePath
Var NetbirdExitCode

!macro NSIS_HOOK_PREINSTALL
  ; no-op
!macroend

; After the main app has been installed, silently install the bundled
; Netbird Windows client so the end user does not have to do anything.
; Netbird ships as a Nullsoft Installer (.exe) — we call it with /S for silent mode.
!macro NSIS_HOOK_POSTINSTALL
  StrCpy $NetbirdExePath "$INSTDIR\resources\bin\netbird-installer.exe"

  IfFileExists "$NetbirdExePath" NetbirdFound NetbirdMissing

NetbirdFound:
  DetailPrint "NKK: Installiere Netbird Client (still, kein Neustart) ..."
  nsExec::ExecToLog '"$NetbirdExePath" /S'
  Pop $NetbirdExitCode
  ${If} $NetbirdExitCode == 0
    DetailPrint "NKK: Netbird erfolgreich installiert."
  ${Else}
    DetailPrint "NKK: Netbird Installer Exit Code $NetbirdExitCode (nicht blockierend)."
  ${EndIf}
  Goto NetbirdDone

NetbirdMissing:
  DetailPrint "NKK: Kein Netbird Paket gebundled — Mitarbeiter muss separat installieren."
  Goto NetbirdDone

NetbirdDone:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; no-op
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; no-op — intentionally leave Netbird installed so users keep their
  ; corporate VPN access if they reinstall the NKK client later.
!macroend
