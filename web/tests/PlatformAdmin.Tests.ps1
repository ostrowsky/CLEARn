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
    'SOFTskills content admin',
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
    'createMaterialTemplate'
)) {
    Assert-Match -Actual $adminScreen -Pattern $pattern
}
Assert-Match -Actual $adminContentHelpers -Pattern "title: 'New material'"

Write-TestStep 'Checking shared platform admin API surface'
$apiClientSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\src\lib\api.ts') -Raw
foreach ($pattern in @(
    'getAdminContent',
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
$indexSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\index.ts') -Raw
Assert-Match -Actual $indexSource -Pattern 'bodyLimit: env.HTTP_BODY_LIMIT_BYTES'
$routesSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\routes\registerRoutes.ts') -Raw
foreach ($pattern in @(
    '/api/admin/content',
    '/api/admin/backup/export',
    '/api/admin/backup/import',
    '/api/admin/media/upload',
    '/api/admin/media/delete',
    '/uploads/\\*'
)) {
    Assert-Match -Actual $routesSource -Pattern $pattern
}

Write-TestStep 'Checking share preview exposes learner and admin routes'
$sharePreviewSource = Get-Content -LiteralPath (Join-Path $platformRoot 'open-share-preview.ps1') -Raw
foreach ($pattern in @(
    'Public learner preview:',
    'Public admin preview:',
    'Local learner preview:',
    'Local admin preview:',
    '/sections',
    '/admin',
    'Expo admin route did not become ready'
)) {
    Assert-Match -Actual $sharePreviewSource -Pattern $pattern
}

Write-Host 'Platform admin tests passed.'

