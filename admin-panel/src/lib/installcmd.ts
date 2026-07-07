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
  opts?: { progress?: boolean; indent?: string; launch?: boolean; profile?: string; setupKey?: string },
): string {
  const i = opts?.indent ?? ""
  const p = opts?.progress ? " -#" : ""
  // Nach erfolgreicher Installation die App starten (nur interaktiv sinnvoll -
  // NICHT im Level/SYSTEM-Kontext, dort landet ein GUI in Session 0 und ist
  // unsichtbar). explorer.exe startet sie de-eskaliert im normalen Benutzer.
  const launch = opts?.launch
    ? ` $app=Join-Path $env:ProgramFiles 'NKK Secure Access\\NKK Secure Access.exe'; if(Test-Path $app){ Start-Process explorer.exe $app; Write-Host '-> App wird gestartet.' -ForegroundColor Green }else{ Write-Host '-> App installiert, bitte ueber das Startmenue oeffnen.' -ForegroundColor Yellow }`
    : ""
  // F7/F5: %APPDATA% des ELEVATED-Shells ist bei "als Admin ausfuehren" das des Admin-
  // Kontos, NICHT des angemeldeten Nutzers (der die App spaeter startet). Darum den
  // interaktiven Konsolen-Nutzer aufloesen und dessen Roaming-AppData nehmen. Laesst
  // er sich NICHT aufloesen ($resolved bleibt false), wird NICHTS geschrieben - kein
  // Klartext-Key ins Admin-/SYSTEM-Profil (dort nutzlos + exponiert); das Install-Zeit-
  // NSIS-'netbird up' hat ohnehin schon enrollt. $pd wird von Profil + Key geteilt.
  const needPd = opts?.profile || opts?.setupKey
  const pdSetup = needPd
    ? ` $ad=$env:APPDATA; $resolved=$false; try{ $cu=(Get-CimInstance Win32_ComputerSystem -EA Stop).UserName; if($cu){ $sid=(New-Object Security.Principal.NTAccount($cu)).Translate([Security.Principal.SecurityIdentifier]).Value; $pip=(Get-ItemProperty ("HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\ProfileList\\"+$sid) -EA Stop).ProfileImagePath; if($pip -and (Test-Path (Join-Path $pip 'AppData\\Roaming'))){ $ad=Join-Path $pip 'AppData\\Roaming'; $resolved=$true } } }catch{}; if($resolved){ $pd=Join-Path $ad 'nkk-secure-access'; New-Item -ItemType Directory -Force -Path $pd | Out-Null;`
    : ""
  // Install-Zeit-Profil: die Rolle in eine Datei legen, die die App beim ersten
  // Start einmalig liest. Wird VOR dem App-Start geschrieben (in $pd, s.o.).
  const profileWrite = opts?.profile
    ? ` Set-Content -Path "$pd\\profile" -Value '${opts.profile}' -NoNewline -Encoding ascii; Write-Host "-> Profil '${opts.profile}' gesetzt." -ForegroundColor Green;`
    : ""
  // Bulletproof Zero-Touch: den Setup-Key zusaetzlich im User-Profil hinterlegen.
  // Die NSIS enrollt NetBird bereits waehrend der Installation; falls das (Netz/
  // Dienst-Timing) nicht durchkommt, findet die App diesen Key beim ersten Start,
  // holt das Enrollment selbst nach und migriert ihn in den Credential Manager
  // (danach loescht die App die Klartext-Datei). $pd ist nur fuer den Nutzer lesbar.
  const keyWrite = opts?.setupKey
    ? ` Set-Content -Path "$pd\\pending-setup-key" -Value '${opts.setupKey}' -NoNewline -Encoding ascii;`
    : ""
  // Schliesst den if($resolved)-Block aus pdSetup (Profil/Key nur bei aufgeloestem User).
  const pdClose = needPd ? ` }` : ""
  return [
    // Pre-Delete: pro Lauf frisch starten, damit curl -C - NIE auf eine fremde/
    // stale nkk-setup.exe resumt (HTTP 416 -> curl exit 0 -> falsche Version). -C -
    // bleibt fuer Within-Run-Resume (--retry haelt die Teildatei WAEHREND des Laufs).
    `$u="${url}"; $o="$env:TEMP\\nkk-setup.exe"; Remove-Item $o -EA SilentlyContinue; $ok=$false`,
    `Write-Host "NKK Secure Access - Download laeuft ..." -ForegroundColor Cyan`,
    // F9: --retry-all-errors kennt altes Windows-10-curl nicht -> curl scheitert
    // sofort. Weglassen; --retry deckt Netz-/Verbindungsabbrueche (der haeufige Fall)
    // ab, -C - setzt bei Wiederholung fort. BITS/IWR bleiben als Fallback.
    `if(Get-Command curl.exe -EA SilentlyContinue){ curl.exe -L --http1.1 --retry 10 --retry-delay 3 -C - --connect-timeout 30${p} -o $o $u; $ok=($LASTEXITCODE -eq 0) }`,
    `if(-not $ok){ try{ Import-Module BitsTransfer -EA SilentlyContinue; Start-BitsTransfer -Source $u -Destination $o -EA Stop; $ok=$true }catch{} }`,
    `if(-not $ok){ try{ $ProgressPreference='SilentlyContinue'; Invoke-WebRequest $u -OutFile $o -UseBasicParsing; $ok=$true }catch{} }`,
    `if($ok -and (Test-Path $o) -and (Get-Item $o).Length -lt 1MB){ $ok=$false; Remove-Item $o -EA SilentlyContinue }`,
    `if($ok){ Write-Host "Installiere (kann einen Moment dauern) ..." -ForegroundColor Cyan; $rc=(Start-Process $o -ArgumentList ${installArgs} -Wait -PassThru).ExitCode; Remove-Item $o -EA SilentlyContinue; if($rc -eq 0){ Write-Host "-> Fertig installiert." -ForegroundColor Green;${pdSetup}${keyWrite}${profileWrite}${pdClose}${launch} }else{ Write-Host ("-> Installer meldete Fehler (Code "+$rc+") - bitte nochmal ausfuehren.") -ForegroundColor Red } }else{ Write-Host "-> Download fehlgeschlagen - bitte nochmal ausfuehren." -ForegroundColor Red }`,
  ]
    .map((l) => i + l)
    .join("\n")
}
