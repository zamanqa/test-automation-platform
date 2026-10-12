@echo off
title Free memory - Chrome, VS Code, Slack, Postman
echo For each running app you are asked first. It is closed normally (tabs, windows and unsaved
echo files are kept), its cache is cleared and it is reopened. Logins, cookies, history and
echo settings are never touched.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\free-memory.ps1"
echo.
pause
