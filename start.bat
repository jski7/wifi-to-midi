@echo off
rem Double-click this file to start WiFi to MIDI on Windows.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Run:  winget install OpenJS.NodeJS.LTS
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies ^(first run only^)...
  call npm install --omit=dev || (pause & exit /b 1)
)

node server.js
pause
