Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$node = (Get-Command node -ErrorAction Stop).Source
& $node (Join-Path $PSScriptRoot 'api-outage.test.mjs')
if ($LASTEXITCODE -ne 0) { throw 'API outage matrix failed.' }
& $node (Join-Path $PSScriptRoot 'production-api-smoke.test.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Production smoke self-tests failed.' }

& $node (Join-Path $PSScriptRoot 'api-outage.test.mjs') --probe-malformed
if ($LASTEXITCODE -ne 0) { throw 'Malformed API contracts failed.' }
& $node (Join-Path $PSScriptRoot 'api-outage.test.mjs') --probe-sessions
if ($LASTEXITCODE -ne 0) { throw 'Session continuity failed.' }

& $node (Join-Path $PSScriptRoot 'api-remediation.test.mjs')
if ($LASTEXITCODE -ne 0) { throw 'API remediation runtime failed.' }
