param([int]$Port = 8080)

Set-StrictMode -Version Latest

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

& (Join-Path $PSScriptRoot 'tests\run-admin-tests.ps1')

$selectedPort = if (Test-PortListening -Port $Port) { Get-FreePort -StartPort ($Port + 1) } else { $Port }
if ($selectedPort -ne $Port) {
    Write-Host "Port $Port is busy. Starting a fresh admin server on port $selectedPort instead."
}

Start-Job -ScriptBlock { param($Value) Start-Sleep -Milliseconds 600; explorer.exe $Value } -ArgumentList "http://localhost:$selectedPort/admin" | Out-Null
& (Join-Path $PSScriptRoot 'server.ps1') -Port $selectedPort
