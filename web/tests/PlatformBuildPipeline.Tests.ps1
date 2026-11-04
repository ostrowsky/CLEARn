Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$nodeCommand = Get-Command node -ErrorAction Stop
& $nodeCommand.Source (Join-Path $PSScriptRoot 'build-compat.test.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Production build compatibility tests failed.' }
