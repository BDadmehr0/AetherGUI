$ErrorActionPreference = "Stop"

# SHA-256 of a file, lowercase hex, via .NET — not `Get-FileHash`, which is not
# resolved in the Windows PowerShell 5.1 session `npm run fetch:routing`
# starts on the hosted runner (the workflow step's shell is pwsh, but the npm
# script spawns `powershell.exe`). See scripts/fetch-aether.ps1.
function Get-Sha256Hex {
    param([string]$LiteralPath)
    $stream = [System.IO.File]::OpenRead($LiteralPath)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
    }
    finally {
        $stream.Dispose()
        $sha256.Dispose()
    }
}

$version = "26.3.27"
$archiveName = "Xray-windows-64.zip"
$expected = "d004c39288ce9ada487c6f398c7c545f7d749e44bdfdd59dbc9f865afba4e1ad"
$url = "https://github.com/XTLS/Xray-core/releases/download/v$version/$archiveName"

# The archive digest above covers the container. These cover the two files that actually
# ship, and they are the same values the application refuses to run without:
#   xray.exe    src-tauri/src/routing.rs  XRAY_SHA256
#   wintun.dll  src-tauri/src/routing.rs  WINTUN_SHA256
# Checking them here means a version bump that misses one of those constants fails during
# the build instead of on a user's machine at connect time.
$expectedFiles = @{
  "xray.exe"   = "15c2d007954ac53ba69b80ec91242786b3c0b71d52649165b4ca1d5cc96ef8f1"
  "wintun.dll" = "e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce"
}
$temp = Join-Path ([System.IO.Path]::GetTempPath()) "aethon-xray-$([guid]::NewGuid())"
$destination = Join-Path $PSScriptRoot "..\src-tauri\binaries"
try {
  New-Item -ItemType Directory -Force $temp | Out-Null
  $archive = Join-Path $temp $archiveName
  Invoke-WebRequest -UseBasicParsing $url -OutFile $archive
  $actual = Get-Sha256Hex -LiteralPath $archive
  if ($actual -ne $expected) { throw "Xray checksum mismatch. Expected $expected, got $actual." }
  $expanded = Join-Path $temp "expanded"
  Expand-Archive -LiteralPath $archive -DestinationPath $expanded
  foreach ($file in @(@("xray.exe", "xray-x86_64-pc-windows-msvc.exe"), @("wintun.dll", "wintun.dll"))) {
    $source = Join-Path $expanded $file[0]
    if (-not (Test-Path -LiteralPath $source)) { throw "$($file[0]) was not found in the verified Xray archive." }
    $actualFile = Get-Sha256Hex -LiteralPath $source
    if ($actualFile -ne $expectedFiles[$file[0]]) {
      throw "$($file[0]) does not match the digest src-tauri/src/routing.rs enforces. Expected $($expectedFiles[$file[0]]), got $actualFile. Update the constant in routing.rs and here in the same reviewed commit."
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $destination $file[1]) -Force
    Write-Host "  verified $($file[0]) $actualFile"
  }
  Copy-Item -LiteralPath (Join-Path $expanded "LICENSE") -Destination (Join-Path $PSScriptRoot "..\third-party\xray-LICENSE.txt") -Force
  Copy-Item -LiteralPath (Join-Path $expanded "LICENSE-wintun.txt") -Destination (Join-Path $PSScriptRoot "..\third-party\wintun-LICENSE.txt") -Force
  Write-Host "Prepared verified Xray v$version and Wintun assets. SHA256=$actual"
}
finally {
  if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
}
