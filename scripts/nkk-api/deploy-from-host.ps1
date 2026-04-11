# ══════════════════════════════════════════════════════════════
# NKK API Server — Deploy von NKK-MULTIVM auf nkk-secure
# Ausfuehren: PowerShell als Admin auf dem Host via RDP
# ══════════════════════════════════════════════════════════════

$ErrorActionPreference = "Stop"

$Server = "142.132.143.129"
$User = "root"
$RemoteDir = "/opt/kronsolutions/nkk-api"
$LocalDir = "C:\Umbau\nkk-api"

Write-Host ""
Write-Host "═══ NKK API Server Deploy auf nkk-secure ($Server) ═══" -ForegroundColor Cyan
Write-Host ""

# ── Pruefen ob Dateien lokal vorhanden ──
if (-not (Test-Path "$LocalDir\server.py")) {
    Write-Host "[!] Dateien nicht gefunden unter $LocalDir" -ForegroundColor Yellow
    Write-Host "    Bitte zuerst die nkk-api Dateien nach $LocalDir kopieren:" -ForegroundColor Yellow
    Write-Host "    - server.py" -ForegroundColor Gray
    Write-Host "    - Dockerfile" -ForegroundColor Gray
    Write-Host "    - docker-compose.yml" -ForegroundColor Gray
    Write-Host "    - deploy-debian.sh" -ForegroundColor Gray
    Write-Host ""

    $source = Read-Host "Oder Quellpfad angeben (Enter fuer Abbruch)"
    if ([string]::IsNullOrWhiteSpace($source)) { exit 1 }
    $LocalDir = $source
}

# ── SSH Verbindung testen ──
Write-Host "[1/4] SSH Verbindung testen..." -ForegroundColor Cyan
try {
    $test = ssh -o ConnectTimeout=5 -o BatchMode=yes "$User@$Server" "echo OK" 2>&1
    if ($test -ne "OK") { throw "SSH fehlgeschlagen" }
    Write-Host "  [OK] SSH Verbindung steht" -ForegroundColor Green
} catch {
    Write-Host "  [X] SSH Verbindung fehlgeschlagen!" -ForegroundColor Red
    Write-Host "      Pruefen: ssh $User@$Server" -ForegroundColor Yellow
    Write-Host "      SSH Key auf dem Host hinterlegt?" -ForegroundColor Yellow
    exit 1
}

# ── Verzeichnis auf nkk-secure anlegen ──
Write-Host "[2/4] Remote Verzeichnis anlegen..." -ForegroundColor Cyan
ssh "$User@$Server" "mkdir -p $RemoteDir"
Write-Host "  [OK] $RemoteDir erstellt" -ForegroundColor Green

# ── Dateien hochkopieren ──
Write-Host "[3/4] Dateien auf nkk-secure kopieren..." -ForegroundColor Cyan

$files = @("server.py", "Dockerfile", "docker-compose.yml", "deploy-debian.sh")
foreach ($f in $files) {
    $path = Join-Path $LocalDir $f
    if (Test-Path $path) {
        scp -q "$path" "${User}@${Server}:${RemoteDir}/$f"
        Write-Host "  [OK] $f" -ForegroundColor Green
    } else {
        Write-Host "  [!] $f nicht gefunden, uebersprungen" -ForegroundColor Yellow
    }
}

# ── Deploy Script auf nkk-secure ausfuehren ──
Write-Host "[4/4] Deployment auf nkk-secure starten..." -ForegroundColor Cyan
Write-Host ""
ssh -t "$User@$Server" "chmod +x $RemoteDir/deploy-debian.sh && bash $RemoteDir/deploy-debian.sh"

# ── Finaler Health Check ──
Write-Host ""
Write-Host "═══ Health Check ═══" -ForegroundColor Cyan
Start-Sleep -Seconds 3

try {
    $health = ssh "$User@$Server" "curl -sf http://localhost:9876/api/health"
    Write-Host "  $health" -ForegroundColor Green
} catch {
    Write-Host "  [!] Health Check fehlgeschlagen, Container startet evtl. noch" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "═══ Fertig! ═══" -ForegroundColor Green
Write-Host "  API:  https://api.secure.nkk-hb.de/api/health" -ForegroundColor Cyan
Write-Host "  Logs: ssh $User@$Server `"docker logs -f nkk-api`"" -ForegroundColor Gray
Write-Host ""
