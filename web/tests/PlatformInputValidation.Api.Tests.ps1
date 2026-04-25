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
        $Payload = $null,
        [switch]$AllowHttpError
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

    try {
        $response = Invoke-WebRequest @params
        if ([string]::IsNullOrWhiteSpace($response.Content)) {
            return $null
        }

        return ($response.Content | ConvertFrom-Json)
    }
    catch {
        if (-not $AllowHttpError) {
            throw
        }

        $errorResponse = $_.Exception.Response
        $statusCode = if ($errorResponse) { [int]$errorResponse.StatusCode } else { 0 }
        $content = ''
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            $content = $_.ErrorDetails.Message
        }

        $body = if ([string]::IsNullOrWhiteSpace($content)) { $null } else { $content | ConvertFrom-Json }
        return [PSCustomObject]@{
            statusCode = $statusCode
            body = $body
        }
    }
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
}
if (-not $nodeCommand -and (Test-Path -LiteralPath 'C:\Program Files\nodejs\node.exe')) {
    $nodeCommand = [PSCustomObject]@{ Source = 'C:\Program Files\nodejs\node.exe' }
}
if (-not $nodeCommand) {
    Write-Host 'Platform input validation API tests skipped: Node.js was not found in this environment.'
    return
}

$tsxCli = Join-Path $platformRoot 'node_modules\tsx\dist\cli.mjs'
if (-not (Test-Path -LiteralPath $tsxCli)) {
    Write-Host 'Platform input validation API tests skipped: tsx CLI was not found. Run pnpm install in platform first.'
    return
}

$tempRoot = Join-Path $workspaceRoot ('tmp-platform-input-validation-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
$tempContentPath = Join-Path $tempRoot 'content.json'
Copy-Item -LiteralPath (Join-Path $webRoot 'data\content.json') -Destination $tempContentPath -Force
$logPath = Join-Path $tempRoot 'platform-input-validation-api.log'

$port = Get-FreePort
$baseUrl = "http://127.0.0.1:$port"
$serverProcess = $null

try {
    Write-TestStep 'Platform API applies shared validation to all text-input practice routes'
    $command = "Set-Location '$platformRoot'; `$env:APP_ENV='development'; `$env:APP_PORT='$port'; `$env:APP_BASE_URL='$baseUrl'; `$env:DEV_CONTENT_PATH='$tempContentPath'; `$env:LLM_TEXT_PROVIDER='huggingface'; `$env:LLM_FALLBACK_CHAIN='huggingface,openai'; Remove-Item Env:HF_TOKEN -ErrorAction SilentlyContinue; Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue; & '$($nodeCommand.Source)' '.\node_modules\tsx\dist\cli.mjs' '.\apps\api\src\index.ts' *> '$logPath'"
    $serverProcess = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $command) -PassThru -WindowStyle Hidden

    if (-not (Wait-ForUrl -Url "$baseUrl/api/health")) {
        $combinedLogs = if (Test-Path -LiteralPath $logPath) { Get-Content -LiteralPath $logPath -Raw -ErrorAction SilentlyContinue } else { '' }
        if ($combinedLogs -match 'spawn EPERM' -or $combinedLogs -match 'esbuild' -or $combinedLogs -match 'windows sandbox') {
            Write-Host 'Platform input validation API tests skipped: this environment blocks tsx/esbuild child processes.'
            return
        }

        throw "Platform API did not become ready. Logs:`n$combinedLogs"
    }

    $clarify = Invoke-JsonRequest -Uri "$baseUrl/api/practice/clarify/check" -Method Post -Payload @{
        userQuestion = 'aaaaaa'
        expectedQuestion = 'Sorry, the bug is only reproducible on what?'
    }
    Assert-True -Condition (-not [bool]$clarify.accepted) -Message 'Clarify check should reject repeated-letter input.'

    $askAfter = Invoke-JsonRequest -Uri "$baseUrl/api/practice/after-talk/check" -Method Post -Payload @{
        question = 'aaaaaa?'
        expectedQuestion = 'You mentioned the rollout. Could you explain that in a bit more detail?'
        detail = 'rollout'
    }
    Assert-True -Condition (-not [bool]$askAfter.accepted) -Message 'Ask-after check should reject repeated-letter input.'

    $answering = Invoke-JsonRequest -Uri "$baseUrl/api/answering/session/start" -Method Post -Payload @{
        context = 'I am preparing a sprint review about API stability.'
        mode = 'mixed'
    }
    $reactionId = [string]$answering.currentTurn.reactionOptions[0].id
    $answeringReject = Invoke-JsonRequest -Uri "$baseUrl/api/answering/session/respond" -Method Post -Payload @{
        sessionId = $answering.sessionId
        reactionOptionId = $reactionId
        userReply = 'aaaaaa'
        transcriptSource = 'text'
    } -AllowHttpError
    Assert-Equal -Expected 400 -Actual ([int]$answeringReject.statusCode)
    Assert-Match -Actual ([string]$answeringReject.body.message) -Pattern 'Type or (record|dictate) your answer'

    $coach = Invoke-JsonRequest -Uri "$baseUrl/api/coach/session/start" -Method Post -Payload @{
        context = 'I am a backend engineer preparing for stakeholder updates.'
        goal = 'Practise concise replies.'
        scenario = 'meeting'
    }
    $coachReject = Invoke-JsonRequest -Uri "$baseUrl/api/coach/session/respond" -Method Post -Payload @{
        sessionId = $coach.sessionId
        userReply = 'aaaaaa'
    } -AllowHttpError
    Assert-Equal -Expected 400 -Actual ([int]$coachReject.statusCode)
    Assert-Match -Actual ([string]$coachReject.body.message) -Pattern 'User reply is required'
}
finally {
    if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force
    }

    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host 'Platform input validation API tests passed.'
