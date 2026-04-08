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
    Write-Host 'Platform coach API tests skipped: Node.js was not found in this environment.'
    return
}

$tsxCli = Join-Path $platformRoot 'node_modules\tsx\dist\cli.mjs'
if (-not (Test-Path -LiteralPath $tsxCli)) {
    Write-Host 'Platform coach API tests skipped: tsx CLI was not found. Run pnpm install in platform first.'
    return
}

$tempRoot = Join-Path $workspaceRoot ('tmp-platform-coach-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
$tempContentPath = Join-Path $tempRoot 'content.json'
Copy-Item -LiteralPath (Join-Path $webRoot 'data\content.json') -Destination $tempContentPath -Force
$logPath = Join-Path $tempRoot 'platform-coach-api.log'

$port = Get-FreePort
$baseUrl = "http://127.0.0.1:$port"
$serverProcess = $null

try {
    Write-TestStep 'Platform API serves coach chat sessions with fallback responses'
    $command = "Set-Location '$platformRoot'; `$env:APP_ENV='development'; `$env:APP_PORT='$port'; `$env:APP_BASE_URL='$baseUrl'; `$env:DEV_CONTENT_PATH='$tempContentPath'; `$env:LLM_TEXT_PROVIDER='huggingface'; `$env:LLM_FALLBACK_CHAIN='huggingface,openai'; Remove-Item Env:HF_TOKEN -ErrorAction SilentlyContinue; Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue; & '$($nodeCommand.Source)' '.\node_modules\tsx\dist\cli.mjs' '.\apps\api\src\index.ts' *> '$logPath'"
    $serverProcess = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $command) -PassThru -WindowStyle Hidden

    if (-not (Wait-ForUrl -Url "$baseUrl/api/health")) {
        $combinedLogs = if (Test-Path -LiteralPath $logPath) { Get-Content -LiteralPath $logPath -Raw -ErrorAction SilentlyContinue } else { '' }
        if ($combinedLogs -match 'spawn EPERM' -or $combinedLogs -match 'esbuild' -or $combinedLogs -match 'windows sandbox') {
            Write-Host 'Platform coach API tests skipped: this environment blocks tsx/esbuild child processes.'
            return
        }

        throw "Platform API did not become ready. Logs:`n$combinedLogs"
    }

    $session = Invoke-JsonRequest -Uri "$baseUrl/api/coach/session/start" -Method Post -Payload @{
        context = 'I am a backend engineer working on billing APIs and stakeholder updates.'
        goal = 'I want to sound clearer when I explain blockers and next steps.'
        scenario = 'meeting'
    }

    Assert-True -Condition ($null -ne $session) -Message 'Coach start endpoint returned null.'
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$session.sessionId)) -Message 'Coach start endpoint returned an empty sessionId.'
    Assert-Equal -Expected 'meeting' -Actual ([string]$session.scenario)
    Assert-Equal -Expected 'text' -Actual ([string]$session.transcriptMode)
    Assert-True -Condition ([bool]$session.capabilities.text) -Message 'Coach session should advertise text support.'
    Assert-True -Condition ([bool]$session.capabilities.speechToText) -Message 'Coach session should advertise speechToText support when chat dictation is enabled.'
    Assert-True -Condition (-not [bool]$session.capabilities.textToSpeech) -Message 'Coach session should keep textToSpeech disabled in the text MVP.'
    Assert-True -Condition ($session.messages.Count -ge 1) -Message 'Coach session should include an opening assistant message.'
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$session.feedback)) -Message 'Coach session should include non-empty opening feedback from live content.'
    Assert-True -Condition ($session.suggestions.Count -ge 1) -Message 'Coach session should include starter suggestions from live content.'

    $updated = Invoke-JsonRequest -Uri "$baseUrl/api/coach/session/respond" -Method Post -Payload @{
        sessionId = $session.sessionId
        userReply = 'The main blocker is the approval flow, and I want us to align on the next step today.'
    }

    Assert-True -Condition ($null -ne $updated) -Message 'Coach respond endpoint returned null.'
    Assert-True -Condition ($updated.messages.Count -ge 3) -Message 'Coach respond endpoint should append the user turn and the assistant reply.'
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$updated.feedback)) -Message 'Coach respond endpoint should return non-empty feedback.'
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$updated.messages[-1].text)) -Message 'Coach respond endpoint should return a non-empty assistant reply.'

    while (-not [bool]$updated.completed) {
        $updated = Invoke-JsonRequest -Uri "$baseUrl/api/coach/session/respond" -Method Post -Payload @{
            sessionId = $session.sessionId
            userReply = 'My next step is to confirm the owner and timeline with the platform team.'
        }
    }

    Assert-True -Condition ([bool]$updated.completed) -Message 'Coach session should auto-complete once the message limit is reached.'
    Assert-True -Condition ($updated.messages.Count -ge 5) -Message 'Completed coach session should keep the accumulated transcript.'
}
finally {
    if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force
    }

    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host 'Platform coach API tests passed.'
