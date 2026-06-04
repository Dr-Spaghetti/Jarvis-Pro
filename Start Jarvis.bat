@echo off
title Jarvis
cd /d "%~dp0"
echo.
echo   Starting Jarvis... your browser will open automatically in a few seconds.
echo   (Keep this window minimized while you use Jarvis. Close it to stop.)
echo.
node bin\octogent
echo.
echo   Jarvis has stopped. Press any key to close this window.
pause >nul
