# =============================================================================
#  NKK Secure Access - RDP-Warnungen dauerhaft entfernen
# -----------------------------------------------------------------------------
#  Hintergrund: Das Windows-Update April 2026 (KB5082063 / CVE-2026-26151) zeigt
#  beim Oeffnen einer .rdp zwei neue Warnungen:
#   (1) "Sie oeffnen eine RDP-Datei ..." (Erst-Start-Consent)
#   (2) "Unbekannter Herausgeber" (weil die .rdp unsigniert ist)
#  Dieses Skript erzeugt pro Client EIN nicht-exportierbares Signatur-Zertifikat,
#  vertraut ihm als .rdp-Publisher und bestaetigt den Consent-Dialog vorab.
#  Danach signiert die App (ab v0.3.12) die .rdp mit diesem Cert -> BEIDE Warnungen weg.
#  Idempotent, laeuft im USER-Kontext (HKCU + CurrentUser-Store), KEINE Adminrechte noetig.
# =============================================================================
$ErrorActionPreference = 'Stop'
$fp = 'NKK RDP Signing'

# 1) Signatur-Zertifikat suchen oder erzeugen (nicht-exportierbar, 10 Jahre)
$cert = Get-ChildItem Cert:\CurrentUser\My |
  Where-Object { $_.FriendlyName -eq $fp -and $_.NotAfter -gt (Get-Date) } |
  Select-Object -First 1
if (-not $cert) {
  $cert = New-SelfSignedCertificate -Type CodeSigningCert `
    -Subject 'CN=NKK Secure Access, O=Naturkost Kontor Bremen GmbH' `
    -KeyUsage DigitalSignature -KeyExportPolicy NonExportable `
    -FriendlyName $fp -CertStoreLocation 'Cert:\CurrentUser\My' `
    -NotAfter (Get-Date).AddYears(10)
}
$tp = $cert.Thumbprint   # SHA1, Grossbuchstaben, ohne Leerzeichen

# 2) Oeffentlichen Teil als vertrauenswuerdig hinterlegen (TrustedPublisher + Root)
$pub = Join-Path $env:TEMP 'nkk-rdp.cer'
Export-Certificate -Cert $cert -FilePath $pub -Type CERT | Out-Null
Import-Certificate -FilePath $pub -CertStoreLocation Cert:\CurrentUser\TrustedPublisher | Out-Null
Import-Certificate -FilePath $pub -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
Remove-Item $pub -Force -ErrorAction SilentlyContinue

# 3) Thumbprint als vertrauenswuerdiger .rdp-Publisher (killt Warnung 2 ganz) - append-sicher
$tsk = 'HKCU:\Software\Policies\Microsoft\Windows NT\Terminal Services'
New-Item -Path $tsk -Force | Out-Null
$cur = (Get-ItemProperty -Path $tsk -Name TrustedCertThumbprints -ErrorAction SilentlyContinue).TrustedCertThumbprints
if (-not $cur) { $cur = '' }
if ($cur -notmatch [regex]::Escape($tp)) {
  Set-ItemProperty -Path $tsk -Name TrustedCertThumbprints -Value (($cur.TrimEnd(';') + ";$tp").TrimStart(';'))
}

# 4) Erst-Start-Consent-Dialog (Warnung 1) vorab bestaetigen
$tsc = 'HKCU:\Software\Microsoft\Terminal Server Client'
New-Item -Path $tsc -Force | Out-Null
New-ItemProperty -Path $tsc -Name 'RdpLaunchConsentAccepted' -PropertyType DWord -Value 1 -Force | Out-Null

# 5) Guertel + Hosentraeger: .rdp als Low-Risk markieren (klassischer MOTW/Attachment-Manager)
$lrk = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\Associations'
New-Item -Path $lrk -Force | Out-Null
$lrf = (Get-ItemProperty -Path $lrk -Name LowRiskFileTypes -ErrorAction SilentlyContinue).LowRiskFileTypes
if (-not $lrf) { $lrf = '' }
if ($lrf -notmatch '\.rdp') {
  Set-ItemProperty -Path $lrk -Name LowRiskFileTypes -Value (($lrf.TrimEnd(';') + ';.rdp').TrimStart(';'))
}

Write-Host "[NKK] RDP-Vertrauen eingerichtet (Thumbprint $tp)."
Write-Host "[NKK] Warnung 1 ist sofort weg. Warnung 2 ist weg, sobald die App (ab v0.3.12) die .rdp signiert."
