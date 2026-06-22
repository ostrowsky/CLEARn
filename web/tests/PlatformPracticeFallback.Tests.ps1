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
$questionFallbackSource = Read-RepoFile 'platform\apps\client\src\lib\questionFormationFallback.ts'
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

foreach ($method in @('askAfter', 'generateQuestionFormation', 'checkQuestionFormation', 'startAnswering', 'respondAnswering', 'startCoachChat', 'continueCoachChat')) {
    Assert-Match -Actual $apiSource -Pattern "$method[\s\S]*?requestWithFallback" -Message "$method should use requestWithFallback so learner screens stay usable when the API is unavailable."
}

Assert-Match -Actual $apiSource -Pattern 'Who will review it\?' -Message 'Fallback question formation should accept short correct hidden-context questions.'
Assert-Match -Actual $apiSource -Pattern "import \{ checkQuestionFormationFallback \} from './questionFormationFallback'" -Message 'Client API should use the shared question formation fallback checker.'
Assert-Match -Actual $questionFallbackSource -Pattern 'hasClientQuestionFormationGrammar' -Message 'Fallback question formation should validate WH question grammar instead of relying only on token overlap.'
Assert-Match -Actual $questionFallbackSource -Pattern 'objectQuestionLeads' -Message 'Fallback question formation should reject object WH questions without an auxiliary.'
Assert-Match -Actual $questionFallbackSource -Pattern 'modalAuxiliaries' -Message 'Fallback question formation should reject common auxiliary + past-tense grammar errors.'
Assert-Match -Actual $questionFallbackSource -Pattern 'acceptedLeads' -Message 'Fallback question formation should allow accepted variants such as Who for Whom.'
Assert-Match -Actual $apiSource -Pattern 'Keep the selected reaction phrase unchanged' -Message 'Fallback answering feedback should preserve the selected reaction phrase.'
Assert-Match -Actual $apiSource -Pattern 'getVideoTranscript\(url: string\): Promise<VideoTranscriptResponse> \{[\s\S]*?requestWithFallback' -Message 'Video transcript loading should not expose raw network failures in learner screens.'
Assert-Match -Actual $apiSource -Pattern 'Transcript is temporarily unavailable' -Message 'Video transcript fallback should use a learner-safe message instead of raw Failed to fetch.'
Assert-Match -Actual $apiSource -Pattern 'getRequestTimeoutMs' -Message 'Practice fallback requests need bounded timeouts so screens do not hang on loading states.'
Assert-Match -Actual $apiSource -Pattern 'controller\.abort\(\)' -Message 'Client API should abort stalled requests and allow fallbacks to render.'
Assert-Match -Actual $apiSource -Pattern "path\.includes\('/api/speech/stt'\)[\s\S]*?return 15000;" -Message 'STT calls should keep a short interactive timeout.'
Assert-Match -Actual $apiSource -Pattern "path\.includes\('/api/speech/tts'\)[\s\S]*?return 15000;" -Message 'TTS calls should keep a short interactive timeout.'
Assert-True -Condition ($apiSource -notmatch "path\.includes\('/api/speech/'\) \|\|") -Message 'Generic speech routes should not inherit the long admin/media timeout.'

Write-TestStep 'Client question formation fallback rejects malformed WH grammar at runtime'
$platformRoot = Join-Path $repoRoot 'platform'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$tsxCli = Join-Path $platformRoot 'node_modules\tsx\dist\cli.mjs'
if ($nodeCommand -and (Test-Path -LiteralPath $tsxCli)) {
    $tempRoot = Join-Path $platformRoot ('.tmp-client-fallback-' + [System.Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tempRoot | Out-Null
    $fallbackCheckPath = Join-Path $tempRoot 'check-client-question-fallback.mts'
    @'
import * as fallbackModule from '../apps/client/src/lib/questionFormationFallback.ts';

const checkQuestionFormationFallback = fallbackModule.checkQuestionFormationFallback || fallbackModule.default?.checkQuestionFormationFallback;
if (!checkQuestionFormationFallback) {
  throw new Error('checkQuestionFormationFallback export was not found');
}

const payload = {
  sentence: 'Stakeholders will review return on investment at the end of the year.',
  answer: 'return on investment',
  whWord: 'What',
  expectedQuestion: 'What will stakeholders review?',
  acceptedQuestions: ['What will they review?'],
};

const malformedMissingAuxiliary = checkQuestionFormationFallback({
  ...payload,
  userQuestion: 'What they review?',
});
const validPronounVariant = checkQuestionFormationFallback({
  ...payload,
  userQuestion: 'What will they review?',
});
const malformedAuxiliaryPast = checkQuestionFormationFallback({
  ...payload,
  userQuestion: 'What will they reviewed?',
});

console.log(JSON.stringify({
  malformedMissingAuxiliary,
  validPronounVariant,
  malformedAuxiliaryPast,
}));
'@ | Set-Content -LiteralPath $fallbackCheckPath -Encoding UTF8

    try {
        Push-Location $platformRoot
        $env:EXPO_PUBLIC_API_BASE_URL = 'http://127.0.0.1:1'
        $fallbackOutput = & $nodeCommand.Source $tsxCli $fallbackCheckPath
        $fallbackResult = $fallbackOutput | ConvertFrom-Json
        Assert-Equal -Expected $false -Actual ([bool]$fallbackResult.malformedMissingAuxiliary.accepted) -Message 'Client fallback should reject "What they review?".'
        Assert-Equal -Expected $true -Actual ([bool]$fallbackResult.validPronounVariant.accepted) -Message 'Client fallback should accept "What will they review?".'
        Assert-Equal -Expected $false -Actual ([bool]$fallbackResult.malformedAuxiliaryPast.accepted) -Message 'Client fallback should reject "What will they reviewed?".'
    }
    finally {
        Pop-Location
        Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
}
else {
    Write-Host 'Client question formation fallback runtime check skipped: node or tsx CLI was not found.'
}

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
