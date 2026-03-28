@echo off
setlocal

cd /d "%~dp0"
call "secretary.cmd" start %*
exit /b %errorlevel%
