# Frees memory held by Chrome, VS Code, Slack and Postman: each app is closed the normal way (so it
# keeps your tabs, windows and unsaved work), its cache folders are cleared, and it is reopened.
# Only cache is deleted, never logins, cookies, history, settings or unsaved files.
# Started by "Free memory (Chrome, VS Code, Slack, Postman).bat".
$ErrorActionPreference = 'SilentlyContinue'
function FreeGB { [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB, 1) }
function UsedGB($names) { [math]::Round(((Get-Process $names | Measure-Object WorkingSet64 -Sum).Sum) / 1GB, 2) }

# Ask to close the app's windows, then wait for it to exit (force after $wait seconds).
function Close-App($names, $wait = 20) {
    Get-Process $names | Where-Object MainWindowHandle -ne 0 | ForEach-Object { $_.CloseMainWindow() | Out-Null }
    for ($i = 0; $i -lt $wait; $i++) { if (-not (Get-Process $names)) { return }; Start-Sleep 1 }
    Get-Process $names | Stop-Process -Force
    Start-Sleep 2
}
function Clear-Folders($root, $folders) {
    foreach ($f in $folders) {
        $p = Join-Path $root $f
        if (Test-Path $p) { Remove-Item -Recurse -Force $p }
    }
}
function Ask($question) {
    $a = Read-Host "$question [y/N]"
    return $a -match '^(y|yes)$'
}

$before = FreeGB
Write-Host "Free memory now: $before GB"
Write-Host ''

# ---------- Chrome ----------
if (Get-Process chrome) {
    Write-Host "Chrome uses $(UsedGB 'chrome') GB."
    if (Ask 'Restart Chrome and clear its cache? Your tabs reopen.') {
        Close-App 'chrome' 20
        $ud = "$env:LOCALAPPDATA\Google\Chrome\User Data"
        Get-ChildItem $ud -Directory | Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' } | ForEach-Object {
            Clear-Folders $_.FullName @('Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache')
        }
        Clear-Folders $ud @('ShaderCache', 'GrShaderCache', 'GraphiteDawnCache')
        Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" '--restore-last-session'
        Write-Host '  Chrome restarted with your last tabs.'
    }
    if (Ask 'Open Chrome''s Memory Saver setting? (it puts tabs you are not using to sleep automatically)') {
        Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" 'chrome://settings/performance'
    }
    Write-Host ''
}

# ---------- VS Code ----------
if (Get-Process Code) {
    Write-Host "VS Code uses $(UsedGB 'Code') GB."
    if (Ask 'Restart VS Code and clear its cache? Windows and unsaved files come back.') {
        Close-App 'Code' 20
        Clear-Folders "$env:APPDATA\Code" @('Cache', 'CachedData', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache')
        Start-Process "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe"
        Write-Host '  VS Code restarted.'
    }
    Write-Host ''
}

# ---------- Slack (Microsoft Store version) ----------
if (Get-Process slack) {
    Write-Host "Slack uses $(UsedGB 'slack') GB."
    if (Ask 'Restart Slack and clear its cache?') {
        # Closing Slack's window only hides it in the tray, so it is ended directly (nothing unsaved is lost).
        Get-Process slack | Stop-Process -Force
        Start-Sleep 2
        $pkg = Get-ChildItem "$env:LOCALAPPDATA\Packages" -Directory -Filter 'com.tinyspeck.slackdesktop_*' | Select-Object -First 1
        if ($pkg) {
            Clear-Folders "$($pkg.FullName)\LocalCache\Roaming\Slack" @('Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GPUPersistentCache', 'GrShaderCache', 'ShaderCache')
            # The Packages folder is named after the app's package family name.
            Start-Process "shell:AppsFolder\$($pkg.Name)!Slack"
        }
        Write-Host '  Slack restarted.'
    }
    Write-Host ''
}

# ---------- Postman ----------
if (Get-Process Postman) {
    Write-Host "Postman uses $(UsedGB 'Postman') GB."
    if (Ask 'Restart Postman and clear its cache? Open request tabs come back.') {
        Close-App 'Postman' 20
        Clear-Folders "$env:APPDATA\Postman" @('Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache')
        if (Test-Path "$env:LOCALAPPDATA\Postman\Postman.exe") { Start-Process "$env:LOCALAPPDATA\Postman\Postman.exe" }
        Write-Host '  Postman restarted.'
    }
    Write-Host ''
}

Start-Sleep 5
$after = FreeGB
Write-Host "Done. Free memory: $before GB -> $after GB (apps you restarted grow again as you use them)."
