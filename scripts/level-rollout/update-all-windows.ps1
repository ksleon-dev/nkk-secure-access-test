# =============================================================================
#  NKK Komplett-Rollout (Windows) - Level "Run as: System", PowerShell
# -----------------------------------------------------------------------------
#  In EINEM silenten Lauf, idempotent + best-effort:
#   1. NKK Secure Access App updaten (nur wenn aelter als die aktuelle Release)
#   2. NetBird-Client updaten (offizielles Paket, silent, nur wenn aelter)
#   3. NetBird-SSH am Client WIRKLICH scharfschalten + Tunnel hochziehen
#  Kein Setup-Key noetig (Geraet ist enrollt).
#
#  Hart erkaempfte Punkte (adversarial verifiziert):
#   - SSH greift bei laufendem Peer NUR nach `down` -> `up --allow-server-ssh`
#     (NetBird-Doku manage/peers/ssh + Issue #2816). Ein blosses `up` ist wirkungslos.
#   - Als SYSTEM (Session 0) DARF `up` keinen SSO-Browser-Login ausloesen, sonst
#     haengt der Level-Job minutenlang. Daher: vorher Login-Status pruefen,
#     KEINE --management-url erzwingen (gespeicherte Config nutzen), und `up`
#     mit hartem Timeout + Tunnel-Wiederherstellung umklammern.
#   - SSH-Flags 1:1 wie die App (--allow-server-ssh --enable-ssh-sftp
#     --ssh-jwt-cache-ttl 300) -> kein Config-Drift.
#   - Versions-Gating vermeidet Dienst-Neustart + Tunnel-Blip bei jedem Lauf.
#   - Reihenfolge App -> NetBird (App-Installer bringt evtl. gebundeltes NetBird mit).
#   - /S killt die laufende GUI-App, startet sie aber NICHT neu; sie kommt beim
#     naechsten Login via Autostart zurueck. Der VPN-Tunnel haengt am NetBird-DIENST
#     und bleibt davon unberuehrt.
#   - Die SSH-Access-Policy im NetBird-Management ist getrennt + einmalig.
# =============================================================================

$ErrorActionPreference = "Continue"
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocol]::Tls12 } catch {}
function Log($m){ Write-Host "[NKK-Rollout] $m" }

$mgmt   = "https://vpn.secure.nkk-hb.de"
$tmp    = "C:\Windows\Temp"
$nbexe  = Join-Path $env:ProgramFiles "NetBird\netbird.exe"
$appUrl = "https://api.secure.nkk-hb.de/download/NKK-Secure-Access-Setup.exe"
$nbUrl  = "https://pkgs.netbird.io/windows/x64"   # offizieller NSIS-Installer, silent /S
$latestJson = "https://github.com/ksleon-dev/nkk-secure-access-test/releases/latest/download/latest.json"

# --- Helper: robuster Download (curl.exe -> BITS -> Invoke-WebRequest) -------
# Gehaertet wie install-windows.ps1: KEIN Resume (-C -), KEIN --retry-all-errors
# (kennt altes Win10-curl nicht -> sofortiger Fehlschlag), --fail + --proto =https,
# und ein exakter Content-Length-Abgleich als Integritaetspruefung (faengt auch einen
# verkuerzten BITS/IWR-Fallback). Server ohne Content-Length -> nur 1-MB-Untergrenze.
function Get-File($url, $out) {
  Remove-Item $out -Force -ErrorAction SilentlyContinue
  $expected = 0
  try { $expected = [int64]((Invoke-WebRequest -Uri $url -Method Head -UseBasicParsing -ErrorAction Stop).Headers['Content-Length']) } catch {}
  function Test-Ok { (Test-Path $out) -and ((Get-Item $out).Length -gt 1MB) -and ($expected -le 0 -or (Get-Item $out).Length -eq $expected) }
  $curl = Join-Path $env:WINDIR "System32\curl.exe"
  if (Test-Path $curl) {
    & $curl -L --fail --proto =https --retry 5 --retry-delay 2 --connect-timeout 30 -o $out $url 2>$null
    if (($LASTEXITCODE -eq 0) -and (Test-Ok)) { return $true }
  }
  try { Start-BitsTransfer -Source $url -Destination $out -ErrorAction Stop
        if (Test-Ok) { return $true } } catch {}
  try { Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing -ErrorAction Stop
        if (Test-Ok) { return $true } } catch {}
  Remove-Item $out -Force -ErrorAction SilentlyContinue
  return $false
}

# --- Helper: hoechste DisplayVersion aus allen Uninstall-Hives ---------------
function Get-InstalledVersion($namePattern) {
  $hives = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )
  $best = $null
  foreach ($h in $hives) {
    Get-ItemProperty $h -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -like $namePattern -and $_.DisplayVersion } |
      ForEach-Object { $v = $_.DisplayVersion -as [version]; if ($v -and (-not $best -or $v -gt $best)) { $best = $v } }
  }
  return $best
}

# --- 1) NKK Secure Access App updaten (Ziel = aktuelle Release, dynamisch) ---
$appTarget = $null
try { $appTarget = [version]((Invoke-RestMethod $latestJson -UseBasicParsing).version) } catch {}
$appCur = Get-InstalledVersion "NKK Secure Access*"
if ($appTarget -and $appCur -and $appCur -ge $appTarget) {
  Log "1/3 App schon aktuell ($appCur)"
} else {
  Log ("1/3 App-Update (installiert: {0}, Ziel: {1}) ..." -f "$appCur","$appTarget")
  $o = Join-Path $tmp "nkk-app.exe"
  if (Get-File $appUrl $o) {
    Start-Process -FilePath $o -ArgumentList "/S" -Wait
    Remove-Item $o -Force -ErrorAction SilentlyContinue
    Log "1/3 App-Update ausgefuehrt"
  } else { Log "1/3 App-Download fehlgeschlagen (best-effort, weiter)" }
}

# --- 2) NetBird-Client updaten (offizielles Paket, silent, versions-gegated) -
$nbLatest = $null
$curl = Join-Path $env:WINDIR "System32\curl.exe"
if (Test-Path $curl) {
  $hdr = & $curl -sI -L --max-redirs 5 $nbUrl 2>$null | Out-String
  if ($hdr -match 'netbird_installer_([0-9]+\.[0-9]+\.[0-9]+)') { try { $nbLatest = [version]$Matches[1] } catch {} }
}
$nbCur = Get-InstalledVersion "NetBird*"
if ($nbCur -and $nbLatest -and $nbCur -ge $nbLatest) {
  Log "2/3 NetBird schon aktuell ($nbCur)"
} else {
  Log ("2/3 NetBird-Update (installiert: {0}, verfuegbar: {1}) ..." -f "$nbCur","$nbLatest")
  $o = Join-Path $tmp "nkk-nb.exe"
  if (Get-File $nbUrl $o) {
    Start-Process -FilePath $o -ArgumentList "/S" -Wait
    Remove-Item $o -Force -ErrorAction SilentlyContinue
    Log "2/3 NetBird-Update ausgefuehrt"
  } else { Log "2/3 NetBird-Download fehlgeschlagen (best-effort, weiter)" }
}

# --- 3) NetBird-SSH scharfschalten + verbinden (silent, KEIN SSO als SYSTEM) -
Log "3/3 NetBird-SSH aktivieren ..."
if (-not (Test-Path $nbexe)) {
  Log "3/3 netbird.exe nicht gefunden - App holt SSH beim naechsten User-Connect nach"
} else {
  # Auf Daemon-Bereitschaft warten (nach evtl. NetBird-Neustart), dann Login pruefen.
  $needsLogin = $true
  for ($i=0; $i -lt 10; $i++) {
    try {
      $st = & $nbexe status --json 2>$null | ConvertFrom-Json
      if ($st) {
        $mgmtConnected = $false
        if ($st.management -and $st.management.connected) { $mgmtConnected = $true }
        if ($st.PSObject.Properties.Name -contains 'managementState' -and $st.managementState -eq 'Connected') { $mgmtConnected = $true }
        if ($mgmtConnected) { $needsLogin = $false; break }
      }
    } catch {}
    Start-Sleep -Seconds 1
  }

  if ($needsLogin) {
    Log "3/3 Peer nicht eingeloggt - kein SSO als SYSTEM moeglich; SSH wird beim naechsten App-Connect gesetzt."
  } else {
    # SSH-Flag greift bei laufendem Peer NUR ueber down -> up (#2816). Login ist
    # gecached (oben geprueft) -> up reconnektet ohne Browser.
    & $nbexe down 2>$null
    Start-Sleep -Seconds 2
    $nbArgs = @("up","--allow-server-ssh","--enable-ssh-sftp","--ssh-jwt-cache-ttl","300")
    $ok = $false
    try {
      $p = Start-Process -FilePath $nbexe -ArgumentList $nbArgs -PassThru -WindowStyle Hidden
      if ($p.WaitForExit(90000)) { $ok = $true; Log ("3/3 'netbird up' beendet (ExitCode {0})" -f $p.ExitCode) }
      else { try { $p.Kill() } catch {}; Log "3/3 'netbird up' Timeout (90s) - abgebrochen" }
    } catch { Log "3/3 'netbird up' Fehler: $($_.Exception.Message)" }
    # Sicherheitsnetz: falls das SSH-up haengen blieb, Tunnel mit schlichtem up wiederherstellen.
    if (-not $ok) { try { Start-Process -FilePath $nbexe -ArgumentList "up" -WindowStyle Hidden } catch {} }
  }
}

Log "Fertig: App + NetBird geprueft/aktualisiert; SSH am Client (sofern eingeloggt) scharf. Hinweis: SSH-Access-Policy im NetBird-Management einmalig separat setzen."
