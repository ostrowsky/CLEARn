param(
    [Parameter(Mandatory = $true)]
    [string]$BackupFile,
    [string]$ProjectRoot = (Join-Path $PSScriptRoot '..')
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

function Ensure-SafeTargetPath {
    param(
        [string]$ProjectRootFull,
        [string]$TargetPath
    )

    $resolvedTarget = Resolve-FullPath -Path $TargetPath
    if (-not $resolvedTarget.StartsWith($ProjectRootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify a path outside the project root: $resolvedTarget"
    }

    return $resolvedTarget
}

$projectRootFull = Resolve-FullPath -Path $ProjectRoot
$backupFileFull = Resolve-FullPath -Path $BackupFile

if (-not (Test-Path -LiteralPath $projectRootFull -PathType Container)) {
    throw "Project root was not found: $projectRootFull"
}

if (-not (Test-Path -LiteralPath $backupFileFull -PathType Leaf)) {
    throw "Backup file was not found: $backupFileFull"
}

$extractRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('softskills-restore-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null

try {
    Expand-Archive -LiteralPath $backupFileFull -DestinationPath $extractRoot -Force

    $manifestPath = Join-Path $extractRoot 'backup-manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw 'The backup manifest was not found in the archive.'
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $expectedFiles = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($file in @($manifest.files)) {
        [void]$expectedFiles.Add(([string]$file).Replace('/', '\'))
    }

    foreach ($root in @($manifest.includedRoots)) {
        $sourceRoot = Join-Path $extractRoot $root
        if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
            throw "The backup archive is missing the required root directory: $root"
        }

        $targetRoot = Ensure-SafeTargetPath -ProjectRootFull $projectRootFull -TargetPath (Join-Path $projectRootFull $root)
        if (-not (Test-Path -LiteralPath $targetRoot -PathType Container)) {
            New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null
        }

        foreach ($sourceFile in (Get-ChildItem -LiteralPath $sourceRoot -Recurse -File)) {
            $relativePath = Get-RelativePath -BasePath $extractRoot -TargetPath $sourceFile.FullName
            $targetFile = Ensure-SafeTargetPath -ProjectRootFull $projectRootFull -TargetPath (Join-Path $projectRootFull $relativePath)
            $targetDirectory = Split-Path -Parent $targetFile
            if (-not (Test-Path -LiteralPath $targetDirectory -PathType Container)) {
                New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
            }
            Copy-Item -LiteralPath $sourceFile.FullName -Destination $targetFile -Force
        }

        foreach ($targetFile in (Get-ChildItem -LiteralPath $targetRoot -Recurse -File -ErrorAction SilentlyContinue)) {
            $relativePath = Get-RelativePath -BasePath $projectRootFull -TargetPath $targetFile.FullName.Replace('/', '\')
            if (-not $expectedFiles.Contains($relativePath)) {
                Remove-Item -LiteralPath $targetFile.FullName -Force
            }
        }

        $directories = Get-ChildItem -LiteralPath $targetRoot -Directory -Recurse -ErrorAction SilentlyContinue | Sort-Object FullName -Descending
        foreach ($directory in $directories) {
            $hasChildren = Get-ChildItem -LiteralPath $directory.FullName -Force -ErrorAction SilentlyContinue | Select-Object -First 1
            if (-not $hasChildren) {
                Remove-Item -LiteralPath $directory.FullName -Force -ErrorAction SilentlyContinue
            }
        }
    }

    foreach ($fileName in @($manifest.includedFiles)) {
        $sourceFile = Join-Path $extractRoot $fileName
        if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
            throw "The backup archive is missing the required root file: $fileName"
        }

        $targetFile = Ensure-SafeTargetPath -ProjectRootFull $projectRootFull -TargetPath (Join-Path $projectRootFull $fileName)
        $targetDirectory = Split-Path -Parent $targetFile
        if (-not (Test-Path -LiteralPath $targetDirectory -PathType Container)) {
            New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
        }
        Copy-Item -LiteralPath $sourceFile -Destination $targetFile -Force
    }

    $result = [ordered]@{
        restored = $true
        restartRequired = $true
        backupFile = $backupFileFull
        restoredAt = (Get-Date).ToString('o')
        fileCount = [int]$manifest.fileCount
    }

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [Console]::OutputEncoding = $utf8NoBom
    Write-Output ($result | ConvertTo-Json -Depth 10 -Compress)
}
finally {
    Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
}