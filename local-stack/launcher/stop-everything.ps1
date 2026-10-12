# Stops the apps, the backend, Docker Desktop and its VM, so all of that memory goes back to Windows.
# Started by "Stop everything (free memory).bat".
$ErrorActionPreference = 'SilentlyContinue'
$h = @{ 'X-Launcher' = '1' }
function FreeGB { [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB, 1) }
$before = FreeGB

if (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 http://localhost:3999/api/status) {
    Write-Host 'Stopping the apps...'
    Invoke-WebRequest -UseBasicParsing -Method POST -Headers $h http://localhost:3999/api/apps/stop-all | Out-Null
    # Stopping the backend also points its container back at the local DB, so backend tests run later
    # can never reach the shared dev DB.
    Write-Host 'Stopping the backend...'
    Invoke-WebRequest -UseBasicParsing -Method POST -Headers $h http://localhost:3999/api/backend/stop | Out-Null
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep 2
        $s = (Invoke-WebRequest -UseBasicParsing http://localhost:3999/api/status).Content | ConvertFrom-Json
        if (-not $s.job -or $s.job.status -ne 'running') { break }
    }
    Write-Host 'Closing the launcher...'
    $p = (Get-NetTCPConnection -LocalPort 3999 -State Listen).OwningProcess
    if ($p) { Stop-Process -Id $p -Force }
}

Write-Host 'Quitting Docker Desktop...'
docker desktop stop 2>$null | Out-Null
if (Get-Process 'Docker Desktop') { Get-Process 'Docker Desktop' | Stop-Process -Force }
Start-Sleep 3
Write-Host 'Shutting down the Docker VM (WSL)...'
wsl --shutdown
Start-Sleep 3

$after = FreeGB
Write-Host ''
Write-Host "Done. Free memory: $before GB -> $after GB"
Write-Host 'Start again with "Circuly Launcher.bat" (it starts Docker and the backend).'
