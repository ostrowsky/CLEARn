@echo off
setlocal
cd /d "%~dp0"

set "ROOT=%~dp0"
set "PLATFORM=%ROOT%platform"
set "CLIENT=%PLATFORM%\apps\client"
set "EXPO_BIN=%PLATFORM%\node_modules\.bin\expo.CMD"

echo Starting CLEARn local stack...
echo.
echo Repository root:
echo   %ROOT%
echo.
echo This will open three windows:
echo   1. Local STT server on http://localhost:8010/v1
echo   2. CLEARn API on http://127.0.0.1:4000
echo   3. CLEARn web app on http://localhost:8081
echo.

echo Checking local runtime...
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed or is not available on PATH.
  echo Install Node.js 20.x, then run this file again.
  echo.
  pause
  exit /b 1
)

where pnpm.cmd >nul 2>nul
if errorlevel 1 (
  echo pnpm was not found on PATH. Trying to enable it through Corepack...
  where corepack >nul 2>nul
  if errorlevel 1 (
    echo ERROR: pnpm is required and Corepack was not found.
    echo Install pnpm 10.8.0 or Node.js 20.x with Corepack, then run this file again.
    echo.
    pause
    exit /b 1
  )
  call corepack enable
  call corepack prepare pnpm@10.8.0 --activate
)

if not exist "%PLATFORM%\node_modules" (
  echo Installing platform dependencies after git checkout...
  pushd "%PLATFORM%"
  call pnpm.cmd install
  if errorlevel 1 (
    popd
    echo ERROR: pnpm install failed.
    echo Check the install output above, then run this file again.
    echo.
    pause
    exit /b 1
  )
  popd
)

if not exist "%EXPO_BIN%" (
  echo Expo CLI was not found after dependency check. Running pnpm install once more...
  pushd "%PLATFORM%"
  call pnpm.cmd install
  if errorlevel 1 (
    popd
    echo ERROR: pnpm install failed.
    echo.
    pause
    exit /b 1
  )
  popd
)

if not exist "%EXPO_BIN%" (
  echo ERROR: Expo CLI was not found at:
  echo   %EXPO_BIN%
  echo The dependency install completed, but Expo is still missing.
  echo.
  pause
  exit /b 1
)

echo Stopping previous local listeners on ports 4000, 8081, and 8010...
powershell -NoProfile -ExecutionPolicy Bypass -Command "foreach ($port in 4000,8081,8010) { Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ } | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"
echo.

echo Starting local STT...
start "CLEARn Local STT" powershell -NoExit -NoProfile -ExecutionPolicy Bypass -Command "Set-Location '%ROOT%'; if (-not $env:LOCAL_STT_MODEL) { $env:LOCAL_STT_MODEL='base.en' }; if (-not $env:LOCAL_STT_DEVICE) { $env:LOCAL_STT_DEVICE='cpu' }; if (-not $env:LOCAL_STT_COMPUTE_TYPE) { $env:LOCAL_STT_COMPUTE_TYPE='int8' }; if (-not $env:LOCAL_STT_BEAM_SIZE) { $env:LOCAL_STT_BEAM_SIZE='5' }; if (-not $env:LOCAL_STT_WARMUP_ON_STARTUP) { $env:LOCAL_STT_WARMUP_ON_STARTUP='1' }; & '.\platform\start-local-stt.ps1'"

echo Starting API...
start "CLEARn API" powershell -NoExit -NoProfile -ExecutionPolicy Bypass -Command "Set-Location '%PLATFORM%'; $env:APP_PORT='4000'; $env:APP_BASE_URL='http://127.0.0.1:4000'; $env:LLM_STT_PROVIDER='selfhosted'; $env:SELF_HOSTED_SPEECH_BASE_URL='http://localhost:8010/v1'; if (-not $env:SELF_HOSTED_STT_MODEL) { $env:SELF_HOSTED_STT_MODEL='base.en' }; if (-not $env:SELF_HOSTED_STT_TIMEOUT_MS) { $env:SELF_HOSTED_STT_TIMEOUT_MS='30000' }; pnpm.cmd dev:api"

echo Starting web app...
start "CLEARn Web" powershell -NoExit -NoProfile -ExecutionPolicy Bypass -Command "Set-Location '%CLIENT%'; $env:EXPO_PUBLIC_API_BASE_URL='http://127.0.0.1:4000'; $env:EXPO_NO_TELEMETRY='1'; $env:EXPO_OFFLINE='1'; & '%EXPO_BIN%' start --web --port 8081 --offline"

echo.
echo Waiting a few seconds before health checks...
timeout /t 12 /nobreak >nul

echo.
echo Health checks:
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4000/api/health' -TimeoutSec 5; Write-Host ('API OK: ' + ($health | ConvertTo-Json -Compress)) } catch { Write-Host ('API not ready yet: ' + $_.Exception.Message) }"
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $health = Invoke-RestMethod -Uri 'http://localhost:8010/v1/health' -TimeoutSec 5; Write-Host ('STT OK: ' + ($health | ConvertTo-Json -Compress)) } catch { Write-Host ('STT not ready yet: ' + $_.Exception.Message) }"
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $response = Invoke-WebRequest -Uri 'http://localhost:8081' -TimeoutSec 5 -UseBasicParsing; Write-Host ('Web OK: http://localhost:8081 returned ' + $response.StatusCode) } catch { Write-Host ('Web not ready yet: ' + $_.Exception.Message) }"

echo.
echo Open the learner app:
echo   http://localhost:8081
echo.
echo Keep the three CLEARn windows open while testing.
echo.
pause
