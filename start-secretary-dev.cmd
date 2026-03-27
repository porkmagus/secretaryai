@echo off
setlocal

cd /d "%~dp0"

echo.
echo === Secretary Daily Startup ===
echo.

if not exist ".env" (
  echo Missing .env. Run first-run-setup.cmd first.
  exit /b 1
)

call :cleanup "Secretary Web" "3000"
if errorlevel 1 goto :error
call :cleanup "Secretary Worker" "4000"
if errorlevel 1 goto :error
call :cleanup "Secretary STT" "5001"
if errorlevel 1 goto :error
call :cleanup "Secretary TTS" "5002"
if errorlevel 1 goto :error

call :run "Prepare runtime storage" "npm run storage:prepare" || goto :error
call :run "Start Postgres/Redis/SearXNG" "npm run stack:up" || goto :error
call :run "Apply database migrations" "npm run db:migrate" || goto :error

call :launch "Secretary Web" "npm run dev:web" || goto :error
call :launch "Secretary Worker" "npm run dev:worker" || goto :error
call :launch "Secretary STT" "npm run dev:stt" || goto :error
call :launch "Secretary TTS" "npm run dev:tts" || goto :error

echo.
echo Secretary is starting up.
echo Desk: http://localhost:3000
echo Worker: http://127.0.0.1:4000
echo STT: http://127.0.0.1:5001
echo TTS: http://127.0.0.1:5002
echo.
echo Use stop-secretary-dev.cmd when you want to shut down the local stack.
echo.
exit /b 0

:run
set "_label=%~1"
set "_command=%~2"
echo.
echo [%_label%]
if defined DRY_RUN (
  echo [DRY RUN] %_command%
  exit /b 0
)
call %_command%
exit /b %errorlevel%

:cleanup
set "_title=%~1"
set "_port=%~2"
echo.
echo [Cleanup] %_title% on port %_port%
call :killWindow "%_title%"
call :killPort "%_port%" || exit /b 1
exit /b 0

:launch
set "_title=%~1"
set "_command=%~2"
echo.
echo [Launch] %_title%
if defined DRY_RUN (
  echo [DRY RUN] start "%_title%" cmd /k "cd /d "%~dp0" && %_command%"
  exit /b 0
)
start "%_title%" cmd /k "cd /d ""%~dp0"" && %_command%"
exit /b 0

:killWindow
set "_title=%~1"
if defined DRY_RUN (
  echo [DRY RUN] taskkill /FI "WINDOWTITLE eq %_title%" /T /F
  exit /b 0
)
taskkill /FI "WINDOWTITLE eq %_title%" /T /F >nul 2>nul
exit /b 0

:killPort
set "_port=%~1"
if defined DRY_RUN (
  echo [DRY RUN] powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort %_port% -State Listen ..."
  exit /b 0
)
powershell -NoProfile -Command ^
  "$connections = Get-NetTCPConnection -LocalPort %_port% -State Listen -ErrorAction SilentlyContinue; " ^
  "if (-not $connections) { Write-Host 'clear'; exit 0 }; " ^
  "$processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique; " ^
  "foreach ($processId in $processIds) { " ^
  "  try { " ^
  "    Stop-Process -Id $processId -Force -ErrorAction Stop; " ^
  "    Write-Host ('stopped pid ' + $processId + ' on port %_port%') " ^
  "  } catch { " ^
  "    Write-Error ('failed to stop pid ' + $processId + ' on port %_port%: ' + $_.Exception.Message); " ^
  "    exit 1 " ^
  "  } " ^
  "}"
if errorlevel 1 exit /b 1
timeout /t 1 >nul
exit /b 0

:error
echo.
echo Startup stopped because a command failed.
exit /b 1
