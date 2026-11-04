Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'Assertions.ps1')

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Read-RepoFile {
    param([string]$RelativePath)
    return Get-Content -LiteralPath (Join-Path $repoRoot $RelativePath) -Raw
}

Write-TestStep 'Client practice API has deterministic fallbacks instead of exposing raw fetch failures'
$apiSource = Read-RepoFile 'platform\apps\client\src\lib\api.ts'
$questionFallbackSource = Read-RepoFile 'platform\packages\domain\src\inputValidation.ts'
foreach ($expected in @(
    'requestWithFallback',
    'buildAskAfterFallback',
    'buildQuestionFormationFallback',
    'buildAnsweringSession',
    'buildCoachSession',
    'request:fallback'
)) {
    Assert-Match -Actual $apiSource -Pattern $expected -Message "Client API fallback wiring is missing '$expected'."
}

foreach ($method in @('askAfter', 'generateQuestionFormation', 'startAnswering', 'startCoachChat')) {
    Assert-Match -Actual $apiSource -Pattern "$method[\s\S]*?requestWithFallback" -Message "$method should use requestWithFallback so learner screens stay usable when the API is unavailable."
}

Assert-Match -Actual $apiSource -Pattern 'Who will review it\?' -Message 'Fallback question formation should accept short correct hidden-context questions.'
foreach ($checker in @('checkClarifyAnswer', 'checkAskAfterAnswer', 'checkQuestionFormationAnswer')) {
    Assert-Match -Actual $apiSource -Pattern $checker -Message "Ready ASK checks must use the shared validator $checker."
}
Assert-Match -Actual $questionFallbackSource -Pattern 'hasQuestionFormationGrammar'
Assert-Match -Actual $questionFallbackSource -Pattern 'hasQuestionFormationVisibleContextAlignment'
Assert-Match -Actual $apiSource -Pattern 'Keep the selected reaction phrase unchanged' -Message 'Fallback answering feedback should preserve the selected reaction phrase.'
Assert-Match -Actual $apiSource -Pattern 'getVideoTranscript\(url: string\): Promise<VideoTranscriptResponse> \{[\s\S]*?requestWithFallback' -Message 'Video transcript loading should not expose raw network failures in learner screens.'
Assert-Match -Actual $apiSource -Pattern 'Transcript is temporarily unavailable' -Message 'Video transcript fallback should use a learner-safe message instead of raw Failed to fetch.'
Assert-Match -Actual $apiSource -Pattern 'getRequestTimeoutMs' -Message 'Practice fallback requests need bounded timeouts so screens do not hang on loading states.'
Assert-Match -Actual $apiSource -Pattern 'controller\.abort\(\)' -Message 'Client API should abort stalled requests and allow fallbacks to render.'
Assert-Match -Actual $apiSource -Pattern "path\.includes\('/api/speech/stt'\)[\s\S]*?return 20000;" -Message 'STT calls should keep a short interactive timeout.'
Assert-Match -Actual $apiSource -Pattern "path\.includes\('/api/speech/tts'\)[\s\S]*?return 15000;" -Message 'TTS calls should keep a short interactive timeout.'
Assert-True -Condition ($apiSource -notmatch "path\.includes\('/api/speech/'\) \|\|") -Message 'Generic speech routes should not inherit the long admin/media timeout.'

Write-TestStep 'Learner media uses bundled uploads directly in static previews'
$sectionSource = Read-RepoFile 'platform\apps\client\app\section\[id].tsx'
$askAfterSource = Read-RepoFile 'platform\apps\client\src\components\practice\AskAfterComposer.tsx'
$clarifySource = Read-RepoFile 'platform\apps\client\src\components\practice\ClarifyPracticeInlineList.tsx'
foreach ($source in @($sectionSource, $askAfterSource, $clarifySource)) {
    Assert-Match -Actual $source -Pattern "startsWith\('/uploads/'\)" -Message 'Bundled upload URLs should not be rewritten through the API host.'
}
Assert-True -Condition ($sectionSource -notmatch 'setStatus\(error\.message\)') -Message 'Inline video transcript UI should not render raw fetch exceptions.'
Assert-True -Condition ($askAfterSource -notmatch 'setVideoTranscriptStatus\(error\.message\)') -Message 'Ask-after video transcript UI should not render raw fetch exceptions.'

Write-TestStep 'Ask-after question builder keeps all three composed question parts'
$askAfterSource = Read-RepoFile 'platform\apps\client\src\components\practice\AskAfterComposer.tsx'
Assert-Match -Actual $askAfterSource -Pattern 'buildQuestion\(selectedContextPhrase, selectedFollowPhrase, tail\)' -Message 'Ask-after preview must combine context phrase, learner detail, and follow-up phrase.'
Assert-Match -Actual $askAfterSource -Pattern 'const finalQuestion = builtQuestion;' -Message 'Ask-after review should submit the builder output, not a separately edited preview.'
Assert-Match -Actual $askAfterSource -Pattern 'editable=\{false\}' -Message 'Ask-after preview should not look like the learner-controlled answer field.'
Assert-Match -Actual $askAfterSource -Pattern 'function applyContextPhrase' -Message 'Ask-after phrase selection should force the preview to use the newly selected context phrase.'
Assert-Match -Actual $askAfterSource -Pattern 'function applyFollowPhrase' -Message 'Ask-after phrase selection should force the preview to use the newly selected follow-up phrase.'
Assert-Match -Actual $askAfterSource -Pattern 'onPress=\{\(\) => applyContextPhrase\(item\)\}' -Message 'Context phrase buttons should apply the selected phrase to the composed question.'
Assert-Match -Actual $askAfterSource -Pattern 'onPress=\{\(\) => applyFollowPhrase\(item\)\}' -Message 'Follow-up phrase buttons should apply the selected phrase to the composed question.'

Write-TestStep 'Learning chat initial render is safe before a session exists'
$chatSource = Read-RepoFile 'platform\apps\client\app\practice\chat.tsx'
Assert-Match -Actual $chatSource -Pattern 'session\?\.completed' -Message 'Learning chat should not read session.completed before the session exists.'
Assert-Match -Actual $chatSource -Pattern 'session\?\.completed === false' -Message 'Learning chat composer should guard nullable session state with optional chaining.'
Assert-True -Condition ($chatSource -notmatch 'session && draft\.trim\(\) && !session\.completed') -Message 'Learning chat send state should not dereference session.completed while session can be null.'
Assert-True -Condition ($chatSource -notmatch 'session && !session\.completed') -Message 'Learning chat composer should not dereference session.completed while session can be null.'
Assert-True -Condition ($chatSource -notmatch '\{session\.completed') -Message 'Learning chat initial render should not crash before start.'

Write-Host 'Platform practice fallback tests passed.'

Assert-Match -Actual $apiSource -Pattern 'fallbackAnsweringSessions.has\(sessionId\)' -Message 'Only offline-created answering sessions may continue in the local map.'
Assert-Match -Actual $apiSource -Pattern 'fallbackCoachSessions.has\(sessionId\)' -Message 'Server chat sessions must not silently reset into offline sessions.'
