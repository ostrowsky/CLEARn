Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Assertions.ps1')
. (Join-Path $projectRoot 'app\ContentStore.ps1')

$testRoot = Join-Path $projectRoot ('tmp-tests-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $testRoot | Out-Null

try {
    Write-TestStep 'Content store creates a default file'
    Ensure-ContentStore -ProjectRoot $testRoot
    Assert-True -Condition (Test-Path -LiteralPath (Join-Path $testRoot 'data\content.json'))

    Write-TestStep 'Content store can load and save sections'
    $content = Get-AppContent -ProjectRoot $testRoot
    Assert-True -Condition ($content.sections.Count -ge 1)
    $content.sections[0].title = 'Changed title'
    $saved = Save-AppContent -ProjectRoot $testRoot -ContentObject $content
    Assert-Equal -Expected 'Changed title' -Actual $saved.sections[0].title

    Write-TestStep 'Uploaded media can be created and removed'
    $upload = Save-UploadedMedia -ProjectRoot $testRoot -FileName 'demo.txt' -Base64Data ([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('demo')))
    Assert-Match -Actual $upload.url -Pattern '^/uploads/'
    $deleted = Remove-UploadedMedia -ProjectRoot $testRoot -Url $upload.url
    Assert-True -Condition $deleted.deleted
}
finally {
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host 'Content store tests passed.'
