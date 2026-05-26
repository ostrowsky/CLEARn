param(
    [string]$ProjectRoot = (Join-Path $PSScriptRoot '..'),
    [string]$OutputPath,
    [switch]$Overwrite
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression

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

    foreach ($segment in @('.git', 'node_modules', '.expo', '.venv', '__pycache__', '.pytest_cache')) {
        if ($normalized -match ('(^|\\)' + [Regex]::Escape($segment) + '(\\|$)')) {
            return $false
        }
    }

    foreach ($segment in @('dist', 'build', '.next', '.turbo', 'coverage')) {
        if ($normalized -match ('(^|\\)' + [Regex]::Escape($segment) + '(\\|$)')) {
            return $false
        }
    }

    if ($normalized -match '(^|\\)platform\\backups(\\|$)') {
        return $false
    }

    if ($normalized -match '(^|\\)platform\\local-stt\\models(\\|$)') {
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

function Get-IncludedFiles {
    param(
        [string]$RootPath,
        [string]$ProjectRootPath
    )

    $pending = New-Object System.Collections.Generic.Stack[System.IO.DirectoryInfo]
    $pending.Push((Get-Item -LiteralPath $RootPath))

    while ($pending.Count -gt 0) {
        $directory = $pending.Pop()

        foreach ($file in $directory.GetFiles()) {
            $relativePath = Get-RelativePath -BasePath $ProjectRootPath -TargetPath $file.FullName
            if (Test-IncludedRelativePath -RelativePath $relativePath) {
                $file
            }
        }

        foreach ($childDirectory in $directory.GetDirectories()) {
            $relativePath = Get-RelativePath -BasePath $ProjectRootPath -TargetPath $childDirectory.FullName
            if (Test-IncludedRelativePath -RelativePath $relativePath) {
                $pending.Push($childDirectory)
            }
        }
    }
}

$projectRootFull = Resolve-FullPath -Path $ProjectRoot
if (-not (Test-Path -LiteralPath $projectRootFull -PathType Container)) {
    throw "Project root was not found: $projectRootFull"
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $backupDirectory = Join-Path $projectRootFull 'platform\backups'
    Ensure-Directory -Path $backupDirectory
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $OutputPath = Join-Path $backupDirectory ("clearn-backup-$timestamp.zip")
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

$includedRoots = @('platform', 'web')
$includedFiles = @('start-cloudflare-preview.bat')
$copiedFiles = New-Object System.Collections.Generic.List[string]

$zip = [System.IO.Compression.ZipFile]::Open($outputPathFull, [System.IO.Compression.ZipArchiveMode]::Create)
$compressionLevel = [System.IO.Compression.CompressionLevel]::Fastest
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

try {
    $filesToArchive = New-Object System.Collections.Generic.List[object]
    foreach ($root in $includedRoots) {
        $sourceRoot = Join-Path $projectRootFull $root
        if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
            continue
        }

        $files = Get-IncludedFiles -RootPath $sourceRoot -ProjectRootPath $projectRootFull
        foreach ($file in $files) {
            $relativePath = Get-RelativePath -BasePath $projectRootFull -TargetPath $file.FullName
            $entryName = $relativePath.Replace('\', '/')
            [void]$filesToArchive.Add([pscustomobject]@{
                Source = $file.FullName
                Entry = $entryName
            })
            [void]$copiedFiles.Add($entryName)
        }
    }

    foreach ($fileName in $includedFiles) {
        $sourceFile = Join-Path $projectRootFull $fileName
        if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
            continue
        }

        $entryName = $fileName.Replace('\', '/')
        [void]$filesToArchive.Add([pscustomobject]@{
            Source = $sourceFile
            Entry = $entryName
        })
        [void]$copiedFiles.Add($entryName)
    }

    if ($filesToArchive.Count -eq 0) {
        throw 'Backup payload is empty.'
    }

    foreach ($item in $filesToArchive) {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, [string]$item.Source, [string]$item.Entry, $compressionLevel) | Out-Null
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

    $manifestEntry = $zip.CreateEntry('backup-manifest.json', $compressionLevel)
    $manifestStream = $manifestEntry.Open()
    $writer = New-Object System.IO.StreamWriter($manifestStream, $utf8NoBom)
    try {
        $writer.Write(($manifest | ConvertTo-Json -Depth 20))
    } finally {
        $writer.Dispose()
        $manifestStream.Dispose()
    }
} finally {
    $zip.Dispose()
}

Write-Output $outputPathFull
