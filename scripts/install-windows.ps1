#Requires -Version 5.1
# =============================================================================
#  NKK Secure Access - Installation (interaktiv, im Terminal ausfuehren)
# -----------------------------------------------------------------------------
#  Gibt den Fortschritt im Terminal aus, installiert die App leise (ohne Wizard)
#  und startet sie danach. In einer PowerShell ALS ADMINISTRATOR ausfuehren.
#
#  Einzeiler (in einer Admin-PowerShell):
#     irm https://api.secure.nkk-hb.de/download/install-windows.ps1 | iex
#
#  Fuer den unbeaufsichtigten Massen-Rollout (Level "Run as: System") stattdessen
#  rollout-windows.ps1 verwenden - der startet die App bewusst NICHT (Session 0).
#
#  WICHTIG: Der gesamte Ablauf steckt in einer Funktion mit `return` statt `exit`.
#  Beim dokumentierten 'irm | iex'-Aufruf laeuft der Code im Session-Scope des
#  Nutzers - ein `exit` wuerde dort dessen PowerShell-Fenster sofort schliessen
#  und die gerade ausgegebene Fehleranleitung unlesbar machen. Exit-Codes
#  (0 = ok, 1 = keine Adminrechte, 2 = Downloadfehler, 3 = Installfehler) gibt es
#  deshalb nur beim Aufruf als Datei (powershell -File ...), fuer Automation.
# =============================================================================

function Invoke-NkkInstall {
  $ErrorActionPreference = 'Stop'
  $Url    = 'https://api.secure.nkk-hb.de/download/NKK-Secure-Access-Setup.exe'
  $AppExe = Join-Path $env:ProgramFiles 'NKK Secure Access\NKK Secure Access.exe'

  function Info($m) { Write-Host "  $m" }
  function Step($m) { Write-Host "  -> $m" -ForegroundColor Cyan }
  function Good($m) { Write-Host "  [ok] $m" -ForegroundColor Green }
  function Bad($m)  { Write-Host "  [!]  $m" -ForegroundColor Red }

  Write-Host ""
  Write-Host "  NKK Secure Access - Installation" -ForegroundColor White
  Write-Host "  ================================"

  # 0) Adminrechte pruefen - der Installer richtet Dienste ein und braucht Elevation.
  $admin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent() `
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $admin) {
    Bad "Bitte diese Installation als Administrator starten."
    Info "Rechtsklick auf 'Windows PowerShell' -> 'Als Administrator ausfuehren', dann erneut."
    return 1
  }

  # 1) Herunterladen (mit Fortschrittsanzeige im Terminal). Universell + abbruchsicher:
  #    curl.exe (schnell, Resume -C -) bevorzugt, sonst BITS, sonst Invoke-WebRequest.
  Step "Lade das Installationsprogramm herunter ..."
  $tmp = Join-Path $env:TEMP ('NKK-Setup-' + [guid]::NewGuid().ToString('N') + '.exe')
  $ok = $false
  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    & curl.exe -L --http1.1 --retry 5 --retry-all-errors --retry-delay 3 -C - --connect-timeout 30 -# -o $tmp $Url
    $ok = ($LASTEXITCODE -eq 0)
  }
  if (-not $ok) {
    try { Import-Module BitsTransfer -ErrorAction SilentlyContinue; Start-BitsTransfer -Source $Url -Destination $tmp -ErrorAction Stop; $ok = $true } catch {}
  }
  if (-not $ok) {
    try { $ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest $Url -OutFile $tmp -UseBasicParsing -ErrorAction Stop; $ok = $true } catch {}
  }
  if (-not $ok -or -not (Test-Path $tmp) -or (Get-Item $tmp).Length -lt 1MB) {
    Bad "Download fehlgeschlagen. Bitte Internetverbindung pruefen und erneut versuchen."
    return 2
  }
  Good "Heruntergeladen."

  # 2) Leise installieren (ohne Wizard) - das Feedback bleibt hier im Terminal.
  Step "Installiere NKK Secure Access. Das kann eine Minute dauern ..."
  $p = Start-Process -FilePath $tmp -ArgumentList '/S' -Wait -PassThru
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  if ($p.ExitCode -ne 0) {
    Bad ("Installation fehlgeschlagen (Code " + $p.ExitCode + "). Bitte erneut versuchen oder bei der IT melden: support@ticket.kronsolutions.de")
    return 3
  }
  Good "Installiert."

  # 3) App starten - de-elevated ueber den Explorer, damit sie als normaler Nutzer
  #    laeuft (nicht mit den Admin-Rechten dieser PowerShell).
  Step "Starte die App ..."
  if (Test-Path $AppExe) {
    Start-Process -FilePath (Join-Path $env:WINDIR 'explorer.exe') -ArgumentList "`"$AppExe`""
    Good "NKK Secure Access wurde gestartet."
  } else {
    Bad "Die App wurde installiert, aber nicht gefunden. Bitte ueber das Startmenue oeffnen."
  }

  Write-Host ""
  Good "Fertig. Bei Fragen: support@ticket.kronsolutions.de"
  Write-Host ""
  return 0
}

$nkkExit = Invoke-NkkInstall
# Nur als Datei aufgerufen einen Prozess-Exit-Code liefern (Automation). Im
# 'irm | iex'-Pfad gibt es keinen Skript-Scope - dort KEIN exit, sonst schliesst
# sich die PowerShell des Nutzers mitsamt der Fehlermeldung.
if ($MyInvocation.MyCommand.Path) { exit $nkkExit }
