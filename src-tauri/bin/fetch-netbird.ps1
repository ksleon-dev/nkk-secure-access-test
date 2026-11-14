# Download NetBird installer + required dependencies for bundling into the
# NKK Secure Access NSIS installer.
# Run this on Windows (CI or local) before `npm run tauri build`.

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

# --- 1. NetBird installer (architecture-aware) ------------------------------
$nbTarget = Join-Path $scriptDir "netbird-installer.exe"
# Pick the build for the target architecture so Windows on ARM gets a native
# NetBird instead of an emulated x64 one. Override with NETBIRD_ARCH (x64|arm64)
# in the ARM64 CI job, or NETBIRD_INSTALLER_URL for a full custom URL (wins).
$nbArch = if ($env:NETBIRD_ARCH) { $env:NETBIRD_ARCH }
          elseif ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" }
          else { "x64" }
# NetBird fest auf die Fassung von 0.3.31: ein Release der Altapp hebt NetBird nie ungeplant (fuer arm64 gibt es dort keinen Installer).
$nbFassung = "0.74.3"
$nbSha256 = "D8C6D22E0F702400420B8DA79EFB05DA6485A50B0BE4E9693F94F65A43BB3BEA"
$nbFest = (-not $env:NETBIRD_INSTALLER_URL) -and ($nbArch -eq "x64")
$nbUrl = if ($env:NETBIRD_INSTALLER_URL) { $env:NETBIRD_INSTALLER_URL }
         elseif ($nbFest) { "https://github.com/netbirdio/netbird/releases/download/v$nbFassung/netbird_installer_${nbFassung}_windows_amd64.exe" }
         else { "https://pkgs.netbird.io/windows/$nbArch" }

Write-Host "NKK: Lade NetBird Windows Installer von $nbUrl ..."
Invoke-WebRequest -Uri $nbUrl -OutFile $nbTarget -UseBasicParsing -MaximumRedirection 5

if ($nbFest) {
    $nbHash = (Get-FileHash $nbTarget -Algorithm SHA256).Hash
    if ($nbHash -ne $nbSha256) { Write-Error "NetBird $nbFassung mit fremder Pruefsumme $nbHash."; exit 1 }
    Write-Host "NKK: NetBird $nbFassung, Pruefsumme stimmt"
}
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
