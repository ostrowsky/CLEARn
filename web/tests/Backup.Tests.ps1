Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$backupScript = Join-Path $workspaceRoot 'platform\backup-app.ps1'
$restoreScript = Join-Path $workspaceRoot 'platform\restore-app.ps1'
. (Join-Path $PSScriptRoot 'Assertions.ps1')

function Write-Utf8NoBomFile {
    param(
        [string]$Path,
        [string]$Content
    )

    $directory = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

Write-TestStep 'Backup scripts exist'
Assert-True -Condition (Test-Path -LiteralPath $backupScript -PathType Leaf) -Message 'backup-app.ps1 is missing.'
Assert-True -Condition (Test-Path -LiteralPath $restoreScript -PathType Leaf) -Message 'restore-app.ps1 is missing.'

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('softskills-backup-test-' + [Guid]::NewGuid().ToString('N'))
$extractRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('softskills-backup-extract-' + [Guid]::NewGuid().ToString('N'))
$backupZip = Join-Path ([System.IO.Path]::GetTempPath()) ('softskills-backup-' + [Guid]::NewGuid().ToString('N') + '.zip')

try {
    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
    Write-Utf8NoBomFile -Path (Join-Path $tempRoot 'start-cloudflare-preview.bat') -Content '@echo off'
    Write-Utf8NoBomFile -Path (Join-Path $tempRoot 'platform\README.md') -Content 'platform readme v1'
    Write-Utf8NoBomFile -Path (Join-Path $tempRoot 'platform\apps\client\app.txt') -Content 'client app v1'
    Write-Utf8NoBomFile -Path (Join-Path $tempRoot 'platform\share-preview-links.txt') -Content 'do not backup this runtime file'
    Write-Utf8NoBomFile -Path (Join-Path $tempRoot 'web\README.md') -Content 'web readme v1'
    Write-Utf8NoBomFile -Path (Join-Path $tempRoot 'web\data\content.json') -Content '{"meta":{"updatedAt":"2026-04-02T12:00:00Z"},"sections":[]}'
    Write-Utf8NoBomFile -Path (Join-Path $tempRoot 'web\data\content.template.json') -Content '{"meta":{"updatedAt":"2026-04-02T12:00:00Z"},"sections":[]}'
    Write-Utf8NoBomFile -Path (Join-Path $tempRoot 'web\static\uploads\audio.mp3') -Content 'binary-audio-placeholder'
    Write-Utf8NoBomFile -Path (Join-Path $tempRoot 'platform\node_modules\ignored.txt') -Content 'ignore me'
    Write-Utf8NoBomFile -Path (Join-Path $tempRoot 'tmp-platform-api-deadbeef\ignored.txt') -Content 'ignore me too'

    Write-TestStep 'Backup script creates a full archive with manifest and excludes runtime junk'
    & powershell -ExecutionPolicy Bypass -File $backupScript -ProjectRoot $tempRoot -OutputPath $backupZip -Overwrite | Out-Null
    Assert-True -Condition (Test-Path -LiteralPath $backupZip -PathType Leaf) -Message 'Backup archive was not created.'

    Expand-Archive -LiteralPath $backupZip -DestinationPath $extractRoot -Force
    $manifestPath = Join-Path $extractRoot 'backup-manifest.json'
    Assert-True -Condition (Test-Path -LiteralPath $manifestPath -PathType Leaf) -Message 'Backup archive is missing backup-manifest.json.'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    Assert-True -Condition (@($manifest.includedRoots) -contains 'platform') -Message 'Backup manifest is missing the platform root.'
    Assert-True -Condition (@($manifest.includedRoots) -contains 'web') -Message 'Backup manifest is missing the web root.'
    Assert-True -Condition (@($manifest.includedFiles) -contains 'start-cloudflare-preview.bat') -Message 'Backup manifest is missing the launcher file.'
    Assert-True -Condition (Test-Path -LiteralPath (Join-Path $extractRoot 'platform\README.md') -PathType Leaf) -Message 'Platform README was not backed up.'
    Assert-True -Condition (Test-Path -LiteralPath (Join-Path $extractRoot 'web\data\content.json') -PathType Leaf) -Message 'Live content was not backed up.'
    Assert-True -Condition (Test-Path -LiteralPath (Join-Path $extractRoot 'web\static\uploads\audio.mp3') -PathType Leaf) -Message 'Uploaded media was not backed up.'
    Assert-True -Condition (-not (Test-Path -LiteralPath (Join-Path $extractRoot 'platform\node_modules\ignored.txt'))) -Message 'node_modules content should not be backed up.'
    Assert-True -Condition (-not (Test-Path -LiteralPath (Join-Path $extractRoot 'platform\share-preview-links.txt'))) -Message 'Runtime preview link files should not be backed up.'
    Assert-True -Condition (-not (Test-Path -LiteralPath (Join-Path $extractRoot 'tmp-platform-api-deadbeef\ignored.txt'))) -Message 'Temporary platform folders should not be backed up.'

    Write-TestStep 'Restore script replaces mutated app files with the backup contents'
    Write-Utf8NoBomFile -Path (Join-Path $tempRoot 'platform\README.md') -Content 'platform readme mutated'
    Write-Utf8NoBomFile -Path (Join-Path $tempRoot 'web\data\content.json') -Content '{"meta":{"updatedAt":"2099-01-01T00:00:00Z"},"sections":[{"id":"mutated"}]}'
    Write-Utf8NoBomFile -Path (Join-Path $tempRoot 'platform\extra.txt') -Content 'should disappear after restore'

    $restoreRaw = & powershell -ExecutionPolicy Bypass -File $restoreScript -ProjectRoot $tempRoot -BackupFile $backupZip
    $restoreResult = ($restoreRaw | Select-Object -Last 1) | ConvertFrom-Json
    Assert-True -Condition ([bool]$restoreResult.restored) -Message 'Restore script did not report success.'
    Assert-True -Condition ([bool]$restoreResult.restartRequired) -Message 'Restore script should require a restart after a full restore.'
    Assert-Equal -Expected 'platform readme v1' -Actual (Get-Content -LiteralPath (Join-Path $tempRoot 'platform\README.md') -Raw)
    Assert-Match -Actual (Get-Content -LiteralPath (Join-Path $tempRoot 'web\data\content.json') -Raw) -Pattern '2026-04-02T12:00:00Z'
    Assert-True -Condition (-not (Test-Path -LiteralPath (Join-Path $tempRoot 'platform\extra.txt'))) -Message 'Restore script should remove files that are no longer present in the backup.'
    Assert-True -Condition (Test-Path -LiteralPath (Join-Path $tempRoot 'web\static\uploads\audio.mp3') -PathType Leaf) -Message 'Restore script should bring back uploaded media.'

    Write-Host 'Backup tests passed.'
}
finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $backupZip -Force -ErrorAction SilentlyContinue
}