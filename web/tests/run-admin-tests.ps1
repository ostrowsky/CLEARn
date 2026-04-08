Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$tests = @(
    (Join-Path $PSScriptRoot 'ContentStore.Tests.ps1'),
    (Join-Path $PSScriptRoot 'Backup.Tests.ps1'),
    (Join-Path $PSScriptRoot 'Server.Tests.ps1'),
    (Join-Path $PSScriptRoot 'Admin.Ui.Tests.ps1'),
    (Join-Path $PSScriptRoot 'Admin.Tests.ps1'),
    (Join-Path $PSScriptRoot 'ContentDriven.Tests.ps1'),
    (Join-Path $PSScriptRoot 'PlatformAdmin.Tests.ps1'),
    (Join-Path $PSScriptRoot 'PlatformAdmin.Api.Tests.ps1'),
    (Join-Path $PSScriptRoot 'PlatformClarify.Tests.ps1'),
    (Join-Path $PSScriptRoot 'PlatformExerciseTemplates.Tests.ps1'),
    (Join-Path $PSScriptRoot 'PlatformAnswering.Tests.ps1'),
    (Join-Path $PSScriptRoot 'PlatformSyntax.Tests.ps1'),
    (Join-Path $PSScriptRoot 'PlatformSpeech.Tests.ps1'),
    (Join-Path $PSScriptRoot 'PlatformAiStack.Tests.ps1'),
    (Join-Path $PSScriptRoot 'PlatformFallbacks.Tests.ps1'),
    (Join-Path $PSScriptRoot 'PlatformClarify.Api.Tests.ps1'),
    (Join-Path $PSScriptRoot 'PlatformCoach.Tests.ps1'),
    (Join-Path $PSScriptRoot 'PlatformCoach.Api.Tests.ps1')
)

foreach ($test in $tests) {
    Write-Host ("Running {0}" -f (Split-Path -Leaf $test))
    & $test
}

Write-Host 'All admin tests passed.'
