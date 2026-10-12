# Neon Brawl - download fighter art listed in manifest.json
# Put this file next to manifest.json, then run:
#   powershell -ExecutionPolicy Bypass -File .\download-art.ps1

# Windows PowerShell 5 can default to old TLS, which makes HTTPS downloads fail.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Hide the slow progress bar and show each step clearly.
$ProgressPreference = 'SilentlyContinue'

$root = $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }

$manifestPath = Join-Path $root 'manifest.json'
if (-not (Test-Path $manifestPath)) {
    Write-Host "manifest.json was not found next to this script: $root" -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

$manifest = [System.IO.File]::ReadAllText($manifestPath) | ConvertFrom-Json

# Links expire at this unix time (see manifest "note").
$expires = 1792108800
$now = [int64]((Get-Date).ToUniversalTime() - [datetime]'1970-01-01').TotalSeconds
if ($now -gt $expires) {
    Write-Host "WARNING: these links have expired. Downloads will probably fail." -ForegroundColor Yellow
}

$ok = 0
$failed = @()

foreach ($item in $manifest.items) {
    $relative = $item.file -replace '/', '\'
    $dest = Join-Path $root $relative
    $dir = Split-Path -Parent $dest
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

    Write-Host "Downloading $($item.name) ... " -NoNewline
    try {
        Invoke-WebRequest -Uri $item.url -OutFile $dest -UseBasicParsing -TimeoutSec 180
        $size = (Get-Item $dest).Length
        if ($size -lt 1000) { throw "file is too small ($size bytes)" }
        Write-Host "OK ($([math]::Round($size / 1KB)) KB)" -ForegroundColor Green
        $ok++
    } catch {
        Write-Host "FAILED" -ForegroundColor Red
        Write-Host "   $($_.Exception.Message)"
        if (Test-Path $dest) { Remove-Item $dest -Force }
        $failed += $item.name
    }
}

Write-Host ""
Write-Host "Done: $ok downloaded, $($failed.Count) failed."
if ($failed.Count -gt 0) {
    Write-Host "Failed: $($failed -join ', ')" -ForegroundColor Yellow
    Write-Host "If the error is 403 or 404, the links have expired. Tell me and I will make new ones."
}

# Pack everything into one zip so it is easy to send back.
if ($ok -gt 0) {
    $zip = Join-Path $root 'fighters.zip'
    if (Test-Path $zip) { Remove-Item $zip -Force }
    Compress-Archive -Path (Join-Path $root 'fighters') -DestinationPath $zip -Force
    Write-Host "Zip created: $zip"
}

Read-Host "Press Enter to close"
