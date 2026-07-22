# Generates a SELF-SIGNED code-signing certificate for LOCAL signing tests only.
#
# A self-signed certificate does NOT remove the Windows SmartScreen "unknown publisher" warning and
# must never be used for distribution — it only validates that the signing pipeline works. For real
# releases buy an OV/EV certificate and provide it via CSC_LINK / CSC_KEY_PASSWORD. See deploy.md §7.
#
# Usage (PowerShell):
#   pwsh apps/desktop/scripts/gen-selfsigned-cert.ps1            # default password "swaft-test"
#   pwsh apps/desktop/scripts/gen-selfsigned-cert.ps1 -Password "my-pw"
# then build a signed installer:
#   $env:CSC_LINK = "<printed path>"; $env:CSC_KEY_PASSWORD = "<password>"; npm run dist

param(
  [string]$Password = "swaft-test",
  [string]$OutFile = "$PSScriptRoot/../.certs/selfsigned.pfx"
)

$ErrorActionPreference = "Stop"

$dir = Split-Path -Parent $OutFile
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }

# Create the cert in the user store, export it, then remove it from the store — we only keep the .pfx.
$cert = New-SelfSignedCertificate -Type CodeSigningCert `
  -Subject "CN=Swaft (self-signed test, NOT for distribution)" `
  -CertStoreLocation Cert:\CurrentUser\My `
  -KeyUsage DigitalSignature -KeyExportPolicy Exportable `
  -FriendlyName "Swaft self-signed test signing"

$sec = ConvertTo-SecureString -String $Password -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $OutFile -Password $sec | Out-Null
Remove-Item ("Cert:\CurrentUser\My\" + $cert.Thumbprint) -Force

$full = (Resolve-Path $OutFile).Path
Write-Host "Wrote $full  (gitignored via .certs/ + *.pfx)"
Write-Host ""
Write-Host "Build a signed installer with:"
Write-Host "  `$env:CSC_LINK = '$full'"
Write-Host "  `$env:CSC_KEY_PASSWORD = '$Password'"
Write-Host "  npm run dist"
