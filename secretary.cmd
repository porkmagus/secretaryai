@echo off
setlocal

cd /d "%~dp0"

node "scripts\setup\secretary-dev-orchestrator.mjs" %*
exit /b %errorlevel%
