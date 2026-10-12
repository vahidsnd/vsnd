# Downloads all generated fighter art from manifest.json into .\fighters\
# Run in PowerShell from the folder that contains manifest.json:
#   powershell -ExecutionPolicy Bypass -File .\download-art.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $root 'manifest.json') | ConvertFrom-Json
$ok = 0; $fail = 0
foreach ($item in $manifest.items) {
    $dest = Join-Path $root $item.file
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
    try {
        Invoke-WebRequest -Uri $item.url -OutFile $dest -UseBasicParsing
        $ok++
        Write-Host "OK   $($item.name) -> $($item.file)"
    } catch {
        $fail++
        Write-Host "FAIL $($item.name): $($_.Exception.Message)"
    }
}
Write-Host ""
Write-Host "Done: $ok downloaded, $fail failed."
if ($fail -gt 0) { Write-Host 'Failed links usually mean they expired (see the note in manifest.json).' }
