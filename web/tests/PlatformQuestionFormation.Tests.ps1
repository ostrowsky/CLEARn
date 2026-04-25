Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$platformRoot = Join-Path $workspaceRoot 'platform'
$webRoot = Join-Path $workspaceRoot 'web'
. (Join-Path $PSScriptRoot 'Assertions.ps1')

Write-TestStep 'Question formation section replaces legacy without-context drill in live and template content'
foreach ($fileName in @('content.template.json', 'content.json')) {
    $content = Get-Content -LiteralPath (Join-Path $webRoot ('data\' + $fileName)) -Raw | ConvertFrom-Json
    $section = $content.sections | Where-Object { $_.id -eq 'asking-without-context' } | Select-Object -First 1
    Assert-True -Condition ($null -ne $section) -Message "$fileName should keep the route-compatible 1.3 section."
    Assert-Equal -Expected '1.3 Question formation' -Actual ([string]$section.eyebrow)
    Assert-Equal -Expected 'Practice forming grammatically correct questions.' -Actual ([string]$section.title)
    Assert-Match -Actual ([string]$section.summary) -Pattern 'WH questions'
    Assert-Equal -Expected 1 -Actual @($section.blocks).Count -Message "$fileName should remove the old explanatory legacy block."
    Assert-Equal -Expected 'practice-without-context' -Actual ([string]$section.blocks[0].kind)
    Assert-Equal -Expected 'Questions drill' -Actual ([string]$section.blocks[0].title)

    Assert-True -Condition ($null -ne $content.meta.practice.questionFormationFeedback) -Message "$fileName is missing question formation feedback copy."
    Assert-True -Condition ([int]$content.meta.practice.questionFormationRoundDurationMs -ge 1000) -Message "$fileName should expose editable question formation round timing in practice meta."
    Assert-True -Condition ([int]$content.meta.practice.questionFormationVisibleDurationMs -ge 1000) -Message "$fileName should expose editable question formation visible timing in practice meta."
    Assert-True -Condition ([int]$content.meta.practice.questionFormationHiddenDurationMs -ge 1000) -Message "$fileName should expose editable question formation hidden timing in practice meta."
    Assert-Match -Actual ([string]$content.meta.ui.labels.questionFormationCountdown) -Pattern '\{seconds\}'
    Assert-True -Condition (@($content.meta.practice.questionFormationDeck).Count -ge 2) -Message "$fileName should seed fallback question formation sentences."
    foreach ($exercise in @($content.meta.practice.questionFormationDeck)) {
        Assert-True -Condition ((([string]$exercise.sentence).Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries)).Count -le 15) -Message "$fileName question formation sentence should stay within 15 words."
        Assert-Equal -Expected 3 -Actual @($exercise.blanks).Count -Message "$fileName question formation exercise should contain three blanks."
    }
}

Write-TestStep 'Platform API exposes LLM-backed question formation generation and checking'
$domainSource = Get-Content -LiteralPath (Join-Path $platformRoot 'packages\domain\src\practice.ts') -Raw
foreach ($pattern in @(
    'QuestionFormationBlank',
    'QuestionFormationExercise',
    'expectedQuestion',
    'acceptedQuestions'
)) {
    Assert-Match -Actual $domainSource -Pattern $pattern
}

$contractSource = Get-Content -LiteralPath (Join-Path $platformRoot 'packages\contracts\src\api.ts') -Raw
foreach ($pattern in @(
    'QuestionFormationRequest',
    'CheckQuestionFormationRequest',
    'generateQuestionFormation',
    'checkQuestionFormation'
)) {
    Assert-Match -Actual $contractSource -Pattern $pattern
}

$providerTypesSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\providers\types.ts') -Raw
Assert-Match -Actual $providerTypesSource -Pattern 'generateQuestionFormation'

$practiceServiceSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\modules\practice\practice.service.ts') -Raw
foreach ($pattern in @(
    'defaultQuestionFormationDeck',
    'normalizeQuestionFormationExercise',
    'generateQuestionFormation',
    'checkQuestionFormation',
    'no more than 15 words',
    'proceduralQuestionFormationCatalog',
    'buildProceduralQuestionFormation',
    'containsAnswerLeak',
    'startsWithWhWord',
    'hasQuestionFormationGrammar',
    'hasQuestionFormationPronounReference',
    'hasQuestionFormationDidVerbReference',
    'hasQuestionFormationVisibleContextAlignment',
    'pronounReferenceAccepted',
    'didVerbReferenceAccepted',
    'visibleContextAccepted',
    'overlap >= 0\.28'
)) {
    Assert-Match -Actual $practiceServiceSource -Pattern $pattern
}
foreach ($pattern in @(
    'Whom',
    'Whose',
    'Which',
    'Why',
    'How often',
    'How far',
    'How much',
    'How soon',
    'How fast'
)) {
    Assert-Match -Actual $practiceServiceSource -Pattern $pattern
}
Assert-True -Condition ($practiceServiceSource -cnotmatch 'hasQuestionMark && startsCorrectly') -Message 'Question formation should not reject STT transcripts only because punctuation is missing.'
Assert-True -Condition ($practiceServiceSource -match 'deckOffset < uniqueDeck\.length') -Message 'Question formation should use configured examples first, then procedural fallback for unlimited variety.'
Assert-True -Condition ($practiceServiceSource -match 'overlap >= 0\.28 \|\| pronounReferenceAccepted') -Message 'Question formation should accept short visible-context questions like "Who will review it?".'
Assert-True -Condition ($practiceServiceSource -match 'pronounReferenceAccepted \|\| didVerbReferenceAccepted') -Message 'Question formation should accept visible-context did-questions like "Who did fix it yesterday?".'
Assert-True -Condition ($practiceServiceSource -match 'visibleContextAccepted\s*&&\s*\(overlap >= 0\.28 \|\| pronounReferenceAccepted \|\| didVerbReferenceAccepted\)') -Message 'Question formation should require visible-context alignment before accepting approximate matches.'

$routesSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\routes\registerRoutes.ts') -Raw
foreach ($pattern in @(
    '/api/practice/question-formation',
    '/api/practice/question-formation/check',
    'practiceService.generateQuestionFormation',
    'practiceService.checkQuestionFormation'
)) {
    Assert-Match -Actual $routesSource -Pattern $pattern
}

Write-TestStep 'Learner screen renders the timed sentence visibility cycle and STT question rows inline'
$apiClientSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\src\lib\api.ts') -Raw
foreach ($pattern in @(
    'generateQuestionFormation',
    'checkQuestionFormation',
    '/api/practice/question-formation'
)) {
    Assert-Match -Actual $apiClientSource -Pattern $pattern
}

$componentSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\src\components\practice\QuestionFormationPractice.tsx') -Raw
foreach ($pattern in @(
    'QuestionFormationPractice',
    'useSpeechDraft',
    'setTargetsVisible',
    'setSecondsRemaining',
    'getPracticeConfig',
    'questionFormationRoundDurationMs',
    'questionFormationVisibleDurationMs',
    'questionFormationHiddenDurationMs',
    'roundDurationMs',
    'visibleDurationMs',
    'hiddenDurationMs',
    'renderHighlightedSentence',
    'targetAnswer',
    'correctAnswer',
    'hiddenTargetAnswer',
    'hiddenTargetPlaceholder',
    'countdownPill',
    "status === 'correct'",
    'hintsByBlank',
    'setHintsByBlank',
    'checkCorrectness',
    'apiClient\.generateQuestionFormation',
    'apiClient\.checkQuestionFormation',
    'startRecording',
    'stopRecording'
)) {
    Assert-Match -Actual $componentSource -Pattern $pattern
}
Assert-Match -Actual $componentSource -Pattern '__\(\$\{piece\.blank\.index\}\)__'
Assert-True -Condition ($componentSource -notmatch 'questionFormationRevealDelayMs') -Message 'Question formation should use the new round/visible/hidden timing settings, not the old reveal delay.'
Assert-True -Condition ($componentSource -notmatch 'hiddenSentenceCard') -Message 'Question formation should keep the sentence visible and hide only target words.'
Assert-True -Condition ($componentSource -match 'hiddenTargetAnswer') -Message 'Question formation should keep a transparent style for hidden unresolved answer text.'
Assert-True -Condition ($componentSource -match 'hiddenTargetPlaceholder') -Message 'Question formation should render numbered placeholders for unresolved hidden targets.'
Assert-True -Condition ($componentSource -match 'hiddenTargetPlaceholder:\s*\{\s*color:\s*tokens\.colors\.accentDeep') -Message 'Question formation numbered placeholders should remain visible.'
Assert-True -Condition ($componentSource -notmatch 'setTimeout\(\(\) => \{\s*setTargetsVisible\(false\);\s*\},\s*15000\s*\)') -Message 'Question formation visible timing must not be hardcoded in the learner screen.'

$sectionSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\app\section\[id].tsx') -Raw
foreach ($pattern in @(
    'QuestionFormationPractice',
    "renderer === 'practice-without-context'"
)) {
    Assert-Match -Actual $sectionSource -Pattern $pattern
}

Write-Host 'Platform question formation tests passed.'
