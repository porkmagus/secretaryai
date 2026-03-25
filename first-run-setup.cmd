@echo off
setlocal

cd /d "%~dp0"

echo.
echo === Secretary First Run Setup ===
echo.

if not exist ".env" (
  echo Creating .env from .env.example...
  if defined DRY_RUN (
    echo [DRY RUN] copy /Y ".env.example" ".env"
  ) else (
    copy /Y ".env.example" ".env" >nul || goto :error
  )
) else (
  echo .env already exists. Leaving it in place.
)

call :run "Install dependencies" npm install || goto :error
call :run "Prepare runtime storage" npm run storage:prepare || goto :error
call :run "Start Postgres/Redis/SearXNG" npm run stack:up || goto :error
call :run "Apply database migrations" npm run db:migrate || goto :error
call :run "Prepare local STT service" npm run stt:setup || goto :error
call :run "Prepare local TTS service" npm run tts:setup || goto :error

echo.
echo First-run setup is complete.
echo Next step: run start-secretary-dev.cmd
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

:error
echo.
echo Setup stopped because a command failed.
exit /b 1
