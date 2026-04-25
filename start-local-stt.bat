@echo off
setlocal
cd /d "%~dp0"

echo Starting SOFTskills local free STT server...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File ".\platform\start-local-stt.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
    echo Local STT startup failed with exit code %EXIT_CODE%.
)
pause
exit /b %EXIT_CODE%
