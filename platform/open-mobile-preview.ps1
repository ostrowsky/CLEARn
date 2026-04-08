Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

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

function Get-PreferredIPv4 {
    $candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and
            $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL|VirtualBox|VMware'
        } |
        Sort-Object InterfaceMetric

    return ($candidates | Select-Object -First 1 -ExpandProperty IPAddress)
}

function Test-PortListening {
    param([int]$Port)

    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

$localIp = Get-PreferredIPv4
if (-not $localIp) {
    throw 'Could not detect a usable local IPv4 address. Connect to Wi-Fi/Ethernet and try again.'
}

$apiUrl = "http://$localIp:4000"

if (-not (Test-PortListening -Port 4000)) {
    Write-Host "Starting API on $apiUrl ..."
    Start-Process powershell.exe -ArgumentList @(
        '-NoExit',
        '-ExecutionPolicy', 'Bypass',
        '-Command',
        "Set-Location '$projectRoot'; `$env:APP_PORT='4000'; `$env:APP_BASE_URL='$apiUrl'; pnpm.cmd dev:api"
    ) | Out-Null
}
else {
    Write-Host 'API is already running on port 4000.'
}

Write-Host 'Starting Expo mobile preview in a new window...'
Start-Process powershell.exe -ArgumentList @(
    '-NoExit',
    '-ExecutionPolicy', 'Bypass',
    '-Command',
    "Set-Location '$projectRoot'; `$env:EXPO_PUBLIC_API_BASE_URL='$apiUrl'; pnpm.cmd dev:client"
) | Out-Null

Write-Host ''
Write-Host 'Mobile preview mode is ready.'
Write-Host "1. Open Expo Go on your phone."
Write-Host "2. Make sure the phone is on the same Wi-Fi network as this computer."
Write-Host "3. In Expo Go, use its built-in QR scanner and scan the QR code from the Expo window."
Write-Host "4. Do not use the phone camera app for the Expo QR code."
Write-Host ''
Write-Host "API base URL for the phone: $apiUrl"
Write-Host 'Keep both PowerShell windows open while testing.'