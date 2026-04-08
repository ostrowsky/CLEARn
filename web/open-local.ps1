param([int]$Port = 8080)

Set-StrictMode -Version Latest
& (Join-Path $PSScriptRoot 'server.ps1') -Port $Port -OpenBrowser
