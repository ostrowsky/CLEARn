Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $PSCommandPath
$serviceRoot = Join-Path $scriptRoot 'local-stt'
$venvRoot = Join-Path $serviceRoot '.venv'
$pythonExe = Join-Path $venvRoot 'Scripts\python.exe'
$requirementsPath = Join-Path $serviceRoot 'requirements.txt'
$serverPath = Join-Path $serviceRoot 'server.py'
$depsMarkerPath = Join-Path $venvRoot '.softskills-deps-installed'

if (-not (Test-Path -LiteralPath $pythonExe)) {
    Write-Host 'Creating local STT Python virtual environment...'
    python -m venv $venvRoot
}

$shouldInstallDeps = -not (Test-Path -LiteralPath $depsMarkerPath)
if (-not $shouldInstallDeps -and (Test-Path -LiteralPath $requirementsPath)) {
    $requirementsUpdatedAt = (Get-Item -LiteralPath $requirementsPath).LastWriteTimeUtc
    $depsInstalledAt = (Get-Item -LiteralPath $depsMarkerPath).LastWriteTimeUtc
    $shouldInstallDeps = $requirementsUpdatedAt -gt $depsInstalledAt
}

if ($shouldInstallDeps) {
    Write-Host 'Installing/updating local STT dependencies...'
    & $pythonExe -m pip install --upgrade pip
    & $pythonExe -m pip install -r $requirementsPath
    Set-Content -LiteralPath $depsMarkerPath -Value (Get-Date).ToString('o') -Encoding ASCII
}
else {
    Write-Host 'Local STT dependencies are already installed.'
}

if ([string]::IsNullOrWhiteSpace($env:LOCAL_STT_MODEL)) {
    $env:LOCAL_STT_MODEL = 'base.en'
}

if ([string]::IsNullOrWhiteSpace($env:LOCAL_STT_DEVICE)) {
    $env:LOCAL_STT_DEVICE = 'cpu'
}

if ([string]::IsNullOrWhiteSpace($env:LOCAL_STT_COMPUTE_TYPE)) {
    $env:LOCAL_STT_COMPUTE_TYPE = 'int8'
}

Write-Host ''
Write-Host 'Starting SOFTskills local STT server...'
Write-Host 'OpenAI-compatible endpoint: http://localhost:8010/v1/audio/transcriptions'
Write-Host "Model: $env:LOCAL_STT_MODEL"
Write-Host "Device: $env:LOCAL_STT_DEVICE"
Write-Host "Compute type: $env:LOCAL_STT_COMPUTE_TYPE"
Write-Host ''

& $pythonExe -m uvicorn server:app --host 127.0.0.1 --port 8010 --app-dir $serviceRoot
