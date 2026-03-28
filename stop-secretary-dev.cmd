@echo off
setlocal

cd /d "%~dp0"
call "secretary.cmd" stop %*
exit /b %errorlevel%
