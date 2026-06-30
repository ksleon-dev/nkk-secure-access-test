// Bulletproof + universeller Windows-Download+Install-Befehl.
// Schlau: bevorzugt curl.exe (schnell, Resume mit -C -), faellt auf BITS
// (Start-BitsTransfer, auf JEDEM Windows ab 7, resumebar) und zuletzt auf
// Invoke-WebRequest (mit SilentlyContinue, damit es nicht lahm ist) zurueck.
// Laeuft also nicht nur auf modernem Windows. Installiert nur bei Erfolg.
// installArgs z.B. '"/S"' oder '"/S","/SETUPKEY=abc"'. indent fuer Einbettung
// in einen if-Block (Level-Skript).
export function winInstallCmd(
  url: string,
  installArgs: string,
  opts?: { progress?: boolean; indent?: string },
): string {
  const i = opts?.indent ?? ""
  const p = opts?.progress ? " -#" : ""
  return [
    `$u="${url}"; $o="$env:TEMP\\nkk-setup.exe"; Remove-Item $o -EA SilentlyContinue; $ok=$false`,
    `if(Get-Command curl.exe -EA SilentlyContinue){ curl.exe -L --http1.1 --retry 5 --retry-all-errors -C - --connect-timeout 30${p} -o $o $u; $ok=($LASTEXITCODE -eq 0) }`,
    `if(-not $ok){ try{ Import-Module BitsTransfer -EA SilentlyContinue; Start-BitsTransfer -Source $u -Destination $o -EA Stop; $ok=$true }catch{} }`,
    `if(-not $ok){ try{ $ProgressPreference='SilentlyContinue'; Invoke-WebRequest $u -OutFile $o -UseBasicParsing; $ok=$true }catch{} }`,
    `if($ok){ Start-Process $o -ArgumentList ${installArgs} -Wait }else{ Write-Host "Download fehlgeschlagen - bitte nochmal ausfuehren" }`,
  ]
    .map((l) => i + l)
    .join("\n")
}
