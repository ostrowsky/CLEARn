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
if (Test-Path -LiteralPath $summaryPath) {
    Remove-Item -LiteralPath $summaryPath -Force -ErrorAction SilentlyContinue
}

Write-Host 'Running full tests before preview...'
& $testsScript

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
$clientPort = Get-FreePort -StartPort 8081
$apiRuntimeLog = Join-Path $env:TEMP ('softskills-api-runtime-' + [Guid]::NewGuid().ToString('n') + '.log')
$clientRuntimeLog = Join-Path $env:TEMP ('softskills-client-runtime-' + [Guid]::NewGuid().ToString('n') + '.log')

if (-not (Test-PortListening -Port $apiPort)) {
    Write-Host 'Starting API in a new window...'
    $apiCommand = "Set-Location '$projectRoot'; `$env:APP_PORT='$apiPort'; `$env:APP_BASE_URL='http://127.0.0.1:$apiPort'; pnpm.cmd dev:api 2>&1 | Tee-Object -FilePath '$apiRuntimeLog'"
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

Write-Host 'Creating public API tunnel...'
$apiTunnel = Start-QuickTunnel -CloudflaredPath $cloudflared.Source -Port $apiPort -Label 'api'

Write-Host "Starting Expo web preview on port $clientPort in a new window..."
$clientCommand = "Set-Location '$projectRoot'; `$env:EXPO_PUBLIC_API_BASE_URL='$($apiTunnel.Url)'; pnpm.cmd --filter @softskills/client exec expo start --clear --web --port $clientPort 2>&1 | Tee-Object -FilePath '$clientRuntimeLog'"
Start-Process powershell.exe -ArgumentList @(
    '-NoExit',
    '-ExecutionPolicy', 'Bypass',
    '-Command',
    $clientCommand
) | Out-Null

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
