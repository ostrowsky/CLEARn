Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$platformRoot = Join-Path $workspaceRoot 'platform'
. (Join-Path $PSScriptRoot 'Assertions.ps1')

Write-TestStep 'Checking unified platform admin screen wiring'
$adminScreenPath = Join-Path $platformRoot 'apps\client\app\admin.tsx'
Assert-True -Condition (Test-Path -LiteralPath $adminScreenPath)
$adminScreen = Get-Content -LiteralPath $adminScreenPath -Raw
$adminContentHelpersPath = Join-Path $platformRoot 'apps\\client\\src\\lib\\adminContent.ts'
$adminContentHelpers = Get-Content -LiteralPath $adminContentHelpersPath -Raw
foreach ($pattern in @(
    'CLEARn content admin',
    'Open learner app',
    'Refresh admin',
    'Save content',
    'Reload from disk',
    'Upload media',
    'Open asset'
)) {
    Assert-True -Condition ($adminScreen -cnotmatch $pattern) -Message "Platform admin screen still hardcodes '$pattern'."
}
foreach ($pattern in @(
    'getAdminText',
    'function getAdminAuthText',
    "getAdminAuthText\(content, 'loginButton', 'Log in'\)",
    "getAdminAuthText\(content, 'forgotPasswordButton', 'Forgot password\?'\)",
    "getAdminAuthText\(content, 'resetButton', 'Reset password'\)",
    "getAdminAuthText\(content, 'backToLoginButton', 'Back to login'\)",
    'getTaxonomyValues',
    'pickWebFileAsBase64',
    'moveItem',
    'handleMoveBlock',
    'handleMoveMaterial',
    'isAnsweringPracticeBlock',
    'readAnsweringQuestionTypeConfig',
    'readAnsweringReactionOptions',
    'ensureAnsweringQuestionTypeConfig',
    'handleUpdateReactionSelectorLabel',
    'handleAddReactionOption',
    'handleUpdateReactionOption',
    'handleMoveReactionOption',
    'handleDeleteReactionOption',
    'fieldLabels.selectorLabel',
    'fieldLabels.reactionOptions',
    'actions.moveUp',
    'actions.moveDown',
    'handleDownloadBackup',
    'handleRestoreBackup',
    'handleUploadMaterial',
    'apiClient.getAdminContent',
    'apiClient.getAdminAuthStatus',
    'apiClient.setupAdminAuth',
    'apiClient.loginAdmin',
    'apiClient.resetAdminPassword',
    'apiClient.logoutAdmin',
    'apiClient.saveAdminContent',
    'apiClient.getAdminBackupExportUrl',
    'apiClient.restoreAdminBackup',
    'apiClient.uploadAdminMedia',
    'apiClient.deleteAdminMedia',
    'useRef<AppContent \| null>\(null\)',
    'contentRef\.current = next',
    'function updateMetaContent',
    'setMetaDraft\(JSON\.stringify\(next\.meta \|\| \{}, null, 2\)\)',
    'const currentContent = contentRef\.current \|\| content',
    'createSectionTemplate',
    'applySectionTypeTemplate',
    'createBlockTemplate',
    'createMaterialTemplate',
    'updateWatermarkText',
    'watermarkText'
)) {
    Assert-Match -Actual $adminScreen -Pattern $pattern
}
Assert-Match -Actual $adminContentHelpers -Pattern "title: 'New material'"

Write-TestStep 'Checking shared platform admin API surface'
$apiClientSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\src\lib\api.ts') -Raw
foreach ($pattern in @(
    'getAdminContent',
    'getAdminAuthStatus',
    'setupAdminAuth',
    'loginAdmin',
    'resetAdminPassword',
    'logoutAdmin',
    'saveAdminContent',
    'getAdminBackupExportUrl',
    'restoreAdminBackup',
    'uploadAdminMedia',
    'deleteAdminMedia'
)) {
    Assert-Match -Actual $apiClientSource -Pattern $pattern
}
$envSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\config\env.ts') -Raw
Assert-Match -Actual $envSource -Pattern 'HTTP_BODY_LIMIT_BYTES'
foreach ($pattern in @(
    'APP_STORAGE_ROOT',
    'MEDIA_UPLOADS_PATH',
    'CORS_ALLOWED_ORIGINS',
    'ADMIN_SESSION_SECRET must be set',
    'ADMIN_COOKIE_CROSS_SITE',
    'CORS_ALLOWED_ORIGINS must list at least one production web origin',
    'APP_STORAGE_ROOT or explicit durable DEV_CONTENT_PATH, ADMIN_AUTH_PATH, and MEDIA_UPLOADS_PATH must be configured in production',
    'resolveStoragePath',
    "APP_ENV === 'production'"
)) {
    Assert-Match -Actual $envSource -Pattern $pattern
}
$indexSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\index.ts') -Raw
Assert-Match -Actual $indexSource -Pattern 'bodyLimit: env.HTTP_BODY_LIMIT_BYTES'
Assert-Match -Actual $indexSource -Pattern 'function getCorsOrigin'
Assert-Match -Actual $indexSource -Pattern 'origin: getCorsOrigin\(\)'
Assert-True -Condition ($indexSource -cnotmatch 'origin: true') -Message 'Production API must not reflect arbitrary CORS origins.'
$routesSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\routes\registerRoutes.ts') -Raw
foreach ($pattern in @(
    '/api/admin/content',
    '/api/admin/auth/status',
    '/api/admin/auth/setup',
    '/api/admin/auth/login',
    '/api/admin/auth/reset-password',
    '/api/admin/auth/logout',
    '/api/admin/backup/export',
    '/api/admin/backup/import',
    '/api/admin/media/upload',
    '/api/admin/media/delete',
    '/uploads/\\*'
)) {
    Assert-Match -Actual $routesSource -Pattern $pattern
}
$mediaStoreSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\modules\content\media.store.ts') -Raw
Assert-Match -Actual $mediaStoreSource -Pattern 'env\.MEDIA_UPLOADS_PATH'
Assert-True -Condition ($mediaStoreSource -cnotmatch 'web/static/uploads') -Message 'Media store should not hardcode repository-local uploads storage.'
Assert-Match -Actual $routesSource -Pattern "env\.APP_ENV === 'production' && !await requireAdminSession\(request, reply\)"
Assert-Match -Actual $routesSource -Pattern "/api/debug/logs"
Assert-Match -Actual $routesSource -Pattern "/api/debug/log"

$adminAuthSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\modules\admin\adminAuth.service.ts') -Raw
Assert-Match -Actual $adminAuthSource -Pattern 'env\.APP_ENV === ''production'' \|\| env\.ADMIN_COOKIE_CROSS_SITE'
Assert-Match -Actual $adminAuthSource -Pattern 'SameSite=None'
Assert-Match -Actual $adminAuthSource -Pattern 'Secure'

$clientConfigSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\src\lib\config.ts') -Raw
Assert-Match -Actual $clientConfigSource -Pattern 'function getLocalWebApiBaseUrl'
Assert-Match -Actual $clientConfigSource -Pattern 'function getEnvApiBaseUrl'
Assert-Match -Actual $clientConfigSource -Pattern 'const localWebApiBaseUrl = getLocalWebApiBaseUrl\(\)'
Assert-Match -Actual $clientConfigSource -Pattern 'if \(localWebApiBaseUrl\) \{\s*return localWebApiBaseUrl;\s*\}'
Assert-Match -Actual $clientConfigSource -Pattern 'const envApiBaseUrl = getEnvApiBaseUrl\(\)'
Assert-Match -Actual $clientConfigSource -Pattern 'if \(envApiBaseUrl\) \{\s*return envApiBaseUrl;\s*\}'
$localApiIndex = $clientConfigSource.IndexOf('const localWebApiBaseUrl = getLocalWebApiBaseUrl()')
$envApiIndex = $clientConfigSource.IndexOf('const envApiBaseUrl = getEnvApiBaseUrl()')
$productionApiIndex = $clientConfigSource.IndexOf('return productionApiBaseUrl')
Assert-True -Condition ($localApiIndex -ge 0 -and $envApiIndex -ge 0 -and $productionApiIndex -ge 0 -and $localApiIndex -lt $envApiIndex -and $envApiIndex -lt $productionApiIndex) -Message 'Local web admin must prefer localhost API, while public previews must prefer EXPO_PUBLIC_API_BASE_URL before production API.'
Assert-Match -Actual $clientConfigSource -Pattern '\$\{protocol\}//\$\{hostname\}:4000'

Write-TestStep 'Checking share preview exposes learner and admin routes'
$sharePreviewSource = Get-Content -LiteralPath (Join-Path $platformRoot 'open-share-preview.ps1') -Raw
foreach ($pattern in @(
    'Public learner preview:',
    'Public admin preview:',
    'Local learner preview:',
    'Local admin preview:',
    'Invoke-PublicPreviewSmoke',
    'Public smoke test failed',
    'Invoke-PreviewPreflight',
    'Running quick preview preflight tests',
    'CLEARN_RUN_FULL_TESTS',
    '-RunFullTests',
    'Skipping full test suite for fast preview startup',
    'Stop-PreviousPreview',
    'Stopping previous CLEARn preview processes if any',
    'Stop-PreviewProcessesFromSummary',
    'Stop-PreviewProcessesByCommandLine',
    'Stop-ProcessOnPort',
    'previous CLEARn process on port',
    'public API health',
    'public API content',
    '\$maxPreviewAttempts = 3',
    'Retrying public preview with fresh tunnels',
    '\$env:LLM_STT_PROVIDER = ''selfhosted''',
    '\$env:ADMIN_COOKIE_CROSS_SITE=''true''',
    'SELF_HOSTED_SPEECH_BASE_URL=''http://localhost:8010/v1''',
    'Starting local free STT server',
    'Wait-ForLocalSttWarmup',
    'Warming local STT model before exposing the preview',
    'http://127.0.0.1:\$localSttPort/v1/warmup',
    'http://127.0.0.1:\$localSttPort/v1/health',
    'Local STT runtime log:',
    '/sections',
    '/admin',
    'Expo admin route did not become ready'
)) {
    Assert-Match -Actual $sharePreviewSource -Pattern $pattern
}

Write-Host 'Platform admin tests passed.'

