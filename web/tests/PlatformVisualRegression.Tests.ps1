Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$platformRoot = Join-Path $workspaceRoot 'platform'
$clientRoot = Join-Path $platformRoot 'apps\client'
. (Join-Path $PSScriptRoot 'Assertions.ps1')

Write-TestStep 'Visual regression compares local learner screens with CLEARn.zip mockups'

Assert-True -Condition (Test-Path -LiteralPath (Join-Path $workspaceRoot 'CLEARn.zip')) -Message 'CLEARn.zip visual handoff must be available for screenshot comparison.'
Assert-True -Condition (Test-Path -LiteralPath (Join-Path $clientRoot 'scripts\visual-regression.mjs')) -Message 'Playwright visual regression runner must exist.'
$clientPackage = Get-Content -LiteralPath (Join-Path $clientRoot 'package.json') -Raw
Assert-Match -Actual $clientPackage -Pattern '"playwright"' -Message 'Client package should include Playwright for screenshot comparison.'
Assert-Match -Actual $clientPackage -Pattern '"visual:regression"' -Message 'Client package should expose a visual regression script.'

if (-not [string]::Equals($env:RUN_VISUAL_REGRESSION_TESTS, '1', [System.StringComparison]::OrdinalIgnoreCase)) {
    Write-Host 'Platform visual regression tests skipped: set RUN_VISUAL_REGRESSION_TESTS=1 with the local web app running to compare screenshots.'
    return
}

$baseUrl = if ([string]::IsNullOrWhiteSpace($env:VISUAL_BASE_URL)) { 'http://localhost:8081' } else { $env:VISUAL_BASE_URL }
try {
    Invoke-WebRequest -UseBasicParsing -Uri $baseUrl -TimeoutSec 10 | Out-Null
}
catch {
    throw "Visual regression requires a running learner app at $baseUrl. Start the local web preview first or set VISUAL_BASE_URL."
}

$extractRoot = Join-Path $env:TEMP ('clearn-visual-baseline-' + [Guid]::NewGuid().ToString('n'))
$outputRoot = if ([string]::IsNullOrWhiteSpace($env:VISUAL_OUTPUT_DIR)) {
    Join-Path $workspaceRoot 'tmp-visual-regression'
}
else {
    $env:VISUAL_OUTPUT_DIR
}

try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $workspaceRoot 'CLEARn.zip'), $extractRoot)
    $baselineDir = Join-Path $extractRoot 'pixel-perfect\renders'
    $screenDir = Join-Path $extractRoot 'pixel-perfect\screens'
    Assert-True -Condition (Test-Path -LiteralPath (Join-Path $baselineDir '01-desktop-home.png')) -Message 'CLEARn.zip should contain pixel-perfect render PNG files.'
    Assert-True -Condition (Test-Path -LiteralPath (Join-Path $screenDir '01-desktop-home.html')) -Message 'CLEARn.zip should contain pixel-perfect screen HTML files for exact-size baseline regeneration.'

    $env:VISUAL_BASELINE_DIR = $baselineDir
    $env:VISUAL_SCREEN_DIR = $screenDir
    $env:VISUAL_OUTPUT_DIR = $outputRoot
    $env:VISUAL_BASE_URL = $baseUrl
    if ([string]::IsNullOrWhiteSpace($env:VISUAL_MAX_DIFF_RATIO)) {
        $env:VISUAL_MAX_DIFF_RATIO = '0.08'
    }

    Push-Location $clientRoot
    try {
        node .\scripts\visual-regression.mjs
        if ($LASTEXITCODE -ne 0) {
            throw "Visual regression comparison failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}
finally {
    if (Test-Path -LiteralPath $extractRoot) {
        Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "Visual regression artifacts: $outputRoot"
