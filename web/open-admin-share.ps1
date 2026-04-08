Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $projectRoot 'tests\run-admin-tests.ps1')

function ConvertTo-AsciiJson {
    param($Value)

    $json = $Value | ConvertTo-Json -Depth 30
    $builder = New-Object System.Text.StringBuilder
    foreach ($char in $json.ToCharArray()) {
        if ([int][char]$char -gt 127) {
            [void]$builder.AppendFormat('\u{0:x4}', [int][char]$char)
        }
        else {
            [void]$builder.Append($char)
        }
    }

    return $builder.ToString()
}

function Test-PortListening {
    param([int]$Port)

    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Get-FreePort {
    param([int]$StartPort = 8080)

    $candidate = $StartPort
    while (Test-PortListening -Port $candidate) {
        $candidate++
    }

    return $candidate
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

function Invoke-AdminSaveSmokeCheck {
    param([int]$Port)

    $contentResponse = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:$Port/api/admin/content") -TimeoutSec 10
    $content = $contentResponse.Content | ConvertFrom-Json
    $json = ConvertTo-AsciiJson -Value $content
    $saveResponse = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:$Port/api/admin/content") -Method Post -ContentType 'application/json; charset=utf-8' -Body $json -TimeoutSec 10
    $saved = $saveResponse.Content | ConvertFrom-Json
    if (-not $saved.sections) {
        throw 'Admin save smoke-check did not return a sections collection.'
    }
}

function Start-QuickTunnel {
    param(
        [string]$CloudflaredPath,
        [int]$Port,
        [string]$Label
    )

    $token = [guid]::NewGuid().ToString('N').Substring(0, 8)
    $stdoutPath = Join-Path $env:TEMP "softskills-$Label-$token.out.log"
    $stderrPath = Join-Path $env:TEMP "softskills-$Label-$token.err.log"

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

$port = Get-FreePort -StartPort 8080
if ($port -eq 8080) {
    Write-Host 'Starting a fresh admin server on port 8080...'
}
else {
    Write-Host "Port 8080 is busy. Starting a fresh admin server on port $port instead."
}

Start-Process powershell.exe -ArgumentList @(
    '-NoExit',
    '-ExecutionPolicy', 'Bypass',
    '-Command',
    "Set-Location '$projectRoot'; powershell -ExecutionPolicy Bypass -File '.\server.ps1' -Port $port"
) | Out-Null

if (-not (Wait-ForHttpReady -Url "http://127.0.0.1:$port/admin")) {
    throw "Admin panel did not become ready on port $port."
}

Write-Host 'Running admin save smoke-check...'
Invoke-AdminSaveSmokeCheck -Port $port

Write-Host 'Creating public admin tunnel...'
$adminTunnel = Start-QuickTunnel -CloudflaredPath $cloudflared.Source -Port $port -Label 'admin'

$summaryPath = Join-Path $projectRoot 'share-admin-link.txt'
@(
    "Public admin preview: $($adminTunnel.Url)/admin",
    "Base tunnel URL: $($adminTunnel.Url)",
    "Local admin port: $port",
    "Admin tunnel PID: $($adminTunnel.ProcessId)",
    "Admin tunnel stdout log: $($adminTunnel.StdOutLogPath)",
    "Admin tunnel stderr log: $($adminTunnel.StdErrLogPath)",
    'Keep the admin server window and tunnel process running while the admin panel is being reviewed.'
) | Set-Content -LiteralPath $summaryPath -Encoding UTF8

Write-Host ''
Write-Host 'Shareable admin preview is ready.'
Write-Host "Send this admin link: $($adminTunnel.Url)/admin"
Write-Host "Saved summary: $summaryPath"
Write-Host ''
Write-Host 'Important: keep the admin server window and tunnel process running while the link is in use.'


