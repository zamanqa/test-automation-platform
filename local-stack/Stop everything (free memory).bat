@echo off
title Stop everything - Circuly Local
echo This stops the Circuly apps, the backend, Docker Desktop and its VM to free memory.
echo.
choice /C YN /M "Continue"
if errorlevel 2 exit /b 0
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\stop-everything.ps1"
echo.
pause
