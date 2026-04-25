Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$platformRoot = Join-Path $workspaceRoot 'platform'
. (Join-Path $PSScriptRoot 'Assertions.ps1')

Write-TestStep 'Shared input validation module centralizes reusable user-input checks'
$validationSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\modules\shared\inputValidation.ts') -Raw
foreach ($pattern in @(
    'normalizeWhitespace',
    'normalizeLooseText',
    'getTokenOverlapRatio',
    'looksMeaningfulUserInput',
    'startsWithWhWord',
    'containsAnswerLeak',
    'hasQuestionFormationGrammar',
    'hasQuestionFormationPronounReference',
    'hasQuestionFormationDidVerbReference',
    'hasQuestionFormationVisibleContextAlignment'
)) {
    Assert-Match -Actual $validationSource -Pattern $pattern
}

Write-TestStep 'Practice and session services use the shared input validation module'
$practiceSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\modules\practice\practice.service.ts') -Raw
$answeringSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\modules\session\answering.service.ts') -Raw
$coachSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\modules\session\coach.service.ts') -Raw

Assert-Match -Actual $practiceSource -Pattern "\.\./shared/inputValidation"
Assert-Match -Actual $practiceSource -Pattern 'looksMeaningfulUserInput'
Assert-Match -Actual $practiceSource -Pattern 'hasQuestionFormationVisibleContextAlignment'

Assert-Match -Actual $answeringSource -Pattern "\.\./shared/inputValidation"
Assert-Match -Actual $answeringSource -Pattern 'looksMeaningfulUserInput'

Assert-Match -Actual $coachSource -Pattern "\.\./shared/inputValidation"
Assert-Match -Actual $coachSource -Pattern 'looksMeaningfulUserInput'

Write-Host 'Platform input validation tests passed.'
