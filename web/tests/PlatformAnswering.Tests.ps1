Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$platformRoot = Join-Path $workspaceRoot 'platform'
$webRoot = Join-Path $workspaceRoot 'web'
. (Join-Path $PSScriptRoot 'Assertions.ps1')

Write-TestStep 'Mixed answering session config exists in live and template content'
foreach ($fileName in @('content.template.json', 'content.json')) {
    $content = Get-Content -LiteralPath (Join-Path $webRoot ('data\' + $fileName)) -Raw | ConvertFrom-Json
    $sessionConfig = $content.meta.practice.answeringSession
    Assert-Equal -Expected 10 -Actual ([int]$sessionConfig.questionCount)
    Assert-Equal -Expected 10 -Actual @($sessionConfig.mixedQuestionTypes).Count
    foreach ($type in @('good', 'difficult', 'unnecessary', 'irrelevant')) {
        Assert-True -Condition ($null -ne $sessionConfig.questionTypes.$type) -Message "$fileName is missing question type config for $type."
        Assert-True -Condition ([string]::IsNullOrWhiteSpace([string]$sessionConfig.questionTypes.$type.selectorLabel) -eq $false) -Message "$fileName is missing selectorLabel for $type."
        Assert-True -Condition (@($sessionConfig.questionTypes.$type.reactionOptions).Count -ge 1) -Message "$fileName needs at least one reaction option for $type."
        Assert-True -Condition (@($sessionConfig.questionTypes.$type.fallbackQuestions).Count -ge 3) -Message "$fileName needs fallback questions for $type."
    }
    Assert-True -Condition ([string]$sessionConfig.answeringEvaluationSystemPrompt).Contains('must only correct the learner') -Message "$fileName should forbid adding a reaction phrase to improved answers."
    Assert-True -Condition ([string]$sessionConfig.answeringEvaluationSystemPrompt).Contains('never a question') -Message "$fileName should forbid improved answers from becoming questions."
    Assert-True -Condition ([string]$sessionConfig.answeringEvaluationPromptTemplate).Contains('must not include any reaction phrase') -Message "$fileName should keep the improved-answer restriction in the evaluation prompt."
    Assert-True -Condition ([string]$sessionConfig.answeringEvaluationPromptTemplate).Contains('Do not turn the learner reply into a question') -Message "$fileName should tell the evaluator not to rewrite answers as questions."

    Assert-True -Condition ([string]::IsNullOrWhiteSpace([string]$content.meta.ui.labels.reactionDropdownHint) -eq $false) -Message "$fileName is missing reactionDropdownHint label."
    Assert-True -Condition ([string]::IsNullOrWhiteSpace([string]$content.meta.ui.admin.fieldLabels.selectorLabel) -eq $false) -Message "$fileName is missing admin selectorLabel field label."
    Assert-True -Condition ([string]::IsNullOrWhiteSpace([string]$content.meta.ui.admin.fieldLabels.reactionOptions) -eq $false) -Message "$fileName is missing admin reactionOptions field label."

    $hub = $content.sections | Where-Object { $_.id -eq 'answering-hub' }
    Assert-True -Condition ($null -ne ($hub.blocks | Where-Object { $_.id -eq 'answer-mixed-card' -and $_.route -eq '/answering/mixed' })) -Message "$fileName is missing the mixed answering card in the answering hub."
    Assert-True -Condition ($null -ne ($content.sections | Where-Object { $_.id -eq 'answering-mixed' -and $_.route -eq '/answering/mixed' })) -Message "$fileName is missing the answering-mixed section."
}

Write-TestStep 'Platform answering service and client support reaction-first text plus STT flow'
$serviceSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\modules\session\answering.service.ts') -Raw
foreach ($pattern in @(
    'questionPlan',
    'mixedQuestionTypes',
    'reactionRequiredFeedback',
    'answerRequiredFeedback',
    'generateAnsweringQuestion',
    'generateAnsweringEvaluation',
    'politenessScore',
    'grammarScore',
    'improvedAnswer',
    'stripLeadingReactionPhrase',
    'containsQuestionSentence',
    'removeQuestionSentences',
    'sanitizeImprovedAnswerBody',
    'buildImprovedAnswerWithChosenReaction',
    'selectedReaction\?\.text \|\| turn\.preferredReactionText',
    'buildSummary',
    'selectorLabel',
    'buildReactionCategories'
)) {
    Assert-Match -Actual $serviceSource -Pattern $pattern
}

$routesSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\routes\registerRoutes.ts') -Raw
foreach ($pattern in @(
    "app\.post\('/api/answering/session/respond', async \(request, reply\)",
    'if \(!String\(body\.reactionOptionId \|\| ''''\)\.trim\(\)\)',
    'reply\.code\(400\)',
    'statusCode: 400',
    'Choose the most appropriate reaction phrase before you submit the answer\.',
    'if \(isBadRequestMessage\(message\)\)'
)) {
    Assert-Match -Actual $routesSource -Pattern $pattern
}

$apiSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\src\lib\api.ts') -Raw
foreach ($pattern in @(
    'AnsweringSessionMode',
    'reactionOptionId',
    "transcriptSource: 'text' \| 'speech'",
    'startAnswering\(context: string, mode: AnsweringSessionMode\)',
    'respondAnswering\(sessionId: string, reactionOptionId: string, userReply: string'
)) {
    Assert-Match -Actual $apiSource -Pattern $pattern
}

$screenSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\app\practice\answering\[mode].tsx') -Raw
foreach ($pattern in @(
    'apiClient\.speechToText',
    'selectedReactionId',
    'prepareSpeechPayloadForStt',
    'selectedReactionCategory',
    'handleSelectReactionCategory',
    'handleSelectReactionOption',
    'getResolvedReactionCategories',
    'const resolvedReactionCategories = getResolvedReactionCategories\(content, currentTurn\)',
    'resolvedReactionCategories\.map',
    'reactionCategoryButton',
    'reactionCategoryChevron',
    "const reactionDropdownHintLabel = getNestedString\(ui, \['labels', 'reactionDropdownHint'\], 'Select opening phrase'\)",
    'ScrollView',
    'horizontal',
    'startRecordingLabel',
    'stopRecordingLabel',
    'session\.summary',
    'questionProgressLabel',
    'if \(!selectedReactionId\)',
    'setScreenError\(''Choose the most appropriate reaction phrase before you submit the answer\.''\)'
)) {
    Assert-Match -Actual $screenSource -Pattern $pattern
}
Assert-True -Condition ($screenSource -notmatch 'currentTurn\.reactionCategories\.map') -Message 'Answering screen should not assume the API always sends reactionCategories.'
Assert-True -Condition ($screenSource -notmatch 'currentTurn\.providerError') -Message 'Answering screen should not expose raw provider errors for the current question.'
Assert-True -Condition ($screenSource -notmatch 'currentTurn\.questionTypeLabel') -Message 'Answering screen should not show the current question type label to the learner.'
Assert-True -Condition ($screenSource -notmatch 'turn\.questionTypeLabel') -Message 'Answering screen should not show past question type labels to the learner.'
Assert-True -Condition ($screenSource -notmatch 'turn\.providerError') -Message 'Answering screen should not expose raw provider errors in conversation history.'

Write-Host 'Platform answering session tests passed.'

