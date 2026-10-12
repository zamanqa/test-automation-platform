@echo off
title Circuly Launcher - keep this window open (closing it stops the apps)
rem Portable Node 22 (see INSTALL.md). Set NODE22 yourself to use another place.
if not defined NODE22 set "NODE22=%USERPROFILE%\tools\node22\node.exe"
if not exist "%NODE22%" (
    echo Node 22 not found at %NODE22%. See INSTALL.md.
    pause
    exit /b 1
)
if not exist "%~dp0config.json" (
    echo config.json is missing. Copy config.example.json to config.json and fill it in. See INSTALL.md.
    pause
    exit /b 1
)

rem Already running? Just open the page.
curl -s -o nul -m 3 http://localhost:3999/api/status && (
    start "" http://localhost:3999
    exit /b 0
)

echo Checking Docker Desktop...
docker info >nul 2>&1
if not errorlevel 1 goto dockerup
echo Starting Docker Desktop...
start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
:waitdocker
timeout /t 5 /nobreak >nul
docker info >nul 2>&1
if errorlevel 1 goto waitdocker
:dockerup

start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3999"
"%NODE22%" "%~dp0launcher\server.js"
echo.
echo The launcher stopped.
pause
