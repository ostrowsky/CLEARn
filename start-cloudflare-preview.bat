@echo off
setlocal
cd /d "%~dp0"

if exist ".\platform\share-preview-links.txt" del /f /q ".\platform\share-preview-links.txt" >nul 2>nul

echo Starting SOFTskills public Cloudflare preview...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File ".\platform\open-share-preview.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%EXIT_CODE%"=="0" (
    if exist ".\platform\share-preview-links.txt" (
        echo Share preview links:
        type ".\platform\share-preview-links.txt"
        echo.
    )
    echo Preview startup finished. Use the public learner/admin links shown above.
) else (
    echo Preview startup failed with exit code %EXIT_CODE%.
    if exist ".\platform\share-preview-links.txt" (
        echo.
        echo A stale summary file exists, but startup failed. Do not use old links.
    )
)
echo.
pause
exit /b %EXIT_CODE%
