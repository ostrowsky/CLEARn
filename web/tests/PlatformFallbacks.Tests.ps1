Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$platformRoot = Join-Path $workspaceRoot 'platform'
$webRoot = Join-Path $workspaceRoot 'web'
. (Join-Path $PSScriptRoot 'Assertions.ps1')

Write-TestStep 'Practice service provides context-aware talk fallbacks when live chat providers fail'
$practiceSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\modules\practice\practice.service.ts') -Raw
foreach ($pattern in @(
    'buildClarifyFallback',
    'buildAskAfterFallback',
    'inferConversationContext',
    'buildAskAfterSpeechLines',
    'buildLikelyProfessionalSpeech',
    'normalizeSpeechTopic',
    'limitWords',
    'no more than 100 words',
    'professional yet friendly speech',
    'buildAskAfterSampleQuestion',
    'pickAskAfterFocus',
    'suggestedFocus',
    "generatorMode: 'content-fallback'",
    'Could you explain what still needs to happen there before the release\?'
)) {
    Assert-Match -Actual $practiceSource -Pattern $pattern
}

Write-TestStep 'Hugging Face chat provider uses a dedicated compatible fallback model'
$hfChatSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\providers\chat\huggingface.ts') -Raw
foreach ($pattern in @(
    'resolveHuggingFaceChatModel',
    'env\.HF_CHAT_MODEL',
    'readErrorDetails',
    'Hugging Face chat error:'
)) {
    Assert-Match -Actual $hfChatSource -Pattern $pattern
}

Write-TestStep 'Session services infer scenario and roles instead of echoing the full learner sentence'
foreach ($servicePath in @(
    (Join-Path $platformRoot 'apps\api\src\modules\session\coach.service.ts'),
    (Join-Path $platformRoot 'apps\api\src\modules\session\answering.service.ts')
)) {
    $source = Get-Content -LiteralPath $servicePath -Raw
    Assert-Match -Actual $source -Pattern 'inferConversationContext'
    Assert-Match -Actual $source -Pattern 'function summarizeContext\(context: string\)'
}

Write-TestStep 'Live and template content keep natural fallback wording and role-aware prompts'
foreach ($fileName in @('content.template.json', 'content.json')) {
    $content = Get-Content -LiteralPath (Join-Path $webRoot ('data\' + $fileName)) -Raw | ConvertFrom-Json
    $fallbackReply = [string]$content.meta.practice.learningChat.fallbackReplyTemplate
    Assert-True -Condition ($fallbackReply -notmatch '\{contextSummary\}') -Message "$fileName should not echo raw contextSummary in the coach fallback reply."
    Assert-Equal -Expected 'Thanks. In this {scenarioLabel} conversation, I would reply in the correct role, stay polite, and add one practical detail before the next step.' -Actual $fallbackReply
    Assert-True -Condition (@($content.meta.practice.answeringSession.questionTypes.good.fallbackQuestions) -contains 'Which result should we highlight first in this {scenario}, and why does it matter?') -Message "$fileName should include the scenario-aware good-question fallback."
    Assert-True -Condition (-not (@($content.meta.practice.answeringSession.questionTypes.good.fallbackQuestions) -contains 'What result are you most proud of in {topic}, and why does it matter?')) -Message "$fileName still contains the raw-context good-question fallback wording."
    Assert-True -Condition (@($content.meta.practice.learningChat.scenarios.oneToOne.starterSuggestions) -contains 'Which result from the last period are you most proud of?') -Message "$fileName should include the more natural one-to-one opening question."
    Assert-True -Condition (@($content.meta.practice.learningChat.scenarios.meeting.fallbackSuggestions) -contains 'The main result I want to highlight is...') -Message "$fileName should include meeting fallback suggestions that fit a review or update."
    Assert-Equal -Expected 'Likely short speech' -Actual ([string]$content.meta.ui.feedback.generatedTalkTitle) -Message "$fileName should label ask-after output as a likely speech, not a fact list."
    Assert-Match -Actual ([string]$content.meta.ui.placeholders.askAfterContext) -Pattern 'speech is about the new throughput metric' -Message "$fileName should guide users to enter a likely speech topic."
    $afterTalk = $content.sections | Where-Object { $_.id -eq 'asking-after-talk' }
    $contextBodies = @($afterTalk.blocks | Where-Object { $_.id -eq 'context-leads' } | Select-Object -ExpandProperty materials | Select-Object -ExpandProperty body)
    Assert-True -Condition ($contextBodies -contains 'You mentioned ...') -Message "$fileName should keep the more natural ask-after context phrase bank."
}

Write-Host 'Platform fallback tests passed.'


