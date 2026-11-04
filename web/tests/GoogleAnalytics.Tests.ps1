Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$nodeCommand = Get-Command node -ErrorAction Stop
& $nodeCommand.Source (Join-Path $PSScriptRoot 'google-analytics.test.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Google Analytics tests failed.' }
