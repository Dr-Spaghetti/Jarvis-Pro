@echo off
title Jarvis (Dev Mode — Auto Reload)
cd /d "%~dp0"
echo.
echo   ==============================================
echo    JARVIS  ^|  Dev Mode  ^|  Auto-Reload on Save
echo   ==============================================
echo.
echo   Code changes reload automatically — no rebuild needed.
echo   Use "Rebuild ^& Start Jarvis.bat" for a production build.
echo.
pnpm dev
echo.
echo   Jarvis has stopped. Press any key to close this window.
pause >nul
