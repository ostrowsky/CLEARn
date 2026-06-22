Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$platformRoot = Join-Path $workspaceRoot 'platform'
. (Join-Path $PSScriptRoot 'Assertions.ps1')

Write-TestStep 'Checking Vercel Analytics frontend wiring'
$clientPackage = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\package.json') -Raw
$clientLayout = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\app\_layout.tsx') -Raw
$deploymentSpec = Get-Content -LiteralPath (Join-Path $workspaceRoot 'docs\specs\features\deployment-readiness.md') -Raw

Assert-Match -Actual $clientPackage -Pattern '"@vercel/analytics"'
Assert-Match -Actual $clientLayout -Pattern "import \{ Analytics \} from '@vercel/analytics/react'"
Assert-Match -Actual $clientLayout -Pattern '<Analytics\s*/>'
Assert-True -Condition ($clientLayout -notmatch '@vercel/analytics/next') -Message 'Expo Router static web must use the React analytics entrypoint, not the Next.js-only entrypoint.'
Assert-Match -Actual $deploymentSpec -Pattern 'Vercel Analytics'
Assert-Match -Actual $deploymentSpec -Pattern 'Expo/React client shell'

Write-Host 'Vercel Analytics tests passed.'
