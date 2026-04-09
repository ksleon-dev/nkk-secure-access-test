# Download the latest Netbird Windows MSI for bundling into the NKK Secure
# Access NSIS installer. Run this on Windows before `npm run tauri build`.

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$target = Join-Path $scriptDir "netbird-installer.exe"
$url = if ($env:NETBIRD_INSTALLER_URL) { $env:NETBIRD_INSTALLER_URL } else { "https://pkgs.netbird.io/windows/x64" }

Write-Host "NKK: Lade Netbird Windows Installer von $url ..."
Invoke-WebRequest -Uri $url -OutFile $target -UseBasicParsing -MaximumRedirection 5

$size = (Get-Item $target).Length
if ($size -lt 500000) {
    Write-Error "Download zu klein ($size Bytes) — vermutlich kein gültiger Installer."
    exit 1
}

$sizeMb = [math]::Round($size / 1MB, 2)
Write-Host "NKK: Netbird Installer heruntergeladen ($sizeMb MB)"
Write-Host "     -> $target"
