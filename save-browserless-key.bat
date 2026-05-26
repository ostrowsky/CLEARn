@echo off
setlocal

set "PROJECT_ROOT=%~dp0"
if "%PROJECT_ROOT:~-1%"=="\" set "PROJECT_ROOT=%PROJECT_ROOT:~0,-1%"

echo This will save Browserless settings for local CLEARn development.
echo The key will be stored in your Windows user environment and in platform\.env.
echo.
set /p BROWSERLESS_API_KEY=Paste BROWSERLESS_API_KEY and press Enter: 

if "%BROWSERLESS_API_KEY%"=="" (
  echo BROWSERLESS_API_KEY was not provided.
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$projectRoot = $env:PROJECT_ROOT;" ^
  "$envPath = Join-Path $projectRoot 'platform\.env';" ^
  "$key = $env:BROWSERLESS_API_KEY;" ^
  "[Environment]::SetEnvironmentVariable('TRANSCRIPT_FETCH_PROVIDER', 'browserless', 'User');" ^
  "[Environment]::SetEnvironmentVariable('BROWSERLESS_API_URL', 'https://production-sfo.browserless.io', 'User');" ^
  "[Environment]::SetEnvironmentVariable('BROWSERLESS_API_KEY', $key, 'User');" ^
  "[Environment]::SetEnvironmentVariable('BROWSERLESS_USE_RESIDENTIAL_PROXY', 'true', 'User');" ^
  "[Environment]::SetEnvironmentVariable('BROWSERLESS_PROXY_COUNTRY', 'us', 'User');" ^
  "$lines = @('TRANSCRIPT_FETCH_PROVIDER=browserless', 'BROWSERLESS_API_URL=https://production-sfo.browserless.io', ('BROWSERLESS_API_KEY=' + $key), 'BROWSERLESS_USE_RESIDENTIAL_PROXY=true', 'BROWSERLESS_PROXY_COUNTRY=us');" ^
  "Set-Content -LiteralPath $envPath -Value $lines -Encoding utf8;" ^
  "Write-Host 'Browserless settings saved. Restart local API/client terminals or run start scripts again.'"

if errorlevel 1 (
  echo Failed to save Browserless settings.
  exit /b 1
)

echo.
echo Done. Restart the local API/client so they read the updated environment.
endlocal
