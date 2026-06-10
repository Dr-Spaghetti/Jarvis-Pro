@echo off
title Jarvis (Remote)
cd /d "%~dp0"
echo.

rem -- Refuse to expose Jarvis without an access token in .env --------------
set "TOKEN_FOUND="
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if /i "%%A"=="OCTOGENT_AUTH_TOKEN" if not "%%B"=="" set "TOKEN_FOUND=1"
  )
)
if not defined TOKEN_FOUND (
  echo   OCTOGENT_AUTH_TOKEN is not set in .env — refusing to start in remote mode.
  echo.
  echo   Fix: open .env in Notepad and add a line like
  echo     OCTOGENT_AUTH_TOKEN=a-long-random-secret-here
  echo   ^(no spaces around the = sign^), then run this launcher again.
  echo   Full setup guide: docs\remote-access.md
  echo.
  pause
  exit /b 1
)

rem -- Warn if the Cloudflare tunnel service is not running ------------------
sc query cloudflared | find "RUNNING" >nul 2>nul
if errorlevel 1 (
  echo   WARNING: the Cloudflare tunnel service ^(cloudflared^) is not running.
  echo   Jarvis will work on this computer, but NOT from your phone, until the
  echo   tunnel is set up. See docs\remote-access.md, Step 3.
  echo.
)

set "OCTOGENT_ALLOW_REMOTE_ACCESS=1"

echo   Starting Jarvis in REMOTE mode — every request requires your access token.
echo   Your browser will open automatically in a few seconds.
echo   (Keep this window minimized while you use Jarvis. Close it to stop.)
echo.
node bin\octogent
echo.
echo   Jarvis has stopped. Press any key to close this window.
pause >nul
