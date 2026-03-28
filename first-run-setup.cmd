@echo off
setlocal

cd /d "%~dp0"
call "secretary.cmd" install %*
exit /b %errorlevel%
