Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$platformRoot = Join-Path $workspaceRoot 'platform'
. (Join-Path $PSScriptRoot 'Assertions.ps1')

Write-TestStep 'Checking platform monorepo files'
Assert-True -Condition (Test-Path -LiteralPath (Join-Path $platformRoot 'package.json'))
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
$clarifyScreen = Get-Content (Join-Path $platformRoot 'apps\client\app\practice\asking\clarify.tsx') -Raw
Assert-Match -Actual $clarifyScreen -Pattern 'apiClient.speechToText'
Assert-Match -Actual $clarifyScreen -Pattern 'apiClient.checkClarify'
Assert-Match -Actual $clarifyScreen -Pattern 'MediaRecorder'
$adminScreen = Get-Content (Join-Path $platformRoot 'apps\client\app\admin.tsx') -Raw
Assert-Match -Actual $adminScreen -Pattern 'apiClient.getAdminContent'
Assert-Match -Actual $adminScreen -Pattern 'apiClient.saveAdminContent'

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

Write-Host 'Platform architecture tests passed.'

