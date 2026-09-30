@echo off
cd /d "%~dp0"
node worker.mjs
if errorlevel 1 pause
