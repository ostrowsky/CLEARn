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
    }

    if ($null -ne $Payload) {
        $params.ContentType = 'application/json; charset=utf-8'
        $params.Body = ($Payload | ConvertTo-Json -Depth 20 -Compress)
    }

    $response = Invoke-WebRequest @params
    Assert-True -Condition ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 300) -Message "Expected successful response from $Uri."
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
    Write-Host 'Platform practice API smoke tests skipped: Node.js was not found in this environment.'
    return
}

$tsxCli = Join-Path $platformRoot 'node_modules\tsx\dist\cli.mjs'
if (-not (Test-Path -LiteralPath $tsxCli)) {
    Write-Host 'Platform practice API smoke tests skipped: tsx CLI was not found. Run pnpm install in platform first.'
    return
}

$tempRoot = Join-Path $workspaceRoot ('tmp-platform-practice-smoke-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
$tempContentPath = Join-Path $tempRoot 'content.json'
$tempAuthPath = Join-Path $tempRoot 'admin-auth.json'
Copy-Item -LiteralPath (Join-Path $webRoot 'data\content.json') -Destination $tempContentPath -Force
$logPath = Join-Path $tempRoot 'platform-practice-api.log'

$port = Get-FreePort
$baseUrl = "http://127.0.0.1:$port"
$serverProcess = $null
$exampleSessionSecret = 'x' * 32

try {
    Write-TestStep 'Practice API runtime smoke covers learner actions that previously surfaced Failed to fetch'
    $command = "Set-Location '$platformRoot'; `$env:APP_ENV='development'; `$env:APP_PORT='$port'; `$env:APP_BASE_URL='https://api.clearn.me'; `$env:DEV_CONTENT_PATH='$tempContentPath'; `$env:ADMIN_AUTH_PATH='$tempAuthPath'; `$env:ADMIN_SESSION_SECRET='$exampleSessionSecret'; `$env:LLM_TEXT_PROVIDER='selfhosted'; & '$($nodeCommand.Source)' '.\node_modules\tsx\dist\cli.mjs' '.\apps\api\src\index.ts' *> '$logPath'"
    $serverProcess = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $command) -PassThru -WindowStyle Hidden

    if (-not (Wait-ForUrl -Url "$baseUrl/api/health")) {
        $combinedLogs = if (Test-Path -LiteralPath $logPath) { Get-Content -LiteralPath $logPath -Raw -ErrorAction SilentlyContinue } else { '' }
        if ($combinedLogs -match 'spawn EPERM' -or $combinedLogs -match 'esbuild' -or $combinedLogs -match 'windows sandbox') {
            Write-Host 'Platform practice API smoke tests skipped: this environment blocks tsx/esbuild child processes.'
            return
        }

        throw "Platform API did not become ready. Logs:`n$combinedLogs"
    }

    $talk = Invoke-JsonRequest -Uri "$baseUrl/api/practice/after-talk" -Method Post -Payload @{
        context = 'The speech is about the new throughput metric.'
        offset = 0
    }
    Assert-True -Condition (@($talk.speechLines).Count -ge 1) -Message 'Generate short talk should return speech lines.'
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$talk.coachingTip)) -Message 'Generate short talk should return a coaching tip.'

    $formation = Invoke-JsonRequest -Uri "$baseUrl/api/practice/question-formation" -Method Post -Payload @{
        context = 'IT workplace'
        offset = 0
    }
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$formation.sentence)) -Message 'Question formation should return a sentence.'
    Assert-True -Condition (@($formation.blanks).Count -eq 3) -Message 'Question formation should return exactly three targets.'

    $answering = Invoke-JsonRequest -Uri "$baseUrl/api/answering/session/start" -Method Post -Payload @{
        context = 'I am preparing a sprint review about billing rollout.'
        mode = 'mixed'
    }
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$answering.sessionId)) -Message 'Answering session should return a session ID.'
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$answering.currentTurn.questionText)) -Message 'Answering session should return the first question.'

    $coach = Invoke-JsonRequest -Uri "$baseUrl/api/coach/session/start" -Method Post -Payload @{
        context = 'I am preparing a sprint review about billing rollout.'
        goal = 'Practise concise answers.'
        scenario = 'meeting'
    }
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$coach.sessionId)) -Message 'Coach session should return a session ID.'
    Assert-True -Condition (@($coach.messages).Count -ge 1) -Message 'Coach session should return an initial assistant message.'
}
finally {
    if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host 'Platform practice API smoke tests passed.'
