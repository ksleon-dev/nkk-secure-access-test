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
  # Zero-Touch via Umgebungsvariablen (der 'irm|iex'-Pfad kann keine -Parameter
  # nehmen): NKK_SETUP_KEY=<key> [NKK_PROFILE=<token>] ; irm ... | iex
  $SetupKey   = $env:NKK_SETUP_KEY
  $NkkProfile = $env:NKK_PROFILE

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
    & curl.exe -L --http1.1 --retry 10 --retry-delay 3 -C - --connect-timeout 30 -# -o $tmp $Url
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
  #    Mit NKK_SETUP_KEY wird /SETUPKEY= durchgereicht -> die NSIS enrollt NetBird
  #    direkt (Zero-Touch), sonst reine Installation (Update / spaetere Aktivierung).
  Step "Installiere NKK Secure Access. Das kann eine Minute dauern ..."
  $iArgs = @('/S')
  if ($SetupKey) { $iArgs += "/SETUPKEY=$SetupKey" }
  $p = Start-Process -FilePath $tmp -ArgumentList $iArgs -Wait -PassThru
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  if ($p.ExitCode -ne 0) {
    Bad ("Installation fehlgeschlagen (Code " + $p.ExitCode + "). Bitte erneut versuchen oder bei der IT melden: support@ticket.kronsolutions.de")
    return 3
  }
  Good "Installiert."

  # 2b) Zero-Touch-Absicherung: Setup-Key + Profil im AppData des ANGEMELDETEN
  #     Nutzers ablegen (nicht des evtl. abweichenden Admin-Kontos dieser Shell).
  #     Der Key dient als Fallback, falls das Install-Zeit-Enrollment nicht durchkam
  #     - die App holt es beim ersten Start selbst nach und migriert ihn in den
  #     Credential Manager (danach loescht sie die Klartext-Datei).
  if ($SetupKey -or $NkkProfile) {
    $ad = $env:APPDATA
    $resolved = $false
    try {
      $cu = (Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).UserName
      if ($cu) {
        $sid = (New-Object Security.Principal.NTAccount($cu)).Translate([Security.Principal.SecurityIdentifier]).Value
        $pip = (Get-ItemProperty ("HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$sid") -ErrorAction Stop).ProfileImagePath
        if ($pip -and (Test-Path (Join-Path $pip 'AppData\Roaming'))) { $ad = Join-Path $pip 'AppData\Roaming'; $resolved = $true }
      }
    } catch {}
    # Nur schreiben, wenn der interaktive Nutzer aufgeloest wurde. Sonst KEINEN
    # Klartext-Key ins Admin-/SYSTEM-Profil legen (nutzlos + unnoetig exponiert) -
    # das Install-Zeit-NSIS-'netbird up' hat ohnehin schon enrollt.
    if ($resolved) {
      $pd = Join-Path $ad 'nkk-secure-access'
      New-Item -ItemType Directory -Force -Path $pd -ErrorAction SilentlyContinue | Out-Null
      if ($NkkProfile) { Set-Content -Path (Join-Path $pd 'profile') -Value $NkkProfile -NoNewline -Encoding ascii -ErrorAction SilentlyContinue }
      if ($SetupKey)   { Set-Content -Path (Join-Path $pd 'pending-setup-key') -Value $SetupKey -NoNewline -Encoding ascii -ErrorAction SilentlyContinue }
    }
  }

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
