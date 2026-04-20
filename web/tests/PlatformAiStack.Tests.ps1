Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$platformRoot = Join-Path $workspaceRoot 'platform'
$webRoot = Join-Path $workspaceRoot 'web'
. (Join-Path $PSScriptRoot 'Assertions.ps1')

Write-TestStep 'AI defaults target self-hosted chat with Whisper STT and Kokoro TTS'
$envSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\config\env.ts') -Raw
Assert-Match -Actual $envSource -Pattern "LLM_TEXT_PROVIDER: z\.enum\(\['huggingface', 'openai', 'selfhosted'\]\)\.default\('selfhosted'\)"
Assert-Match -Actual $envSource -Pattern "LLM_STT_PROVIDER: z\.enum\(\['huggingface', 'openai', 'selfhosted'\]\)\.default\('huggingface'\)"
Assert-Match -Actual $envSource -Pattern "LLM_TTS_PROVIDER: z\.enum\(\['huggingface', 'openai', 'selfhosted'\]\)\.default\('huggingface'\)"
Assert-Match -Actual $envSource -Pattern "LLM_CHAT_MODEL: z\.string\(\)\.default\('gemma3:12b'\)"
Assert-Match -Actual $envSource -Pattern "LLM_STT_MODEL: z\.string\(\)\.default\('openai/whisper-large-v3'\)"
Assert-Match -Actual $envSource -Pattern "LLM_TTS_MODEL: z\.string\(\)\.default\('hexgrad/Kokoro-82M'\)"
Assert-Match -Actual $envSource -Pattern "SELF_HOSTED_BASE_URL: z\.string\(\)\.default\('http://localhost:11434/v1'\)"

Write-TestStep 'Providers use model-configured self-hosted chat and Hugging Face speech models'
$selfHostedSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\providers\chat\selfHosted.ts') -Raw
Assert-Match -Actual $selfHostedSource -Pattern '/chat/completions'
Assert-Match -Actual $selfHostedSource -Pattern 'model: env\.LLM_CHAT_MODEL'
Assert-Match -Actual $selfHostedSource -Pattern 'parseModelJsonContent'
$hfChatSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\providers\chat\huggingface.ts') -Raw
Assert-Match -Actual $hfChatSource -Pattern 'parseModelJsonContent'
Assert-Match -Actual $hfChatSource -Pattern 'resolveHuggingFaceChatModel'
$jsonHelperSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\providers\chat\jsonResponse.ts') -Raw
foreach ($pattern in @(
    'stripWrappers',
    'replace\(/<think>\[\\s\\S\]\*\?<\\/think>/gi, '' ''\)',
    'findBalancedJsonCandidate',
    'parseModelJsonContent<T>',
    'Model response was not valid JSON'
)) {
    Assert-Match -Actual $jsonHelperSource -Pattern $pattern
}
$hfSpeechSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\providers\speech\huggingfaceSpeech.ts') -Raw
Assert-Match -Actual $hfSpeechSource -Pattern 'env\.LLM_STT_MODEL'
Assert-Match -Actual $hfSpeechSource -Pattern 'env\.LLM_TTS_MODEL'

Write-TestStep 'Critical route and provider files keep valid runtime wiring'
$routesSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\routes\registerRoutes.ts') -Raw
Assert-Match -Actual $routesSource -Pattern 'id: `debug-\$\{Date\.now\(\)\}-\$\{Math\.random\(\)\.toString\(36\)\.slice\(2, 8\)\}`'
Assert-Match -Actual $routesSource -Pattern 'app\.log\.info\(\{ debug: entry \}, `debug:\$\{scope\}:\$\{event\}`\)'
Assert-Match -Actual $routesSource -Pattern 'resolveLocalUploadPath\(`/uploads/\$\{wildcard\}`\)'

Write-TestStep 'Live and template content keep role-aware prompts and STT-ready learning chat'
foreach ($fileName in @('content.template.json', 'content.json')) {
    $content = Get-Content -LiteralPath (Join-Path $webRoot ('data\' + $fileName)) -Raw | ConvertFrom-Json
    $goodQuestionType = $content.meta.practice.answeringSession.questionTypes.good
    $goodGeneratorGuidance = ''
    if ($goodQuestionType -and $goodQuestionType.PSObject.Properties['generatorGuidance']) {
        $goodGeneratorGuidance = [string]$goodQuestionType.PSObject.Properties['generatorGuidance'].Value
    }
    Assert-True -Condition ([string]$content.meta.practice.learningChat.systemPrompt).Contains('Do not default to candidate mode') -Message "$fileName should keep role-aware coach chat instructions."
    Assert-True -Condition ([bool]$content.meta.practice.learningChat.capabilities.speechToText) -Message "$fileName should advertise speech-to-text for learning chat."
    Assert-True -Condition ([string]$content.meta.practice.learningChat.transcriptModeTextLabel).Contains('speech-to-text') -Message "$fileName should describe STT-enabled transcript mode."
    Assert-True -Condition ([string]$content.meta.practice.answeringSession.answeringQuestionSystemPrompt).Contains('interviewer or the interviewee') -Message "$fileName should require role inference for answering question generation."
    Assert-True -Condition ([string]$content.meta.practice.answeringSession.answeringQuestionPromptTemplate).Contains("counterpart's role") -Message "$fileName should generate questions from the counterpart perspective."
    Assert-True -Condition ([string]$content.meta.practice.answeringSession.answeringEvaluationSystemPrompt).Contains('wrong perspective') -Message "$fileName should guard against evaluation rewrites from the wrong role."
    Assert-True -Condition $goodGeneratorGuidance.Contains('counterpart perspective') -Message "$fileName should keep role-aware good-question guidance."
}

Write-Host 'Platform AI stack tests passed.'
