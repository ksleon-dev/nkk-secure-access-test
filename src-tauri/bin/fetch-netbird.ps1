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
if (-not (Test-Path $vcTarget)) {
    Write-Host "NKK: Lade Visual C++ Redistributable ..."
    Invoke-WebRequest -Uri "https://aka.ms/vs/17/release/vc_redist.x64.exe" -OutFile $vcTarget -UseBasicParsing
    Write-Host "NKK: VC++ Redist OK ($([math]::Round((Get-Item $vcTarget).Length / 1MB, 2)) MB)"
} else {
    Write-Host "NKK: VC++ Redist bereits vorhanden, ueberspringe."
}

# --- 3. Wintun driver (amd64) -----------------------------------------------
$wintunDll = Join-Path $scriptDir "wintun.dll"
if (-not (Test-Path $wintunDll)) {
    $wintunZip = Join-Path $scriptDir "wintun.zip"
    Write-Host "NKK: Lade Wintun Treiber ..."
    Invoke-WebRequest -Uri "https://www.wintun.net/builds/wintun-0.14.1.zip" -OutFile $wintunZip -UseBasicParsing
    $wintunDir = Join-Path $scriptDir "wintun-extract"
    Expand-Archive -Path $wintunZip -DestinationPath $wintunDir -Force
    Copy-Item (Join-Path $wintunDir "wintun\bin\amd64\wintun.dll") $wintunDll -Force
    Remove-Item $wintunZip -Force
    Remove-Item $wintunDir -Recurse -Force
    Write-Host "NKK: wintun.dll OK ($([math]::Round((Get-Item $wintunDll).Length / 1KB, 1)) KB)"
} else {
    Write-Host "NKK: wintun.dll bereits vorhanden, ueberspringe."
}

Write-Host ""
Write-Host "NKK: Alle Abhaengigkeiten bereit zum Bundeln."
