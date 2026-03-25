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

call :run "Prepare runtime storage" npm run storage:prepare || goto :error
call :run "Start Postgres/Redis/SearXNG" npm run stack:up || goto :error
call :run "Apply database migrations" npm run db:migrate || goto :error

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
shift
echo.
echo [%_label%]
if defined DRY_RUN (
  echo [DRY RUN] %*
  exit /b 0
)
call %*
exit /b %errorlevel%

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

:error
echo.
echo Startup stopped because a command failed.
exit /b 1
