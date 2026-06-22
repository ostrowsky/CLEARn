Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$platformRoot = Join-Path $workspaceRoot 'platform'
. (Join-Path $PSScriptRoot 'Assertions.ps1')

Write-TestStep 'Checking Vercel Analytics frontend wiring'
$clientPackage = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\package.json') -Raw
$clientLayout = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\app\_layout.tsx') -Raw
$injectScript = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\scripts\inject-vercel-analytics.mjs') -Raw
$deploymentSpec = Get-Content -LiteralPath (Join-Path $workspaceRoot 'docs\specs\features\deployment-readiness.md') -Raw

Assert-True -Condition ($clientPackage -notmatch '"@vercel/analytics"') -Message 'Expo Router static export should not make Vercel Analytics part of the Metro dependency graph.'
Assert-Match -Actual $clientPackage -Pattern 'expo export --platform web && node ./scripts/inject-vercel-analytics\.mjs'
Assert-True -Condition ($clientLayout -notmatch '@vercel/analytics') -Message 'Root layout should not import Vercel Analytics through Metro.'
Assert-Match -Actual $injectScript -Pattern 'dist'
Assert-Match -Actual $injectScript -Pattern 'index\.html'
Assert-Match -Actual $injectScript -Pattern '/_vercel/insights/script\.js'
Assert-True -Condition ($injectScript -notmatch '@vercel/analytics/next') -Message 'Expo Router static web must not use the Next.js-only analytics entrypoint.'
Assert-Match -Actual $deploymentSpec -Pattern 'Vercel Analytics'
Assert-Match -Actual $deploymentSpec -Pattern 'post-export'

Write-Host 'Vercel Analytics tests passed.'
