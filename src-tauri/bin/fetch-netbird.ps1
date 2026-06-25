# Download NetBird installer + required dependencies for bundling into the
# NKK Secure Access NSIS installer.
# Run this on Windows (CI or local) before `npm run tauri build`.

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

# --- 1. NetBird installer ---------------------------------------------------
$nbTarget = Join-Path $scriptDir "netbird-installer.exe"
$nbUrl = if ($env:NETBIRD_INSTALLER_URL) { $env:NETBIRD_INSTALLER_URL } else { "https://pkgs.netbird.io/windows/x64" }

Write-Host "NKK: Lade NetBird Windows Installer von $nbUrl ..."
Invoke-WebRequest -Uri $nbUrl -OutFile $nbTarget -UseBasicParsing -MaximumRedirection 5

$nbSize = (Get-Item $nbTarget).Length
if ($nbSize -lt 500000) {
    Write-Error "NetBird Download zu klein ($nbSize Bytes)."
    exit 1
}
Write-Host "NKK: NetBird Installer OK ($([math]::Round($nbSize / 1MB, 2)) MB)"

# --- 2. Visual C++ Redistributable (x64) ------------------------------------
$vcTarget = Join-Path $scriptDir "vc_redist.x64.exe"
# Size-aware: the repo ships a 0-byte git placeholder, so Test-Path alone would
# skip the download and bundle an empty file. Re-download if missing OR too small.
if (-not (Test-Path $vcTarget) -or (Get-Item $vcTarget).Length -lt 1000000) {
    Write-Host "NKK: Lade Visual C++ Redistributable ..."
    Invoke-WebRequest -Uri "https://aka.ms/vs/17/release/vc_redist.x64.exe" -OutFile $vcTarget -UseBasicParsing
    $vcSize = (Get-Item $vcTarget).Length
    if ($vcSize -lt 1000000) {
        Write-Error "VC++ Redist zu klein ($vcSize Bytes) — Download fehlgeschlagen."
        exit 1
    }
    Write-Host "NKK: VC++ Redist OK ($([math]::Round($vcSize / 1MB, 2)) MB)"
} else {
    Write-Host "NKK: VC++ Redist bereits vorhanden, ueberspringe."
}

# --- 3. Wintun driver (amd64) -----------------------------------------------
$wintunDll = Join-Path $scriptDir "wintun.dll"
# Size-aware (see VC++ note): a 0-byte wintun.dll copied to System32 would
# silently break the WireGuard adapter. Re-download if missing OR too small.
if (-not (Test-Path $wintunDll) -or (Get-Item $wintunDll).Length -lt 100000) {
    $wintunZip = Join-Path $scriptDir "wintun.zip"
    Write-Host "NKK: Lade Wintun Treiber ..."
    Invoke-WebRequest -Uri "https://www.wintun.net/builds/wintun-0.14.1.zip" -OutFile $wintunZip -UseBasicParsing
    $wintunDir = Join-Path $scriptDir "wintun-extract"
    Expand-Archive -Path $wintunZip -DestinationPath $wintunDir -Force
    Copy-Item (Join-Path $wintunDir "wintun\bin\amd64\wintun.dll") $wintunDll -Force
    Remove-Item $wintunZip -Force
    Remove-Item $wintunDir -Recurse -Force
    $wintunSize = (Get-Item $wintunDll).Length
    if ($wintunSize -lt 100000) {
        Write-Error "wintun.dll zu klein ($wintunSize Bytes) — Download fehlgeschlagen."
        exit 1
    }
    Write-Host "NKK: wintun.dll OK ($([math]::Round($wintunSize / 1KB, 1)) KB)"
} else {
    Write-Host "NKK: wintun.dll bereits vorhanden, ueberspringe."
}

Write-Host ""
Write-Host "NKK: Alle Abhaengigkeiten bereit zum Bundeln."
