Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$platformRoot = Join-Path $workspaceRoot 'platform'
. (Join-Path $PSScriptRoot 'Assertions.ps1')

Write-TestStep 'Checking platform monorepo files'
Assert-True -Condition (Test-Path -LiteralPath (Join-Path $workspaceRoot 'package.json'))
Assert-True -Condition (Test-Path -LiteralPath (Join-Path $workspaceRoot 'vercel.json'))
Assert-True -Condition (Test-Path -LiteralPath (Join-Path $workspaceRoot 'render.yaml'))
Assert-True -Condition (Test-Path -LiteralPath (Join-Path $workspaceRoot '.github\branch-protection-main.json'))
Assert-True -Condition (Test-Path -LiteralPath (Join-Path $workspaceRoot 'docs\deployment\production-hosting.md'))
Assert-True -Condition (Test-Path -LiteralPath (Join-Path $platformRoot 'package.json'))
Assert-True -Condition (Test-Path -LiteralPath (Join-Path $platformRoot '.env.production.example'))
Assert-True -Condition (Test-Path -LiteralPath (Join-Path $platformRoot 'apps\api\src\index.ts'))
Assert-True -Condition (Test-Path -LiteralPath (Join-Path $platformRoot 'apps\client\app\_layout.tsx'))
Assert-True -Condition (Test-Path -LiteralPath (Join-Path $platformRoot 'apps\client\app\admin.tsx'))
Assert-True -Condition (Test-Path -LiteralPath (Join-Path $platformRoot 'packages\domain\src\index.ts'))
Assert-True -Condition (Test-Path -LiteralPath (Join-Path $platformRoot 'packages\contracts\src\api.ts'))
Assert-True -Condition (Test-Path -LiteralPath (Join-Path $platformRoot 'open-share-preview.ps1'))
Assert-True -Condition (Test-Path -LiteralPath (Join-Path $platformRoot 'save-hf-token.ps1'))
Assert-True -Condition (Test-Path -LiteralPath (Join-Path $workspaceRoot 'start-cloudflare-preview.bat'))

Write-TestStep 'Checking scalable backend architecture markers'
$apiIndex = Get-Content (Join-Path $platformRoot 'apps\api\src\index.ts') -Raw
Assert-Match -Actual $apiIndex -Pattern 'Fastify'
$routes = Get-Content (Join-Path $platformRoot 'apps\api\src\routes\registerRoutes.ts') -Raw
Assert-Match -Actual $routes -Pattern "adminSessionMode: 'signed-cookie'"
Assert-Match -Actual $routes -Pattern "youtubeTranscriptFetcher: env\.TRANSCRIPT_FETCH_PROVIDER === 'browserless' \? 'browserless-function' : 'android-innertube-timedtext'"
Assert-Match -Actual $routes -Pattern 'RedisSessionStore'
Assert-Match -Actual $routes -Pattern '/api/speech/stt'
Assert-Match -Actual $routes -Pattern '/api/admin/content'
Assert-Match -Actual $routes -Pattern '/api/admin/media/upload'
Assert-Match -Actual $routes -Pattern '/uploads/\\*'
$registry = Get-Content (Join-Path $platformRoot 'apps\api\src\providers\providerRegistry.ts') -Raw
Assert-Match -Actual $registry -Pattern 'huggingface'
Assert-Match -Actual $registry -Pattern 'openai'
Assert-Match -Actual $registry -Pattern 'selfhosted'

Write-TestStep 'Checking Expo shared frontend markers'
$clientPackage = Get-Content (Join-Path $platformRoot 'apps\client\package.json') -Raw
Assert-Match -Actual $clientPackage -Pattern 'expo-router'
Assert-Match -Actual $clientPackage -Pattern 'react-native'
Assert-Match -Actual $clientPackage -Pattern 'sync-static-content\.mjs'
Assert-Match -Actual $clientPackage -Pattern 'verify-production-api-env\.mjs'
$staticContentSync = Get-Content (Join-Path $platformRoot 'apps\client\scripts\sync-static-content.mjs') -Raw
Assert-Match -Actual $staticContentSync -Pattern 'web'
Assert-Match -Actual $staticContentSync -Pattern 'content\.json'
Assert-Match -Actual $staticContentSync -Pattern 'content\.snapshot\.json'
Assert-Match -Actual $staticContentSync -Pattern 'web.*static.*uploads'
Assert-Match -Actual $staticContentSync -Pattern 'public.*uploads'
$productionApiEnvCheck = Get-Content (Join-Path $platformRoot 'apps\client\scripts\verify-production-api-env.mjs') -Raw
Assert-Match -Actual $productionApiEnvCheck -Pattern 'EXPO_PUBLIC_API_BASE_URL is required'
Assert-Match -Actual $productionApiEnvCheck -Pattern 'Admin, AI generation, STT, TTS, uploads, and backups'
Assert-Match -Actual $productionApiEnvCheck -Pattern 'ALLOW_STATIC_ONLY_PREVIEW'
Assert-Match -Actual $productionApiEnvCheck -Pattern 'must point to the production API host'
$clarifyScreen = Get-Content (Join-Path $platformRoot 'apps\client\app\practice\asking\clarify.tsx') -Raw
Assert-Match -Actual $clarifyScreen -Pattern 'apiClient.speechToText'
Assert-Match -Actual $clarifyScreen -Pattern 'apiClient.checkClarify'
Assert-Match -Actual $clarifyScreen -Pattern 'MediaRecorder'
$adminScreen = Get-Content (Join-Path $platformRoot 'apps\client\app\admin.tsx') -Raw
Assert-Match -Actual $adminScreen -Pattern 'apiClient.getAdminContent'
Assert-Match -Actual $adminScreen -Pattern 'apiClient.saveAdminContent'
$clientConfig = Get-Content (Join-Path $platformRoot 'apps\client\src\lib\config.ts') -Raw
$clientApi = Get-Content (Join-Path $platformRoot 'apps\client\src\lib\api.ts') -Raw
$clientRoot = Get-Content (Join-Path $platformRoot 'apps\client\app\index.tsx') -Raw
$clientSections = Get-Content (Join-Path $platformRoot 'apps\client\app\(tabs)\sections.tsx') -Raw
Assert-Match -Actual $clientConfig -Pattern 'EXPO_PUBLIC_API_BASE_URL'
Assert-Match -Actual $clientConfig -Pattern 'productionApiBaseUrl'
Assert-Match -Actual $clientConfig -Pattern 'clearn-api\.onrender\.com'
Assert-Match -Actual $clientConfig -Pattern 'hostname.*localhost'
Assert-Match -Actual $clientApi -Pattern 'staticContent'
Assert-Match -Actual $clientApi -Pattern 'load:static-fallback'
Assert-Match -Actual $clientRoot -Pattern 'SectionsScreen'
Assert-Match -Actual $clientSections -Pattern 'window\.location\.pathname === ''/sections'''
Assert-Match -Actual $clientSections -Pattern '<Redirect href="/"'

Write-TestStep 'Checking unified platform preview markers'
$sharePreview = Get-Content (Join-Path $platformRoot 'open-share-preview.ps1') -Raw
Assert-Match -Actual $sharePreview -Pattern 'Public learner preview:'
Assert-Match -Actual $sharePreview -Pattern 'Public admin preview:'
Assert-Match -Actual $sharePreview -Pattern '/sections'
Assert-Match -Actual $sharePreview -Pattern '/admin'
Assert-Match -Actual $sharePreview -Pattern 'Get-PersistedEnvValue'
Assert-Match -Actual $sharePreview -Pattern 'HF_TOKEN'
Assert-Match -Actual $sharePreview -Pattern 'API runtime log:'
Assert-Match -Actual $sharePreview -Pattern 'Client runtime log:'

$mobilePreview = Get-Content (Join-Path $platformRoot 'open-mobile-preview.ps1') -Raw
Assert-Match -Actual $mobilePreview -Pattern 'Get-PersistedEnvValue'
Assert-Match -Actual $mobilePreview -Pattern 'HF_TOKEN'

$saveTokenScript = Get-Content (Join-Path $platformRoot 'save-hf-token.ps1') -Raw
Assert-Match -Actual $saveTokenScript -Pattern 'SetEnvironmentVariable'
Assert-Match -Actual $saveTokenScript -Pattern 'HF_TOKEN'

Write-TestStep 'Checking production CI hardening markers'
$ciWorkflow = Get-Content -LiteralPath (Join-Path $workspaceRoot '.github\workflows\ci.yml') -Raw
foreach ($pattern in @(
    'pnpm audit --prod --audit-level high',
    'linux-build-smoke',
    'ubuntu-latest',
    'Smoke API runtime on Linux',
    'Smoke API runtime'
)) {
    Assert-Match -Actual $ciWorkflow -Pattern $pattern
}

Write-TestStep 'Checking Vercel frontend and PR description gates'
$rootPackage = Get-Content -LiteralPath (Join-Path $workspaceRoot 'package.json') -Raw
$vercelConfig = Get-Content -LiteralPath (Join-Path $workspaceRoot 'vercel.json') -Raw
$vercelNpmPrep = Get-Content -LiteralPath (Join-Path $platformRoot 'scripts\prepare-vercel-npm-install.mjs') -Raw
$prTemplate = Get-Content -LiteralPath (Join-Path $workspaceRoot '.github\pull_request_template.md') -Raw
$prDescriptionWorkflow = Get-Content -LiteralPath (Join-Path $workspaceRoot '.github\workflows\pr-description.yml') -Raw
$prDescriptionScript = Get-Content -LiteralPath (Join-Path $workspaceRoot 'tools\prepare-pr-description.ps1') -Raw
$branchProtection = Get-Content -LiteralPath (Join-Path $workspaceRoot '.github\branch-protection-main.json') -Raw
$hostingPlan = Get-Content -LiteralPath (Join-Path $workspaceRoot 'docs\deployment\production-hosting.md') -Raw
$productionEnvExample = Get-Content -LiteralPath (Join-Path $platformRoot '.env.production.example') -Raw
$renderBlueprint = Get-Content -LiteralPath (Join-Path $workspaceRoot 'render.yaml') -Raw
foreach ($pattern in @(
    'vercel-build',
    'cd platform && pnpm --filter @clearn/client build'
)) {
    Assert-Match -Actual $rootPackage -Pattern $pattern
}
foreach ($pattern in @(
    '"outputDirectory": "platform/apps/client/dist"',
    '"buildCommand": "cd platform && npm run --workspace @clearn/client build"',
    '"installCommand": "cd platform && node ./scripts/prepare-vercel-npm-install.mjs && npm install --legacy-peer-deps"',
    '"destination": "/index.html"'
)) {
    Assert-Match -Actual $vercelConfig -Pattern $pattern
}
foreach ($pattern in @(
    'workspace:\*',
    'file:../../packages/contracts',
    'file:../../packages/domain',
    'expo-linking',
    '~7.0.5'
)) {
    Assert-Match -Actual $vercelNpmPrep -Pattern $pattern
}
Assert-True -Condition ($vercelConfig -cnotmatch '"framework"') -Message 'Vercel config should not use a nullable framework override.'
Assert-True -Condition ($vercelConfig -cnotmatch '\?!') -Message 'Vercel SPA fallback should avoid complex negative-lookahead rewrites.'
foreach ($pattern in @('## What', '## Why', '## Changes')) {
    Assert-Match -Actual $prTemplate -Pattern $pattern
    Assert-Match -Actual $prDescriptionWorkflow -Pattern $pattern
    Assert-Match -Actual $prDescriptionScript -Pattern $pattern
}
Assert-Match -Actual $prDescriptionWorkflow -Pattern 'Use the pr-description skill format'
Assert-Match -Actual $prDescriptionScript -Pattern 'pr-description\\SKILL\.md'
foreach ($pattern in @(
    'test-and-build',
    'linux-build-smoke',
    'validate-pr-description',
    'allow_force_pushes',
    'allow_deletions'
)) {
    Assert-Match -Actual $branchProtection -Pattern $pattern
}
foreach ($pattern in @(
    'Vercel',
    'Render',
    'render.yaml',
    'api.clearn.me',
    '/api/health',
    'APP_STORAGE_ROOT=/var/lib/clearn',
    'EXPO_PUBLIC_API_BASE_URL',
    'gh api --method PUT repos/ostrowsky/CLEARn/branches/main/protection'
)) {
    Assert-Match -Actual $hostingPlan -Pattern $pattern
}
foreach ($pattern in @(
    'type: web',
    'name: clearn-api',
    'type: keyvalue',
    'name: clearn-redis',
    'buildCommand: cd platform && corepack enable && corepack prepare pnpm@10.8.0 --activate',
    'pnpm install --frozen-lockfile',
    'pip install -r apps/api/requirements.txt',
    'pnpm --filter @clearn/api build',
    'startCommand: cd platform && corepack enable && corepack prepare pnpm@10.8.0 --activate && pnpm --filter @clearn/api start',
    'healthCheckPath: /api/health',
    'mountPath: /var/lib/clearn',
    'APP_BASE_URL',
    'https://api.clearn.me',
    'CORS_ALLOWED_ORIGINS',
    'https://clearn.me,https://www.clearn.me',
    'ADMIN_SESSION_SECRET',
    'generateValue: true',
    'REDIS_URL',
    'fromService:',
    'property: connectionString',
    'HF_TOKEN',
    'sync: false'
)) {
    Assert-Match -Actual $renderBlueprint -Pattern ([regex]::Escape($pattern))
}
$legacyDeploymentIdentifierPattern = '@' + 'soft' + 'skills|SOFT' + 'skills|soft' + 'skills'
foreach ($source in @($rootPackage, $vercelConfig, $hostingPlan, $renderBlueprint)) {
    Assert-True -Condition ($source -cnotmatch $legacyDeploymentIdentifierPattern) -Message 'Deployment metadata must not reference removed legacy app identifiers.'
}
foreach ($pattern in @(
    'APP_ENV=production',
    'APP_STORAGE_ROOT=/var/lib/clearn',
    'ADMIN_SESSION_SECRET',
    'CORS_ALLOWED_ORIGINS',
    'REDIS_URL',
    'TRANSCRIPT_FETCH_PROVIDER',
    'BROWSERLESS_API_URL',
    'BROWSERLESS_API_KEY',
    'BROWSERLESS_USE_RESIDENTIAL_PROXY',
    'EXPO_PUBLIC_API_BASE_URL',
    'ALLOW_STATIC_ONLY_PREVIEW=0'
)) {
    Assert-Match -Actual $productionEnvExample -Pattern $pattern
}

$apiEnvSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\config\env.ts') -Raw
Assert-Match -Actual $apiEnvSource -Pattern 'REDIS_URL must point to production Redis in production'
Assert-Match -Actual $apiEnvSource -Pattern "TRANSCRIPT_FETCH_PROVIDER: z\.enum\(\['auto', 'browserless', 'direct'\]\)"
Assert-Match -Actual $apiEnvSource -Pattern 'BROWSERLESS_API_KEY'

Write-Host 'Platform architecture tests passed.'

