@echo off
cd /d "%~dp0"
rem Keeps the launcher running: if it ever stops, it starts again after 15 seconds.
:run
for %%A in (launcher.log) do if %%~zA GTR 1000000 del launcher.log
node launcher.mjs >> launcher.log 2>&1
timeout /t 15 /nobreak >nul
goto run
