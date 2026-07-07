# =============================================================================
#  NKK RDP-Signatur: maschinenweiter Trust (laeuft ELEVATED aus dem Installer)
# -----------------------------------------------------------------------------
#  Least-Privilege-Design (recherche-belegt):
#   - EIN LocalMachine-CodeSigning-Cert, Schluessel NICHT exportierbar.
#   - Vertrauen NUR ueber HKLM ...\Terminal Services\TrustedCertThumbprints
#     (+ AllowSignedFiles=1). KEIN Root-, KEIN TrustedPublisher-Import: der
#     Thumbprint-Pfad unterdrueckt den April-2026-"Unbekannter Herausgeber"-
#     Dialog KOMPLETT (ohne Kettenpruefung) und ist die kleinste Angriffsflaeche.
#   - Der private Schluessel bleibt maschinenweit; die non-elevated App bekommt
#     nur READ (Nutzung, kein Export) am CNG-Key - und zwar nur fuer INTERACTIVE
#     (der am Geraet angemeldete Nutzer), NICHT Authenticated Users.
#   - Der Thumbprint wird nach HKLM\SOFTWARE\NKK\RdpSign geschrieben; App + Installer
#     teilen so EINE Wahrheit (die App muss keinen Cert erzeugen/erraten).
#  Fail-safe: jeder Schritt best-effort. Klappt etwas nicht, faellt die App auf
#  ihren per-User-Signaturweg zurueck (kein Regress).
# =============================================================================
$ErrorActionPreference = 'SilentlyContinue'
try {
  $subj = 'CN=NKK Secure Access, O=Naturkost Kontor Bremen GmbH'
  $fp   = 'NKK RDP Signing'

  # Cert idempotent: vorhandenen (per Subject) wiederverwenden, sonst neu.
  $cert = Get-ChildItem Cert:\LocalMachine\My |
    Where-Object { $_.Subject -eq $subj -and $_.NotAfter -gt (Get-Date) } | Select-Object -First 1
  if (-not $cert) {
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $subj `
      -KeyUsage DigitalSignature -KeyExportPolicy NonExportable -FriendlyName $fp `
      -CertStoreLocation 'Cert:\LocalMachine\My' -NotAfter (Get-Date).AddYears(5)
  }
  if (-not $cert) { exit 1 }
  $tp = ($cert.Thumbprint.ToUpper() -replace '[^0-9A-F]','')

  # Vertrauen: NUR Thumbprint-Whitelist + AllowSignedFiles (64-bit-View, HKLM).
  $k = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services'
  New-Item -Path $k -Force | Out-Null
  New-ItemProperty -Path $k -Name 'AllowSignedFiles' -PropertyType DWord -Value 1 -Force | Out-Null
  $cur = (Get-ItemProperty -Path $k -Name TrustedCertThumbprints -ErrorAction SilentlyContinue).TrustedCertThumbprints
  if (-not $cur) { $cur = '' }
  if ($cur -notmatch [regex]::Escape($tp)) {
    Set-ItemProperty -Path $k -Name TrustedCertThumbprints -Value (($cur.TrimEnd(';') + ";$tp").TrimStart(';')) | Out-Null
  }

  # CNG-Key nur LESEN (nicht exportieren/aendern) fuer INTERACTIVE (S-1-5-4).
  try {
    $rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
    $un  = $rsa.Key.UniqueName
    if ($un) {
      $kp = Join-Path $env:ProgramData "Microsoft\Crypto\Keys\$un"
      if (Test-Path $kp) { & icacls "$kp" /grant '*S-1-5-4:R' 2>$null | Out-Null }
    }
  } catch {}

  # EINE Wahrheit fuer die App.
  $nk = 'HKLM:\SOFTWARE\NKK\RdpSign'
  New-Item -Path $nk -Force | Out-Null
  Set-ItemProperty -Path $nk -Name 'Thumbprint' -Value $tp | Out-Null

  Write-Output $tp
} catch { exit 1 }
