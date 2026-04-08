Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$platformRoot = Join-Path $workspaceRoot 'platform'
$webRoot = Join-Path $workspaceRoot 'web'
. (Join-Path $PSScriptRoot 'Assertions.ps1')

function Get-FreePort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
    $listener.Stop()
    return $port
}

function Wait-ForUrl {
    param([string]$Url,[int]$TimeoutSeconds = 60)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5 | Out-Null
            return $true
        }
        catch {
            Start-Sleep -Milliseconds 600
        }
    }

    return $false
}

function Invoke-JsonRequest {
    param(
        [string]$Uri,
        [string]$Method,
        $Payload = $null
    )

    $params = @{
        UseBasicParsing = $true
        Uri = $Uri
        Method = $Method
        ContentType = 'application/json; charset=utf-8'
    }

    if ($null -ne $Payload) {
        $params.Body = ($Payload | ConvertTo-Json -Depth 20 -Compress)
    }

    $response = Invoke-WebRequest @params
    if ([string]::IsNullOrWhiteSpace($response.Content)) {
        return $null
    }

    return ($response.Content | ConvertFrom-Json)
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
}
if (-not $nodeCommand -and (Test-Path -LiteralPath 'C:\Program Files\nodejs\node.exe')) {
    $nodeCommand = [PSCustomObject]@{ Source = 'C:\Program Files\nodejs\node.exe' }
}
if (-not $nodeCommand) {
    Write-Host 'Platform admin API tests skipped: Node.js was not found in this environment.'
    return
}

$tsxCli = Join-Path $platformRoot 'node_modules\tsx\dist\cli.mjs'
if (-not (Test-Path -LiteralPath $tsxCli)) {
    Write-Host 'Platform admin API tests skipped: tsx CLI was not found. Run pnpm install in platform first.'
    return
}

$tempRoot = Join-Path $workspaceRoot ('tmp-platform-api-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
$tempContentPath = Join-Path $tempRoot 'content.json'
Copy-Item -LiteralPath (Join-Path $webRoot 'data\content.json') -Destination $tempContentPath -Force
$logPath = Join-Path $tempRoot 'platform-api.log'

$port = Get-FreePort
$baseUrl = "http://127.0.0.1:$port"
$serverProcess = $null
$uploadedUrl = ''

try {
    Write-TestStep 'Platform API accepts large admin media uploads'
    $command = "Set-Location '$platformRoot'; `$env:APP_ENV='development'; `$env:APP_PORT='$port'; `$env:APP_BASE_URL='$baseUrl'; `$env:DEV_CONTENT_PATH='$tempContentPath'; & '$($nodeCommand.Source)' '.\node_modules\tsx\dist\cli.mjs' '.\apps\api\src\index.ts' *> '$logPath'"
    $serverProcess = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $command) -PassThru -WindowStyle Hidden

    if (-not (Wait-ForUrl -Url "$baseUrl/api/health")) {
        $combinedLogs = if (Test-Path -LiteralPath $logPath) { Get-Content -LiteralPath $logPath -Raw -ErrorAction SilentlyContinue } else { '' }
        if ($combinedLogs -match 'spawn EPERM' -or $combinedLogs -match 'esbuild' -or $combinedLogs -match 'windows sandbox') {
            Write-Host 'Platform admin API tests skipped: this environment blocks tsx/esbuild child processes.'
            return
        }

        throw "Platform API did not become ready. Logs:`n$combinedLogs"
    }

    $bytes = New-Object byte[] (2MB)
    for ($i = 0; $i -lt $bytes.Length; $i++) {
        $bytes[$i] = 97
    }

    $payload = [PSCustomObject]@{
        fileName = 'large-video.mp4'
        base64 = [Convert]::ToBase64String($bytes)
    }

    $upload = Invoke-JsonRequest -Uri "$baseUrl/api/admin/media/upload" -Method Post -Payload $payload
    $uploadedUrl = [string]$upload.url
    Assert-Match -Actual $uploadedUrl -Pattern '^/uploads/'
    Assert-Equal -Expected $bytes.Length -Actual ([int]$upload.size)

    $absoluteUpload = Join-Path $webRoot ('static' + ($uploadedUrl -replace '/', '\'))
    Assert-True -Condition (Test-Path -LiteralPath $absoluteUpload -PathType Leaf) -Message 'Uploaded media file was not created on disk.'

    $deleteResult = Invoke-JsonRequest -Uri "$baseUrl/api/admin/media/delete" -Method Post -Payload @{ url = $uploadedUrl }
    Assert-True -Condition ([bool]$deleteResult.deleted)
    Assert-True -Condition (-not (Test-Path -LiteralPath $absoluteUpload -PathType Leaf)) -Message 'Uploaded media file was not deleted.'
    $uploadedUrl = ''
}
finally {
    if ($uploadedUrl) {
        $fallbackPath = Join-Path $webRoot ('static' + ($uploadedUrl -replace '/', '\'))
        if (Test-Path -LiteralPath $fallbackPath -PathType Leaf) {
            Remove-Item -LiteralPath $fallbackPath -Force -ErrorAction SilentlyContinue
        }
    }

    if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force
    }

    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host 'Platform admin API tests passed.'
