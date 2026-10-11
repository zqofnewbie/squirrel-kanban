@echo off
setlocal
REM Windows entry point; keep runtime settings in scripts/dev.mjs.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22+ and add it to PATH.
  pause
  exit /b 1
)
node scripts\dev.mjs
set "DEV_EXIT_CODE=%errorlevel%"
if not "%DEV_EXIT_CODE%"=="0" pause
exit /b %DEV_EXIT_CODE%
