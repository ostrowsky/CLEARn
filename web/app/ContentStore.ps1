Set-StrictMode -Version Latest

function Get-ContentStorePath {
    param([string]$ProjectRoot)
    return (Join-Path $ProjectRoot 'data\content.json')
}

function Get-DefaultContentTemplatePath {
    param([string]$ProjectRoot)

    $candidate = Join-Path $ProjectRoot 'data\content.template.json'
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        return $candidate
    }

    $scriptDefault = Join-Path (Split-Path -Parent $PSScriptRoot) 'data\content.template.json'
    return $scriptDefault
}

function Get-UploadsRoot {
    param([string]$ProjectRoot)
    return (Join-Path $ProjectRoot 'static\uploads')
}

function Invoke-FileWriteWithRetry {
    param(
        [scriptblock]$Operation,
        [int]$MaxAttempts = 12,
        [int]$DelayMilliseconds = 150
    )

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        try {
            & $Operation
            return
        }
        catch [System.IO.IOException], [System.UnauthorizedAccessException] {
            if ($attempt -ge $MaxAttempts) {
                throw
            }

            Start-Sleep -Milliseconds $DelayMilliseconds
        }
    }
}

function Read-JsonFileText {
    param([string]$Path)

    $text = Get-Content -LiteralPath $Path -Raw
    if (-not [string]::IsNullOrEmpty($text) -and $text[0] -eq [char]0xFEFF) {
        return $text.Substring(1)
    }

    return $text
}

function Write-JsonFileText {
    param(
        [string]$Path,
        [string]$Text
    )

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    Invoke-FileWriteWithRetry -Operation { [System.IO.File]::WriteAllText($Path, $Text, $utf8NoBom) }
}

function Get-DefaultAppContent {
    param([string]$ProjectRoot)

    $templatePath = Get-DefaultContentTemplatePath -ProjectRoot $ProjectRoot
    if (-not (Test-Path -LiteralPath $templatePath -PathType Leaf)) {
        throw "Default content template was not found at $templatePath"
    }

    return (Read-JsonFileText -Path $templatePath | ConvertFrom-Json)
}

function Ensure-ContentStore {
    param([string]$ProjectRoot)

    $contentPath = Get-ContentStorePath -ProjectRoot $ProjectRoot
    $uploadsRoot = Get-UploadsRoot -ProjectRoot $ProjectRoot
    $contentDirectory = Split-Path -Parent $contentPath

    if (-not (Test-Path -LiteralPath $contentDirectory -PathType Container)) {
        New-Item -ItemType Directory -Force -Path $contentDirectory | Out-Null
    }

    if (-not (Test-Path -LiteralPath $uploadsRoot -PathType Container)) {
        New-Item -ItemType Directory -Force -Path $uploadsRoot | Out-Null
    }

    if (-not (Test-Path -LiteralPath $contentPath -PathType Leaf)) {
        $default = Get-DefaultAppContent -ProjectRoot $ProjectRoot
        Write-JsonFileText -Path $contentPath -Text ($default | ConvertTo-Json -Depth 60)
    }
}

function Get-AppContent {
    param([string]$ProjectRoot)

    Ensure-ContentStore -ProjectRoot $ProjectRoot
    $contentPath = Get-ContentStorePath -ProjectRoot $ProjectRoot
    return ((Read-JsonFileText -Path $contentPath) | ConvertFrom-Json)
}

function Save-AppContent {
    param(
        [string]$ProjectRoot,
        $ContentObject
    )

    Ensure-ContentStore -ProjectRoot $ProjectRoot
    $contentPath = Get-ContentStorePath -ProjectRoot $ProjectRoot

    if (-not $ContentObject.sections) {
        throw 'Content payload must contain a sections collection.'
    }

    if (-not $ContentObject.meta) {
        $ContentObject | Add-Member -NotePropertyName meta -NotePropertyValue ([PSCustomObject]@{}) -Force
    }

    $ContentObject.meta.updatedAt = [DateTime]::UtcNow.ToString('o')
    Write-JsonFileText -Path $contentPath -Text ($ContentObject | ConvertTo-Json -Depth 60)
    return (Get-AppContent -ProjectRoot $ProjectRoot)
}

function Get-SafeUploadName {
    param([string]$FileName)

    $name = [System.IO.Path]::GetFileNameWithoutExtension($FileName)
    $extension = [System.IO.Path]::GetExtension($FileName)
    if ([string]::IsNullOrWhiteSpace($extension)) {
        $extension = '.bin'
    }

    $safeBase = ($name -replace '[^a-zA-Z0-9_-]', '-')
    if ([string]::IsNullOrWhiteSpace($safeBase)) {
        $safeBase = 'asset'
    }

    return ('{0}-{1}{2}' -f $safeBase, ([guid]::NewGuid().ToString('N').Substring(0, 10)), $extension.ToLowerInvariant())
}

function Save-UploadedMedia {
    param(
        [string]$ProjectRoot,
        [string]$FileName,
        [string]$Base64Data
    )

    Ensure-ContentStore -ProjectRoot $ProjectRoot
    $uploadsRoot = Get-UploadsRoot -ProjectRoot $ProjectRoot

    if ([string]::IsNullOrWhiteSpace($FileName)) {
        throw 'fileName is required.'
    }

    if ([string]::IsNullOrWhiteSpace($Base64Data)) {
        throw 'base64 is required.'
    }

    $cleanBase64 = $Base64Data
    if ($cleanBase64 -match '^data:[^;]+;base64,(.+)$') {
        $cleanBase64 = $Matches[1]
    }

    $bytes = [Convert]::FromBase64String($cleanBase64)
    $safeName = Get-SafeUploadName -FileName $FileName
    $absolutePath = Join-Path $uploadsRoot $safeName
    [System.IO.File]::WriteAllBytes($absolutePath, $bytes)

    return [PSCustomObject]@{
        url = '/uploads/' + $safeName
        fileName = $safeName
        size = $bytes.Length
    }
}

function Remove-UploadedMedia {
    param(
        [string]$ProjectRoot,
        [string]$Url
    )

    if ([string]::IsNullOrWhiteSpace($Url)) {
        throw 'url is required.'
    }

    if (-not $Url.StartsWith('/uploads/')) {
        throw 'Only files inside /uploads can be deleted by the admin panel.'
    }

    $uploadsRoot = Get-UploadsRoot -ProjectRoot $ProjectRoot
    $relativeName = $Url.Substring('/uploads/'.Length)
    $targetPath = [System.IO.Path]::GetFullPath((Join-Path $uploadsRoot $relativeName))
    $uploadsRootFull = [System.IO.Path]::GetFullPath($uploadsRoot)

    if (-not $targetPath.StartsWith($uploadsRootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Resolved delete path is outside the uploads directory.'
    }

    if (Test-Path -LiteralPath $targetPath -PathType Leaf) {
        Remove-Item -LiteralPath $targetPath -Force
    }

    return [PSCustomObject]@{
        deleted = $true
        url = $Url
    }
}
