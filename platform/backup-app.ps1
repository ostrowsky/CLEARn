param(
    [string]$ProjectRoot = (Join-Path $PSScriptRoot '..'),
    [string]$OutputPath,
    [switch]$Overwrite
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-FullPath {
    param([string]$Path)
    return [System.IO.Path]::GetFullPath($Path)
}
function Get-RelativePath {
    param(
        [string]$BasePath,
        [string]$TargetPath
    )

    $baseFull = Resolve-FullPath -Path $BasePath
    if ((Test-Path -LiteralPath $baseFull -PathType Container) -and -not $baseFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $baseFull += [System.IO.Path]::DirectorySeparatorChar
    }

    $baseUri = New-Object System.Uri($baseFull)
    $targetUri = New-Object System.Uri((Resolve-FullPath -Path $TargetPath))
    return [System.Uri]::UnescapeDataString($baseUri.MakeRelativeUri($targetUri).ToString()).Replace('/', '\')
}

function Ensure-Directory {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Test-IncludedRelativePath {
    param([string]$RelativePath)

    $normalized = $RelativePath.Replace('/', '\')
    if ([string]::IsNullOrWhiteSpace($normalized) -or $normalized -eq '.') {
        return $false
    }

    foreach ($segment in @('.git', 'node_modules', '.expo')) {
        if ($normalized -match ('(^|\\)' + [Regex]::Escape($segment) + '(\\|$)')) {
            return $false
        }
    }

    if ($normalized -match '(^|\\)platform\\backups(\\|$)') {
        return $false
    }

    if ($normalized -match '(^|\\)tmp-platform-[^\\]+(\\|$)') {
        return $false
    }

    $leafName = [System.IO.Path]::GetFileName($normalized)
    if ($leafName -in @('share-preview-links.txt', 'share-admin-link.txt')) {
        return $false
    }

    return $true
}

$projectRootFull = Resolve-FullPath -Path $ProjectRoot
if (-not (Test-Path -LiteralPath $projectRootFull -PathType Container)) {
    throw "Project root was not found: $projectRootFull"
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $backupDirectory = Join-Path $projectRootFull 'platform\backups'
    Ensure-Directory -Path $backupDirectory
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $OutputPath = Join-Path $backupDirectory ("softskills-backup-$timestamp.zip")
}

$outputPathFull = Resolve-FullPath -Path $OutputPath
$destinationDirectory = Split-Path -Parent $outputPathFull
Ensure-Directory -Path $destinationDirectory

if (Test-Path -LiteralPath $outputPathFull) {
    if (-not $Overwrite) {
        throw "Backup file already exists: $outputPathFull"
    }

    Remove-Item -LiteralPath $outputPathFull -Force
}

$stagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('softskills-backup-' + [Guid]::NewGuid().ToString('N'))
$payloadRoot = Join-Path $stagingRoot 'payload'
Ensure-Directory -Path $payloadRoot

$includedRoots = @('platform', 'web')
$includedFiles = @('start-cloudflare-preview.bat')
$copiedFiles = New-Object System.Collections.Generic.List[string]

try {
    foreach ($root in $includedRoots) {
        $sourceRoot = Join-Path $projectRootFull $root
        if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
            continue
        }

        $files = Get-ChildItem -LiteralPath $sourceRoot -Recurse -File
        foreach ($file in $files) {
            $relativePath = Get-RelativePath -BasePath $projectRootFull -TargetPath $file.FullName
            if (-not (Test-IncludedRelativePath -RelativePath $relativePath)) {
                continue
            }

            $destinationPath = Join-Path $payloadRoot $relativePath
            Ensure-Directory -Path (Split-Path -Parent $destinationPath)
            Copy-Item -LiteralPath $file.FullName -Destination $destinationPath -Force
            [void]$copiedFiles.Add($relativePath.Replace('\', '/'))
        }
    }

    foreach ($fileName in $includedFiles) {
        $sourceFile = Join-Path $projectRootFull $fileName
        if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
            continue
        }

        $destinationFile = Join-Path $payloadRoot $fileName
        Ensure-Directory -Path (Split-Path -Parent $destinationFile)
        Copy-Item -LiteralPath $sourceFile -Destination $destinationFile -Force
        [void]$copiedFiles.Add($fileName.Replace('\', '/'))
    }

    $contentUpdatedAt = ''
    $contentPath = Join-Path $projectRootFull 'web\data\content.json'
    if (Test-Path -LiteralPath $contentPath -PathType Leaf) {
        try {
            $contentJson = Get-Content -LiteralPath $contentPath -Raw | ConvertFrom-Json
            $contentUpdatedAt = [string]$contentJson.meta.updatedAt
        } catch {
            $contentUpdatedAt = ''
        }
    }

    $manifest = [ordered]@{
        backupVersion = 1
        createdAt = (Get-Date).ToString('o')
        projectName = Split-Path -Leaf $projectRootFull
        contentUpdatedAt = $contentUpdatedAt
        includedRoots = $includedRoots
        includedFiles = $includedFiles
        fileCount = $copiedFiles.Count
        files = @($copiedFiles)
    }

    $manifestPath = Join-Path $payloadRoot 'backup-manifest.json'
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 20), $utf8NoBom)

    $itemsToArchive = Get-ChildItem -LiteralPath $payloadRoot -Force
    if (-not $itemsToArchive) {
        throw 'Backup payload is empty.'
    }

    Compress-Archive -LiteralPath $itemsToArchive.FullName -DestinationPath $outputPathFull -Force
    Write-Output $outputPathFull
}
finally {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
}