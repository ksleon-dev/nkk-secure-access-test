# =============================================================================
#  NKK Secure Access - Massen-Rollout (Windows, Level "Run as: System")
# -----------------------------------------------------------------------------
#  Idempotent: installiert nur wenn fehlend oder aelter, enrollt per /SETUPKEY
#  (der NSIS-Installer ruft dann selbst "netbird up --setup-key"). Danach eine
#  eigene Enrollment-Selbstheilung, falls der einmalige Versuch fehlschlug.
#  <SETUP_KEY> vor dem Einfuegen in Level durch den Mehrfach-Key ersetzen.
#  Exit 0 = ok/aktuell/installiert, 2 = Downloadfehler, 3 = Installfehler.
#  Hinweis: der Key ist waehrend "netbird up" kurz in der Prozessliste sichtbar
#  (akzeptiert, da Mehrfach-Key und rotierbar).
# =============================================================================
$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$SetupKey   = '<SETUP_KEY>'   # Mehrfach-Key, NIE loggen
$MinVersion = '0.3.9'         # Zielversion (>= gilt als aktuell); auf neue Release anpassen
$Url        = 'https://api.secure.nkk-hb.de/download/NKK-Secure-Access-Setup.exe'
$MgmtUrl    = 'https://vpn.secure.nkk-hb.de'
$UninstKey  = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\NKK Secure Access'
$NetBird    = Join-Path $env:ProgramFiles 'NetBird\netbird.exe'
function Log($m){ Write-Output ("[NKK] " + $m) }   # Key NIE in $m

# 1) Version pruefen - Install nur wenn fehlend oder aelter
$cv = ((Get-ItemProperty $UninstKey -ErrorAction SilentlyContinue).DisplayVersion) -as [version]
if ($cv -and $cv -ge [version]$MinVersion) {
  Log "Bereits aktuell (v$cv), Install uebersprungen"
} else {
  # 2) Download mit dem eingebauten curl.exe (schnell; Invoke-WebRequest ist fuer
  #    grosse Dateien notorisch lahm wegen der Fortschrittsanzeige).
  $tmp = Join-Path $env:TEMP ('NKK-Setup-' + [guid]::NewGuid().ToString('N') + '.exe')
  # Universell + abbruchsicher: curl.exe (schnell, Resume -C -) bevorzugt, sonst BITS
  # (alle Windows ab 7, resumebar), sonst Invoke-WebRequest. Laeuft also nicht nur auf
  # modernem Windows. HTTP/1.1 stabil fuer grosse Dateien, kein hartes Gesamt-Timeout.
  $ok = $false
  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    & curl.exe -L --http1.1 --retry 5 --retry-all-errors --retry-delay 5 -C - --connect-timeout 30 -sS -o $tmp $Url
    $ok = ($LASTEXITCODE -eq 0)
  }
  if (-not $ok) { try { Import-Module BitsTransfer -ErrorAction SilentlyContinue; Start-BitsTransfer -Source $Url -Destination $tmp -ErrorAction Stop; $ok = $true } catch {} }
  if (-not $ok) { try { $ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest $Url -OutFile $tmp -UseBasicParsing -ErrorAction Stop; $ok = $true } catch {} }
  if (-not $ok -or -not (Test-Path $tmp) -or (Get-Item $tmp).Length -lt 1MB) {
    Log "Download fehlgeschlagen"; exit 2
  }

  # 3) Silent-Install + Enrollment (NSIS /S /SETUPKEY=)
  try {
    $p = Start-Process -FilePath $tmp -ArgumentList '/S', ('/SETUPKEY=' + $SetupKey) -Wait -PassThru
    Log "Installer ExitCode $($p.ExitCode)"
  } catch { Log "Install-Start fehlgeschlagen: $($_.Exception.Message)"; Remove-Item $tmp -Force -ErrorAction SilentlyContinue; exit 3 }
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue

  $now = (Get-ItemProperty $UninstKey -ErrorAction SilentlyContinue).DisplayVersion
  if (-not $now) { Log "Kein Registry-Eintrag nach Install, unsicher"; exit 3 }
  Log "Installiert/aktualisiert auf v$now"
}

# 4) Enrollment-Selbstheilung: netbird up nachziehen, falls der einmalige
#    Versuch des Installers fehlschlug (Mgmt-Timeout, AV, Netz spaet). Idempotent.
if (Test-Path $NetBird) {
  for ($j = 0; $j -lt 3; $j++) {
    if ((& $NetBird status 2>$null) -match 'Management:\s*Connected') { Log "NetBird verbunden"; break }
    Log "Enrollment-Versuch $($j + 1)"
    & $NetBird up --setup-key $SetupKey --management-url $MgmtUrl 2>$null
    Start-Sleep -Seconds 6
  }
} else {
  Log "netbird.exe nicht gefunden, Enrollment uebernimmt die App beim Start"
}
exit 0
