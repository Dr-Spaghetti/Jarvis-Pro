@echo off
title Rebuilding Jarvis...
cd /d "%~dp0"
echo.
echo   ==============================================
echo    JARVIS  ^|  Rebuild ^& Restart
echo   ==============================================
echo.

echo   [1/3] Stopping any running Jarvis instance...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| find ":8787" ^| find "LISTENING"') do (
  taskkill /f /pid %%a >nul 2>nul
)
timeout /t 1 /nobreak >nul

echo   [2/3] Building (takes ~30-60 seconds)...
echo.
call pnpm build
if errorlevel 1 (
  echo.
  echo   !! BUILD FAILED — see errors above.
  echo   Fix the issue and run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo   [3/3] Launching Jarvis...
echo.
start "" "%~dp0Start Jarvis.bat"
exit
