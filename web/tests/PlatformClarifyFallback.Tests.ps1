Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$nodeCommand = Get-Command node -ErrorAction Stop
& $nodeCommand.Source (Join-Path $PSScriptRoot 'clarify-fallback.test.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Clarification fallback runtime tests failed.' }
