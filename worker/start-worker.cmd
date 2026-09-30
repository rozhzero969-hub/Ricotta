@echo off
cd /d "%~dp0"
:run
node worker.mjs
if errorlevel 1 (
  echo Worker stopped unexpectedly. Restarting in 15 seconds. Close this window to stop the worker.
  timeout /t 15 /nobreak >nul
  goto run
)
rem Exit code 0 means another worker is already running or it was stopped on purpose.
if "%~1"=="" pause
