Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Assertions.ps1')

Write-TestStep 'Admin HTML wires the UI shell'
$adminHtml = Get-Content (Join-Path $projectRoot 'static\admin.html') -Raw
Assert-Match -Actual $adminHtml -Pattern 'id="admin-app"'
Assert-Match -Actual $adminHtml -Pattern 'admin\.css'
Assert-Match -Actual $adminHtml -Pattern 'admin\.js'

Write-TestStep 'Admin script exposes CRUD actions, schema editors, and media flows'
$adminScript = Get-Content (Join-Path $projectRoot 'static\admin.js') -Raw
foreach ($pattern in @(
    'save-content',
    'reload',
    'add-section',
    'delete-section',
    'add-block',
    'delete-block',
    'add-material',
    'delete-material',
    'upload-media',
    'delete-media',
    'metaDraft',
    'schemaDrafts',
    'data-level="meta"',
    'data-level="schema"',
    'renderSchemaEditor',
    'syncSchemaDraftsFromContent',
    'applySchemaDrafts',
    'getTaxonomyValues',
    'getTaxonomyOptions',
    '/api/admin/content',
    '/api/admin/media/upload',
    '/api/admin/media/delete'
)) {
    Assert-Match -Actual $adminScript -Pattern $pattern
}

Write-TestStep 'Admin script reads supported types from content schema instead of constants'
foreach ($pattern in @(
    'taxonomiesTitle',
    'defaultsTitle',
    'sectionViewsTitle',
    'blockRenderersTitle',
    'practiceScreensTitle',
    'blockGroupsTitle'
)) {
    Assert-Match -Actual $adminScript -Pattern $pattern
}
Assert-True -Condition ($adminScript -cnotmatch 'SECTION_TYPES') -Message 'Admin script still hardcodes section types.'
Assert-True -Condition ($adminScript -cnotmatch 'BLOCK_KINDS') -Message 'Admin script still hardcodes block kinds.'
Assert-True -Condition ($adminScript -cnotmatch 'MATERIAL_TYPES') -Message 'Admin script still hardcodes material types.'

Write-Host 'Admin UI tests passed.'
