Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Assertions.ps1')

Write-TestStep 'Checking TCP server routes'
$server = Get-Content (Join-Path $projectRoot 'server.ps1') -Raw
Assert-Match -Actual $server -Pattern 'TcpListener'
Assert-Match -Actual $server -Pattern '/api/admin/content'
Assert-Match -Actual $server -Pattern '/api/admin/media/upload'
Assert-Match -Actual $server -Pattern '/api/content'

Write-TestStep 'Checking admin entry points'
$adminHtml = Get-Content (Join-Path $projectRoot 'static\admin.html') -Raw
Assert-Match -Actual $adminHtml -Pattern 'admin\.css'
Assert-Match -Actual $adminHtml -Pattern 'admin\.js'

$adminScript = Get-Content (Join-Path $projectRoot 'static\admin.js') -Raw
Assert-Match -Actual $adminScript -Pattern 'metaDraft'
Assert-Match -Actual $adminScript -Pattern 'upload-media'
Assert-Match -Actual $adminScript -Pattern '/api/admin/media/delete'

Write-TestStep 'Checking learner entry point still exists'
$index = Get-Content (Join-Path $projectRoot 'static\index.html') -Raw
Assert-Match -Actual $index -Pattern '\./app\.js'

Write-Host 'Static and server-shape tests passed.'
