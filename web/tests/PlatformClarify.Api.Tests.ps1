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
    Write-Host 'Platform clarify API tests skipped: Node.js was not found in this environment.'
    return
}

$tsxCli = Join-Path $platformRoot 'node_modules\tsx\dist\cli.mjs'
if (-not (Test-Path -LiteralPath $tsxCli)) {
    Write-Host 'Platform clarify API tests skipped: tsx CLI was not found. Run pnpm install in platform first.'
    return
}

$tempRoot = Join-Path $workspaceRoot ('tmp-platform-clarify-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
$tempContentPath = Join-Path $tempRoot 'content.json'
Copy-Item -LiteralPath (Join-Path $webRoot 'data\content.json') -Destination $tempContentPath -Force
$logPath = Join-Path $tempRoot 'platform-clarify-api.log'

$port = Get-FreePort
$baseUrl = "http://127.0.0.1:$port"
$serverProcess = $null

try {
    Write-TestStep 'Platform API checks clarify answers against the target clarification'
    $command = "Set-Location '$platformRoot'; `$env:APP_ENV='development'; `$env:APP_PORT='$port'; `$env:APP_BASE_URL='$baseUrl'; `$env:DEV_CONTENT_PATH='$tempContentPath'; & '$($nodeCommand.Source)' '.\node_modules\tsx\dist\cli.mjs' '.\apps\api\src\index.ts' *> '$logPath'"
    $serverProcess = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $command) -PassThru -WindowStyle Hidden

    if (-not (Wait-ForUrl -Url "$baseUrl/api/health")) {
        $combinedLogs = if (Test-Path -LiteralPath $logPath) { Get-Content -LiteralPath $logPath -Raw -ErrorAction SilentlyContinue } else { '' }
        if ($combinedLogs -match 'spawn EPERM' -or $combinedLogs -match 'esbuild' -or $combinedLogs -match 'windows sandbox') {
            Write-Host 'Platform clarify API tests skipped: this environment blocks tsx/esbuild child processes.'
            return
        }

        throw "Platform API did not become ready. Logs:`n$combinedLogs"
    }

    $acceptedExact = Invoke-JsonRequest -Uri "$baseUrl/api/practice/clarify/check" -Method Post -Payload @{
        userQuestion = 'Sorry, the bug is only reproducible on what?'
        expectedQuestion = 'Sorry, the bug is only reproducible on what?'
    }
    Assert-True -Condition ([bool]$acceptedExact.accepted) -Message 'Exact clarify match should be accepted.'

    $acceptedNormalized = Invoke-JsonRequest -Uri "$baseUrl/api/practice/clarify/check" -Method Post -Payload @{
        userQuestion = 'sorry the bug is only reproducible on what'
        expectedQuestion = 'Sorry, the bug is only reproducible on what?'
    }
    Assert-True -Condition ([bool]$acceptedNormalized.accepted) -Message 'Clarify matching should ignore punctuation and casing.'

    $acceptedAlternative = Invoke-JsonRequest -Uri "$baseUrl/api/practice/clarify/check" -Method Post -Payload @{
        userQuestion = 'Sorry, you have assigned the critical ticket to who?'
        expectedQuestion = 'Sorry, you''ve assigned the critical ticket to who?'
        acceptedAnswers = @('Sorry, you have assigned the critical ticket to who?')
    }
    Assert-True -Condition ([bool]$acceptedAlternative.accepted) -Message 'Clarify matching should accept configured alternative phrasings.'

    $rejected = Invoke-JsonRequest -Uri "$baseUrl/api/practice/clarify/check" -Method Post -Payload @{
        userQuestion = 'Sorry, the bug is reproducible where?'
        expectedQuestion = 'Sorry, the bug is only reproducible on what?'
    }
    Assert-True -Condition (-not [bool]$rejected.accepted) -Message 'Incorrect clarify answer should be rejected.'
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$rejected.feedback)) -Message 'Incorrect clarify answer should return feedback.'
}
finally {
    if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force
    }

    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host 'Platform clarify API tests passed.'
