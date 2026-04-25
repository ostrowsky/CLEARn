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
    Write-Host 'Platform question formation API tests skipped: Node.js was not found in this environment.'
    return
}

$tsxCli = Join-Path $platformRoot 'node_modules\tsx\dist\cli.mjs'
if (-not (Test-Path -LiteralPath $tsxCli)) {
    Write-Host 'Platform question formation API tests skipped: tsx CLI was not found. Run pnpm install in platform first.'
    return
}

$tempRoot = Join-Path $workspaceRoot ('tmp-platform-question-formation-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
$tempContentPath = Join-Path $tempRoot 'content.json'
Copy-Item -LiteralPath (Join-Path $webRoot 'data\content.json') -Destination $tempContentPath -Force
$logPath = Join-Path $tempRoot 'platform-question-formation-api.log'

$port = Get-FreePort
$baseUrl = "http://127.0.0.1:$port"
$serverProcess = $null

try {
    Write-TestStep 'Platform API checks question formation against grammar and visible context'
    $command = "Set-Location '$platformRoot'; `$env:APP_ENV='development'; `$env:APP_PORT='$port'; `$env:APP_BASE_URL='$baseUrl'; `$env:DEV_CONTENT_PATH='$tempContentPath'; & '$($nodeCommand.Source)' '.\node_modules\tsx\dist\cli.mjs' '.\apps\api\src\index.ts' *> '$logPath'"
    $serverProcess = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $command) -PassThru -WindowStyle Hidden

    if (-not (Wait-ForUrl -Url "$baseUrl/api/health")) {
        $combinedLogs = if (Test-Path -LiteralPath $logPath) { Get-Content -LiteralPath $logPath -Raw -ErrorAction SilentlyContinue } else { '' }
        if ($combinedLogs -match 'spawn EPERM' -or $combinedLogs -match 'esbuild' -or $combinedLogs -match 'windows sandbox') {
            Write-Host 'Platform question formation API tests skipped: this environment blocks tsx/esbuild child processes.'
            return
        }

        throw "Platform API did not become ready. Logs:`n$combinedLogs"
    }

    $basePayload = @{
        sentence = 'The backend team fixed six API defects in staging yesterday.'
        answer = 'backend team'
        whWord = 'Who'
        expectedQuestion = 'Who fixed six API defects in staging yesterday?'
        acceptedQuestions = @(
            'Who fixed six API defects in staging yesterday?',
            'Who fixed it yesterday?'
        )
    }

    $acceptedPronoun = Invoke-JsonRequest -Uri "$baseUrl/api/practice/question-formation/check" -Method Post -Payload ($basePayload + @{
        userQuestion = 'Who fixed it yesterday?'
    })
    Assert-True -Condition ([bool]$acceptedPronoun.accepted) -Message 'Short visible-context pronoun question should be accepted.'

    $acceptedDid = Invoke-JsonRequest -Uri "$baseUrl/api/practice/question-formation/check" -Method Post -Payload ($basePayload + @{
        userQuestion = 'Who did fix it yesterday?'
    })
    Assert-True -Condition ([bool]$acceptedDid.accepted) -Message 'Did-form visible-context question should be accepted.'

    $rejectedWrongVisibleWord = Invoke-JsonRequest -Uri "$baseUrl/api/practice/question-formation/check" -Method Post -Payload @{
        sentence = 'The backend team fixed six API defects in staging yesterday.'
        answer = 'six API defects'
        whWord = 'What'
        expectedQuestion = 'What did the backend team fix in staging yesterday?'
        acceptedQuestions = @(
            'What did the backend team fix yesterday?',
            'What did the backend team fix in staging yesterday?'
        )
        userQuestion = 'What did the backhand team fix yesterday?'
    }
    Assert-True -Condition (-not [bool]$rejectedWrongVisibleWord.accepted) -Message 'Question formation should reject questions that distort visible sentence words.'

    $rejectedPastAfterDid = Invoke-JsonRequest -Uri "$baseUrl/api/practice/question-formation/check" -Method Post -Payload @{
        sentence = 'The backend team fixed six API defects in staging yesterday.'
        answer = 'six API defects'
        whWord = 'What'
        expectedQuestion = 'What did the backend team fix in staging yesterday?'
        acceptedQuestions = @(
            'What did the backend team fix yesterday?',
            'What did the backend team fix in staging yesterday?'
        )
        userQuestion = 'What did the backend team fixed yesterday?'
    }
    Assert-True -Condition (-not [bool]$rejectedPastAfterDid.accepted) -Message 'Question formation should reject past-tense verbs immediately after did.'
}
finally {
    if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force
    }

    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host 'Platform question formation API tests passed.'
