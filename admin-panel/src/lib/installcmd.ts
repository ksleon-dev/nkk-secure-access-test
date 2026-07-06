// Bulletproof + universeller Windows-Download+Install-Befehl.
// Schlau: bevorzugt curl.exe (schnell, Resume mit -C -), faellt auf BITS
// (Start-BitsTransfer, auf JEDEM Windows ab 7, resumebar) und zuletzt auf
// Invoke-WebRequest (mit SilentlyContinue, damit es nicht lahm ist) zurueck.
// Laeuft also nicht nur auf modernem Windows. Installiert nur bei Erfolg.
// installArgs z.B. '"/S"' oder '"/S","/SETUPKEY=abc"'. indent fuer Einbettung
// in einen if-Block (Level-Skript).
// Bulletproof + universeller macOS-Install/Update-Einzeiler. Laedt das EINE
// serverseitig gehostete, gegengepruefte Skript (scripts/macos-install.sh) und
// fuehrt es aus: immer aktuell, idempotent (install ODER update), selbstheilend
// (alter/kaputter Stand wird komplett ersetzt), Gatekeeper entschaerft (xattr +
// Ad-hoc-Signatur), laeuft auf JEDEM Mac (Intel + Apple Silicon, macOS 12-26+).
// Eine einzige Quelle -> kein Drift. Mit setupKey = Zero-Touch.
// Form `bash -c "$(curl ...)"`: schlaegt der Download fehl, bleibt es ein No-Op
// (keine Teilausfuehrung), statt halb durchzulaufen.
const MAC_INSTALL_URL = "https://api.secure.nkk-hb.de/download/macos-install.sh"
export function macInstallCmd(opts?: { setupKey?: string; minVersion?: string; dmgUrl?: string; profile?: string }): string {
  const env: string[] = []
  if (opts?.setupKey) env.push(`NKK_SETUP_KEY='${opts.setupKey}'`)
  if (opts?.profile) env.push(`NKK_PROFILE='${opts.profile}'`)
  if (opts?.minVersion) env.push(`NKK_MIN_VERSION='${opts.minVersion}'`)
  // Backend-aufgeloeste DMG-URL durchreichen (Mirror mit GitHub-Fallback), sonst
  // nimmt das Skript seinen eingebauten Default.
  if (opts?.dmgUrl) env.push(`NKK_DMG_URL='${opts.dmgUrl}'`)
  const prefix = env.length ? env.join(" ") + " " : ""
  return `${prefix}bash -c "$(curl -fsSL '${MAC_INSTALL_URL}')"`
}

// Bulletproof Windows-Komplett-Rollout fuer das Level-Terminal (Run as System):
// laedt das EINE gehostete, gegengepruefte Skript (update-all-windows.ps1) und
// fuehrt es aus -> App updaten + NetBird-Client updaten + NetBird-SSH scharf.
// Maximal robust: TLS1.2 erzwingen (aelteres Windows), per Invoke-WebRequest laden
// (keine curl.exe-Abhaengigkeit), mit ExecutionPolicy-Bypass starten (umgeht
// Policy + MOTW). Eine Quelle = kein Drift; Skript-Verbesserungen wirken sofort.
const WIN_ROLLOUT_URL = "https://api.secure.nkk-hb.de/download/update-all-windows.ps1"
export function winRolloutCmd(): string {
  return `[Net.ServicePointManager]::SecurityProtocol=3072;$f="$env:TEMP\\nkk-rollout.ps1";iwr '${WIN_ROLLOUT_URL}' -OutFile $f -UseBasicParsing;powershell -ExecutionPolicy Bypass -NoProfile -File $f`
}

export function winInstallCmd(
  url: string,
  installArgs: string,
  opts?: { progress?: boolean; indent?: string; launch?: boolean; profile?: string },
): string {
  const i = opts?.indent ?? ""
  const p = opts?.progress ? " -#" : ""
  // Nach erfolgreicher Installation die App starten (nur interaktiv sinnvoll -
  // NICHT im Level/SYSTEM-Kontext, dort landet ein GUI in Session 0 und ist
  // unsichtbar). explorer.exe startet sie de-eskaliert im normalen Benutzer.
  const launch = opts?.launch
    ? ` $app=Join-Path $env:ProgramFiles 'NKK Secure Access\\NKK Secure Access.exe'; if(Test-Path $app){ Start-Process explorer.exe $app; Write-Host '-> App wird gestartet.' -ForegroundColor Green }else{ Write-Host '-> App installiert, bitte ueber das Startmenue oeffnen.' -ForegroundColor Yellow }`
    : ""
  // Install-Zeit-Profil: die Rolle in eine Datei legen, die die App beim ersten
  // Start einmalig liest. Im Benutzerkontext (%APPDATA%), passt also genau zum
  // angemeldeten Nutzer. Wird VOR dem App-Start geschrieben.
  const profileWrite = opts?.profile
    ? ` $pd="$env:APPDATA\\nkk-secure-access"; New-Item -ItemType Directory -Force -Path $pd | Out-Null; Set-Content -Path "$pd\\profile" -Value '${opts.profile}' -NoNewline -Encoding ascii; Write-Host "-> Profil '${opts.profile}' gesetzt." -ForegroundColor Green;`
    : ""
  return [
    `$u="${url}"; $o="$env:TEMP\\nkk-setup.exe"; Remove-Item $o -EA SilentlyContinue; $ok=$false`,
    `Write-Host "NKK Secure Access - Download laeuft ..." -ForegroundColor Cyan`,
    `if(Get-Command curl.exe -EA SilentlyContinue){ curl.exe -L --http1.1 --retry 5 --retry-all-errors -C - --connect-timeout 30${p} -o $o $u; $ok=($LASTEXITCODE -eq 0) }`,
    `if(-not $ok){ try{ Import-Module BitsTransfer -EA SilentlyContinue; Start-BitsTransfer -Source $u -Destination $o -EA Stop; $ok=$true }catch{} }`,
    `if(-not $ok){ try{ $ProgressPreference='SilentlyContinue'; Invoke-WebRequest $u -OutFile $o -UseBasicParsing; $ok=$true }catch{} }`,
    `if($ok){ Write-Host "Installiere (kann einen Moment dauern) ..." -ForegroundColor Cyan; $rc=(Start-Process $o -ArgumentList ${installArgs} -Wait -PassThru).ExitCode; if($rc -eq 0){ Write-Host "-> Fertig installiert." -ForegroundColor Green;${profileWrite}${launch} }else{ Write-Host ("-> Installer meldete Fehler (Code "+$rc+") - bitte nochmal ausfuehren.") -ForegroundColor Red } }else{ Write-Host "-> Download fehlgeschlagen - bitte nochmal ausfuehren." -ForegroundColor Red }`,
  ]
    .map((l) => i + l)
    .join("\n")
}
