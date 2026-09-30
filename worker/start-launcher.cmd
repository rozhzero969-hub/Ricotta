@echo off
cd /d "%~dp0"
:run
node launcher.mjs
echo Launcher stopped. Restarting in 15 seconds. Close this window to stop it.
timeout /t 15 /nobreak >nul
goto run
