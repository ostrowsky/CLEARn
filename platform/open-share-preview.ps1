param(
    [switch]$RunFullTests
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-SafeScriptPath {
    try {
        if (-not [string]::IsNullOrWhiteSpace($PSCommandPath)) {
            return $PSCommandPath
        }
    }
    catch {
    }

    try {
        $invocation = $MyInvocation
        if ($null -ne $invocation) {
            $psCommandPathMember = $invocation.PSObject.Properties['PSCommandPath']
            if ($null -ne $psCommandPathMember -and -not [string]::IsNullOrWhiteSpace([string]$psCommandPathMember.Value)) {
                return [string]$psCommandPathMember.Value
            }

            $myCommandMember = $invocation.PSObject.Properties['MyCommand']
            if ($null -ne $myCommandMember -and $null -ne $myCommandMember.Value) {
                $pathMember = $myCommandMember.Value.PSObject.Properties['Path']
                if ($null -ne $pathMember -and -not [string]::IsNullOrWhiteSpace([string]$pathMember.Value)) {
                    return [string]$pathMember.Value
                }
            }
        }
    }
    catch {
    }

    return ''
}


function Resolve-WorkspaceRoot {
    $candidates = @()

    try {
        $current = (Get-Location).Path
        if (-not [string]::IsNullOrWhiteSpace($current)) {
            $candidates += $current
        }
    }
    catch {
    }

    if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        $candidates += (Split-Path -Parent $PSScriptRoot)
    }

    $scriptPath = Get-SafeScriptPath
    if (-not [string]::IsNullOrWhiteSpace($scriptPath)) {
        $candidates += (Split-Path -Parent (Split-Path -Parent $scriptPath))
    }

    foreach ($candidate in $candidates | Select-Object -Unique) {
        if (-not $candidate) {
            continue
        }

        $platformDir = Join-Path $candidate 'platform'
        $testsPath = Join-Path $candidate 'web\tests\run-tests.ps1'
        if ((Test-Path -LiteralPath $platformDir) -and (Test-Path -LiteralPath $testsPath)) {
            return $candidate
        }
    }

    throw 'Could not resolve the SOFTskills workspace root.'
}

$workspaceRoot = Resolve-WorkspaceRoot
$projectRoot = Join-Path $workspaceRoot 'platform'
$testsScript = Join-Path $workspaceRoot 'web\tests\run-tests.ps1'
$summaryPath = Join-Path $projectRoot 'share-preview-links.txt'
$previousSummaryLines = @()
if (Test-Path -LiteralPath $summaryPath) {
    $previousSummaryLines = Get-Content -LiteralPath $summaryPath -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $summaryPath -Force -ErrorAction SilentlyContinue
}

function Invoke-PreviewPreflight {
    $preflightTests = @(
        (Join-Path $workspaceRoot 'web\tests\Server.Tests.ps1'),
        (Join-Path $workspaceRoot 'web\tests\PlatformSyntax.Tests.ps1'),
        (Join-Path $workspaceRoot 'web\tests\PlatformAdmin.Tests.ps1'),
        (Join-Path $workspaceRoot 'web\tests\PlatformSpeech.Tests.ps1')
    )

    Write-Host 'Running quick preview preflight tests...'
    foreach ($test in $preflightTests) {
        Write-Host ("Running {0}" -f (Split-Path -Leaf $test))
        & $test
    }
}

$runFullTestsFromEnv = [string]::Equals($env:SOFTSKILLS_RUN_FULL_TESTS, '1', [System.StringComparison]::OrdinalIgnoreCase)
if ($RunFullTests -or $runFullTestsFromEnv) {
    Write-Host 'Running full tests before preview...'
    & $testsScript
}
else {
    Invoke-PreviewPreflight
    Write-Host 'Skipping full test suite for fast preview startup. Run with -RunFullTests or set SOFTSKILLS_RUN_FULL_TESTS=1 for full validation.'
}

function Get-PersistedEnvValue {
    param([string]$Name)

    $processValue = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($processValue)) {
        return $processValue
    }

    $userValue = [Environment]::GetEnvironmentVariable($Name, 'User')
    if (-not [string]::IsNullOrWhiteSpace($userValue)) {
        return $userValue
    }

    return [Environment]::GetEnvironmentVariable($Name, 'Machine')
}

$persistedHfToken = Get-PersistedEnvValue -Name 'HF_TOKEN'
if (-not [string]::IsNullOrWhiteSpace($persistedHfToken)) {
    $env:HF_TOKEN = $persistedHfToken
}

$env:LLM_STT_PROVIDER = 'selfhosted'
$env:LLM_STT_MODEL = 'base.en'
if ([string]::IsNullOrWhiteSpace($env:SELF_HOSTED_SPEECH_BASE_URL)) {
    $env:SELF_HOSTED_SPEECH_BASE_URL = 'http://localhost:8010/v1'
}

function Test-PortListening {
    param([int]$Port)

    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Get-FreePort {
    param(
        [int]$StartPort = 8081,
        [int]$MaxAttempts = 20
    )

    for ($offset = 0; $offset -lt $MaxAttempts; $offset++) {
        $candidate = $StartPort + $offset
        if (-not (Test-PortListening -Port $candidate)) {
            return $candidate
        }
    }

    throw "Could not find a free TCP port starting from $StartPort."
}

function Wait-ForHttpReady {
    param(
        [string]$Url,
        [int]$TimeoutSeconds = 90
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5 | Out-Null
            return $true
        }
        catch {
            Start-Sleep -Seconds 2
        }
    }

    return $false
}

function Wait-ForLocalSttWarmup {
    param(
        [string]$Url,
        [int]$TimeoutSeconds = 600
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-RestMethod -Method Post -Uri $Url -TimeoutSec 30
            $modelLoaded = $false
            if ($null -ne $response -and $null -ne $response.PSObject.Properties['modelLoaded']) {
                $modelLoaded = [bool]$response.PSObject.Properties['modelLoaded'].Value
            }

            if ($modelLoaded) {
                return $true
            }
        }
        catch {
            Start-Sleep -Seconds 5
        }
    }

    return $false
}

function Test-PublicHttpReady {
    param(
        [string]$Url,
        [int[]]$ExpectedStatusCodes = @(200),
        [int]$TimeoutSeconds = 60
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 10
            if ($ExpectedStatusCodes -contains [int]$response.StatusCode) {
                return $true
            }
        }
        catch {
            Start-Sleep -Seconds 2
        }
    }

    return $false
}

function Stop-PreviewProcess {
    param(
        [AllowNull()]
        [object]$ProcessId,
        [string]$Label
    )

    if ($null -eq $ProcessId) {
        return
    }

    try {
        Stop-Process -Id ([int]$ProcessId) -Force -ErrorAction SilentlyContinue
        Write-Host "Stopped failed $Label process $ProcessId."
    }
    catch {
    }
}

function Get-PreviewSummaryValue {
    param(
        [string[]]$Lines,
        [string]$Label
    )

    foreach ($line in $Lines) {
        if ($line -match "^$([regex]::Escape($Label)):\s*(.+)$") {
            return $matches[1].Trim()
        }
    }

    return ''
}

function Stop-PreviewProcessesFromSummary {
    param([string[]]$Lines)

    if (-not $Lines -or $Lines.Count -eq 0) {
        return
    }

    foreach ($label in @('API tunnel PID', 'Web tunnel PID')) {
        $value = Get-PreviewSummaryValue -Lines $Lines -Label $label
        if ($value -match '^\d+$') {
            Stop-PreviewProcess -ProcessId ([int]$value) -Label "previous $label"
        }
    }

    $localWebPort = Get-PreviewSummaryValue -Lines $Lines -Label 'Local web port'
    if ($localWebPort -match '^\d+$') {
        Stop-ProcessOnPort -Port ([int]$localWebPort) -Label 'previous Expo web preview'
    }
}

function Stop-ProcessOnPort {
    param(
        [int]$Port,
        [string]$Label
    )

    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($connection in $connections) {
        Stop-PreviewProcess -ProcessId $connection.OwningProcess -Label $Label
    }
}

function Stop-PreviewProcessesByCommandLine {
    param([string]$WorkspacePath)

    $escapedWorkspace = [regex]::Escape($WorkspacePath)
    $processes = Get-CimInstance Win32_Process | Where-Object {
        $commandLine = [string]$_.CommandLine
        if (-not [string]::IsNullOrWhiteSpace($commandLine)) {
            $isWorkspaceProcess = $commandLine -match $escapedWorkspace
            $isPreviewApi = $isWorkspaceProcess -and $commandLine -match 'apps[\\/]+api[\\/]+src[\\/]+index\.ts'
            $isPreviewApiShell = $isWorkspaceProcess -and $commandLine -match 'pnpm(\.cmd)?\s+dev:api'
            $isPreviewClient = $isWorkspaceProcess -and $commandLine -match 'expo\s+start'
            $isPreviewStt = $isWorkspaceProcess -and $commandLine -match 'local-stt.*uvicorn\s+server:app|start-local-stt\.ps1'
            $isPreviewTunnel = $commandLine -match 'cloudflared.*tunnel\s+--url\s+http://127\.0\.0\.1:(4000|80\d\d)'
            $isPreviewWindow = $isWorkspaceProcess -and $commandLine -match 'softskills-(api|client|local-stt)-runtime'

            $isPreviewApi -or $isPreviewApiShell -or $isPreviewClient -or $isPreviewStt -or $isPreviewTunnel -or $isPreviewWindow
        }
        else {
            $false
        }
    }

    foreach ($process in $processes) {
        Stop-PreviewProcess -ProcessId $process.ProcessId -Label 'previous SOFTskills preview'
    }
}

function Stop-PreviousPreview {
    param(
        [string[]]$SummaryLines,
        [string]$WorkspacePath
    )

    Write-Host 'Stopping previous SOFTskills preview processes if any...'
    Stop-PreviewProcessesFromSummary -Lines $SummaryLines
    Stop-PreviewProcessesByCommandLine -WorkspacePath $WorkspacePath

    foreach ($port in @(4000, 8010, 8081, 8082, 8083, 8084, 8085)) {
        Stop-ProcessOnPort -Port $port -Label "previous SOFTskills process on port $port"
    }
}

function Invoke-PublicPreviewSmoke {
    param(
        [string]$ApiBaseUrl,
        [string]$LearnerUrl,
        [string]$AdminUrl
    )

    $checks = @(
        @{ Label = 'public API health'; Url = "$ApiBaseUrl/api/health"; ExpectedStatusCodes = @(200) },
        @{ Label = 'public API content'; Url = "$ApiBaseUrl/api/content"; ExpectedStatusCodes = @(200) },
        @{ Label = 'public learner preview'; Url = $LearnerUrl; ExpectedStatusCodes = @(200) },
        @{ Label = 'public admin preview'; Url = $AdminUrl; ExpectedStatusCodes = @(200) }
    )

    foreach ($check in $checks) {
        Write-Host "Smoke testing $($check.Label): $($check.Url)"
        $isReady = Test-PublicHttpReady -Url $check.Url -ExpectedStatusCodes $check.ExpectedStatusCodes -TimeoutSeconds 60
        if (-not $isReady) {
            throw "Public smoke test failed for $($check.Label): $($check.Url)"
        }
    }
}

function Start-QuickTunnel {
    param(
        [string]$CloudflaredPath,
        [int]$Port,
        [string]$Label
    )

    $suffix = [Guid]::NewGuid().ToString('n')
    $stdoutPath = Join-Path $env:TEMP "softskills-$Label-$suffix.out.log"
    $stderrPath = Join-Path $env:TEMP "softskills-$Label-$suffix.err.log"

    $process = Start-Process -FilePath $CloudflaredPath -ArgumentList @('tunnel', '--url', "http://127.0.0.1:$Port") -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru -WindowStyle Hidden

    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline) {
        $combined = @()

        foreach ($logPath in @($stdoutPath, $stderrPath)) {
            if (Test-Path -LiteralPath $logPath) {
                $combined += (Get-Content -LiteralPath $logPath -Raw -ErrorAction SilentlyContinue)
            }
        }

        $content = ($combined -join "`n")
        if ($content -match 'https://[-a-z0-9]+\.trycloudflare\.com') {
            return @{
                Url = $matches[0]
                ProcessId = $process.Id
                StdOutLogPath = $stdoutPath
                StdErrLogPath = $stderrPath
            }
        }

        Start-Sleep -Seconds 2
    }

    throw "Could not get a public Cloudflare URL for $Label. Check $stdoutPath and $stderrPath"
}

$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflared) {
    $cloudflared = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
}

if (-not $cloudflared) {
    throw 'cloudflared is not installed. Install Cloudflare Tunnel first, then run this script again.'
}

$apiPort = 4000
$localSttPort = 8010
Stop-PreviousPreview -SummaryLines $previousSummaryLines -WorkspacePath $projectRoot

$apiRuntimeLog = Join-Path $env:TEMP ('softskills-api-runtime-' + [Guid]::NewGuid().ToString('n') + '.log')
$localSttRuntimeLog = Join-Path $env:TEMP ('softskills-local-stt-runtime-' + [Guid]::NewGuid().ToString('n') + '.log')

if (-not (Test-PortListening -Port $localSttPort)) {
    Write-Host 'Starting local free STT server in a new window...'
    $localSttScript = Join-Path $projectRoot 'start-local-stt.ps1'
    $localSttCommand = "Set-Location '$projectRoot'; powershell -NoProfile -ExecutionPolicy Bypass -File '$localSttScript' 2>&1 | Tee-Object -FilePath '$localSttRuntimeLog'"
    Start-Process powershell.exe -ArgumentList @(
        '-NoExit',
        '-ExecutionPolicy', 'Bypass',
        '-Command',
        $localSttCommand
    ) | Out-Null
}
else {
    Write-Host 'Local STT is already running on port 8010.'
}

if (-not (Wait-ForHttpReady -Url "http://127.0.0.1:$localSttPort/v1/health" -TimeoutSeconds 300)) {
    throw "Local STT did not become ready on port 8010. Check $localSttRuntimeLog"
}

Write-Host 'Warming local STT model before exposing the preview...'
if (-not (Wait-ForLocalSttWarmup -Url "http://127.0.0.1:$localSttPort/v1/warmup" -TimeoutSeconds 600)) {
    throw "Local STT model did not warm up on port 8010. Check $localSttRuntimeLog"
}

if (-not (Test-PortListening -Port $apiPort)) {
    Write-Host 'Starting API in a new window...'
    $apiCommand = "Set-Location '$projectRoot'; `$env:APP_PORT='$apiPort'; `$env:APP_BASE_URL='http://127.0.0.1:$apiPort'; `$env:LLM_STT_PROVIDER='selfhosted'; `$env:LLM_STT_MODEL='base.en'; if ([string]::IsNullOrWhiteSpace(`$env:SELF_HOSTED_SPEECH_BASE_URL)) { `$env:SELF_HOSTED_SPEECH_BASE_URL='http://localhost:8010/v1' }; pnpm.cmd dev:api 2>&1 | Tee-Object -FilePath '$apiRuntimeLog'"
    Start-Process powershell.exe -ArgumentList @(
        '-NoExit',
        '-ExecutionPolicy', 'Bypass',
        '-Command',
        $apiCommand
    ) | Out-Null
}
else {
    Write-Host 'API is already running on port 4000.'
}

if (-not (Wait-ForHttpReady -Url "http://127.0.0.1:$apiPort/api/health")) {
    throw "API did not become ready on port 4000. Check $apiRuntimeLog"
}

$maxPreviewAttempts = 3
$previewReady = $false
$lastPreviewError = ''
$apiTunnel = $null
$clientTunnel = $null
$clientProcess = $null
$clientPort = $null
$clientRuntimeLog = $null
$clientBaseUrl = $null
$learnerUrl = $null
$adminUrl = $null

for ($attempt = 1; $attempt -le $maxPreviewAttempts; $attempt++) {
    Write-Host "Starting public preview attempt $attempt of $maxPreviewAttempts..."
    $apiTunnel = $null
    $clientTunnel = $null
    $clientProcess = $null
    $clientPort = Get-FreePort -StartPort 8081
    $clientRuntimeLog = Join-Path $env:TEMP ('softskills-client-runtime-' + [Guid]::NewGuid().ToString('n') + '.log')

    try {
        if (-not (Wait-ForHttpReady -Url "http://127.0.0.1:$apiPort/api/health" -TimeoutSeconds 30)) {
            throw "API stopped responding on port 4000 before preview attempt $attempt. Check $apiRuntimeLog"
        }

        Write-Host 'Creating public API tunnel...'
        $apiTunnel = Start-QuickTunnel -CloudflaredPath $cloudflared.Source -Port $apiPort -Label 'api'

        Write-Host "Starting Expo web preview on port $clientPort in a new window..."
        $clientCommand = "Set-Location '$projectRoot'; `$env:EXPO_PUBLIC_API_BASE_URL='$($apiTunnel.Url)'; pnpm.cmd --filter @softskills/client exec expo start --clear --web --port $clientPort 2>&1 | Tee-Object -FilePath '$clientRuntimeLog'"
        $clientProcess = Start-Process powershell.exe -ArgumentList @(
            '-NoExit',
            '-ExecutionPolicy', 'Bypass',
            '-Command',
            $clientCommand
        ) -PassThru

        if (-not (Wait-ForHttpReady -Url "http://127.0.0.1:$clientPort")) {
            throw "Expo web preview did not become ready on port $clientPort. Check $clientRuntimeLog"
        }

        if (-not (Wait-ForHttpReady -Url "http://127.0.0.1:$clientPort/sections")) {
            throw "Expo learner route did not become ready on port $clientPort. Check $clientRuntimeLog"
        }

        if (-not (Wait-ForHttpReady -Url "http://127.0.0.1:$clientPort/admin")) {
            throw "Expo admin route did not become ready on port $clientPort. Check $clientRuntimeLog"
        }

        Write-Host 'Creating public web tunnel...'
        $clientTunnel = Start-QuickTunnel -CloudflaredPath $cloudflared.Source -Port $clientPort -Label 'client'

        $clientBaseUrl = $clientTunnel.Url
        $learnerUrl = "$clientBaseUrl/sections"
        $adminUrl = "$clientBaseUrl/admin"

        Invoke-PublicPreviewSmoke -ApiBaseUrl $apiTunnel.Url -LearnerUrl $learnerUrl -AdminUrl $adminUrl
        $previewReady = $true
        break
    }
    catch {
        $lastPreviewError = $_.Exception.Message
        Write-Warning "Preview attempt $attempt failed: $lastPreviewError"

        $apiTunnelProcessId = $null
        if ($null -ne $apiTunnel -and $apiTunnel.ContainsKey('ProcessId')) {
            $apiTunnelProcessId = $apiTunnel.ProcessId
        }

        $clientTunnelProcessId = $null
        if ($null -ne $clientTunnel -and $clientTunnel.ContainsKey('ProcessId')) {
            $clientTunnelProcessId = $clientTunnel.ProcessId
        }

        $clientProcessId = $null
        if ($null -ne $clientProcess) {
            $clientProcessId = $clientProcess.Id
        }

        Stop-PreviewProcess -ProcessId $apiTunnelProcessId -Label 'API tunnel'
        Stop-PreviewProcess -ProcessId $clientTunnelProcessId -Label 'web tunnel'
        Stop-PreviewProcess -ProcessId $clientProcessId -Label 'Expo window'

        if ($attempt -lt $maxPreviewAttempts) {
            Start-Sleep -Seconds 3
            Write-Host 'Retrying public preview with fresh tunnels...'
        }
    }
}

if (-not $previewReady) {
    throw "Public preview failed after $maxPreviewAttempts attempts. Last error: $lastPreviewError"
}

@(
    "Public web base: $clientBaseUrl",
    "Public learner preview: $learnerUrl",
    "Public admin preview: $adminUrl",
    "Public API tunnel: $($apiTunnel.Url)",
    "Local web base: http://127.0.0.1:$clientPort",
    "Local learner preview: http://127.0.0.1:$clientPort/sections",
    "Local admin preview: http://127.0.0.1:$clientPort/admin",
    "Local web port: $clientPort",
    "API tunnel PID: $($apiTunnel.ProcessId)",
    "Web tunnel PID: $($clientTunnel.ProcessId)",
    "API runtime log: $apiRuntimeLog",
    "Local STT runtime log: $localSttRuntimeLog",
    "Client runtime log: $clientRuntimeLog",
    "API tunnel stdout log: $($apiTunnel.StdOutLogPath)",
    "API tunnel stderr log: $($apiTunnel.StdErrLogPath)",
    "Web tunnel stdout log: $($clientTunnel.StdOutLogPath)",
    "Web tunnel stderr log: $($clientTunnel.StdErrLogPath)",
    'Keep the PowerShell windows and tunnel processes running while the customer is reviewing the prototype.'
) | Set-Content -LiteralPath $summaryPath -Encoding ASCII

Write-Host ''
Write-Host 'Shareable preview is ready.'
Write-Host "Send this learner link to the customer: $learnerUrl"
Write-Host "Admin link: $adminUrl"
Write-Host "API tunnel: $($apiTunnel.Url)"
Write-Host "Saved summary: $summaryPath"
Write-Host ''
Write-Host 'Important: keep the API window, Expo window, and tunnel processes running while the customer is testing.'
