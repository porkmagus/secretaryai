@echo off
setlocal

cd /d "%~dp0"

echo.
echo === Secretary Shutdown ===
echo.

call :killWindow "Secretary Web"
call :killWindow "Secretary Worker"
call :killWindow "Secretary STT"
call :killWindow "Secretary TTS"

if defined DRY_RUN (
  echo [DRY RUN] npm run stack:down
  exit /b 0
)

call npm run stack:down
exit /b %errorlevel%

:killWindow
set "_title=%~1"
if defined DRY_RUN (
  echo [DRY RUN] taskkill /FI "WINDOWTITLE eq %_title%" /T /F
  exit /b 0
)
taskkill /FI "WINDOWTITLE eq %_title%" /T /F >nul 2>nul
exit /b 0
