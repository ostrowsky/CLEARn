Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$platformRoot = Join-Path $workspaceRoot 'platform'
$webRoot = Join-Path $workspaceRoot 'web'
. (Join-Path $PSScriptRoot 'Assertions.ps1')

function Get-ClarifyBlock($content) {
    $section = $content.sections | Where-Object id -eq 'asking-interrupt' | Select-Object -First 1
    Assert-True -Condition ($null -ne $section) -Message 'asking-interrupt section is missing.'
    $block = $section.blocks | Where-Object id -eq 'clarify-details' | Select-Object -First 1
    Assert-True -Condition ($null -ne $block) -Message 'clarify-details block is missing.'
    return $block
}

Write-TestStep 'Clarify audio exercise content is present in template and live content'
foreach ($fileName in @('content.template.json', 'content.json')) {
    $content = Get-Content -LiteralPath (Join-Path $webRoot ('data\' + $fileName)) -Raw | ConvertFrom-Json
    Assert-True -Condition ($null -ne $content.meta.ui.buttons.startRecording) -Message "$fileName is missing startRecording button copy."
    Assert-True -Condition ($null -ne $content.meta.ui.buttons.stopRecording) -Message "$fileName is missing stopRecording button copy."
    Assert-True -Condition ($null -ne $content.meta.ui.feedback.clarifyNoExamples) -Message "$fileName is missing clarifyNoExamples feedback copy."
    Assert-True -Condition ($null -ne $content.meta.ui.feedback.clarifyAudioMissing) -Message "$fileName is missing clarifyAudioMissing feedback copy."
    Assert-True -Condition ($null -ne $content.meta.ui.feedback.speechRecordingUnavailable) -Message "$fileName is missing speechRecordingUnavailable feedback copy."
    Assert-True -Condition ($null -ne $content.meta.ui.feedback.speechTranscribing) -Message "$fileName is missing speechTranscribing feedback copy."
    Assert-True -Condition ($null -ne $content.meta.ui.feedback.speechTranscriptEmpty) -Message "$fileName is missing speechTranscriptEmpty feedback copy."
    Assert-True -Condition ($null -ne $content.meta.ui.feedback.clarifyAnswerRequired) -Message "$fileName is missing clarifyAnswerRequired feedback copy."
    Assert-True -Condition ($null -ne $content.meta.ui.admin.fieldLabels.statement) -Message "$fileName is missing admin statement field label."
    Assert-True -Condition ($null -ne $content.meta.ui.admin.fieldLabels.clarification) -Message "$fileName is missing admin clarification field label."
    Assert-True -Condition ($null -ne $content.meta.ui.admin.fieldLabels.acceptedAnswers) -Message "$fileName is missing admin acceptedAnswers field label."
    Assert-True -Condition ($null -ne $content.meta.ui.admin.fieldLabels.placeholder) -Message "$fileName is missing admin placeholder field label."
    Assert-True -Condition ($null -ne $content.meta.ui.admin.taxonomies.sectionTypes.exercise) -Message "$fileName is missing the exercise section type."
    Assert-Equal -Expected 'exercise' -Actual ([string]$content.meta.runtime.practiceScreens.clarify.sectionType)
    Assert-Match -Actual ([string]$content.meta.runtime.practiceScreens.clarify.targetHrefTemplate) -Pattern 'sectionId='
    Assert-Match -Actual ([string]$content.meta.runtime.practiceScreens.clarify.targetHrefTemplate) -Pattern 'blockId='
    Assert-Equal -Expected 'practice-clarify' -Actual ([string]$content.meta.ui.admin.templates.sectionTypes.exercise.blockKind)
    Assert-Equal -Expected 'audio' -Actual ([string]$content.meta.ui.admin.templates.sectionTypes.exercise.materialType)
    Assert-True -Condition ($null -ne $content.meta.runtime.sectionViews.exercise) -Message "$fileName is missing runtime section view for exercise."
    Assert-True -Condition ($null -ne $content.meta.practice.clarifyFeedback.mismatch) -Message "$fileName is missing clarify mismatch feedback copy."

    $block = Get-ClarifyBlock -content $content
    $audioExamples = @($block.materials | Where-Object type -eq 'audio')
    Assert-True -Condition ($audioExamples.Count -ge 6) -Message "$fileName should seed at least six audio clarify examples."
    foreach ($example in $audioExamples) {
        Assert-True -Condition ($null -ne $example.meta) -Message "$fileName has an audio clarify example without meta."
        Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$example.meta.statement)) -Message "$fileName has an audio clarify example without a statement."
        Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$example.meta.clarification)) -Message "$fileName has an audio clarify example without a clarification."
        Assert-True -Condition (@($example.meta.acceptedAnswers).Count -ge 1) -Message "$fileName has an audio clarify example without accepted answers."
        Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$example.meta.placeholder)) -Message "$fileName has an audio clarify example without a placeholder."
    }
}

Write-TestStep 'Platform clarify screen is wired for audio playback, STT, editable transcripts, and strict checking'
$clarifyScreenSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\app\practice\asking\clarify.tsx') -Raw
foreach ($pattern in @(
    'buildClarifyExamples',
    'useLocalSearchParams',
    'sectionId',
    'blockId',
    'apiClient\.speechToText',
    'MediaRecorder',
    'getUserMedia',
    'TextInput',
    'acceptedAnswers',
    'placeholder',
    'expectedQuestion',
    'activeAnswerPlaceholder',
    'showExpectedAnswer',
    'startRecording',
    'stopRecording'
)) {
    Assert-Match -Actual $clarifyScreenSource -Pattern $pattern
}

Write-TestStep 'Platform admin exposes editable clarify statement, accepted answers, and exercise templates'
$adminScreenSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\app\admin.tsx') -Raw
foreach ($pattern in @(
    'ensureMaterialMeta',
    'readMaterialMetaString',
    'readMaterialMetaLines',
    'isClarifyAudioMaterial',
    'updateSectionType',
    'applySectionTypeTemplate',
    'fieldLabels\.statement',
    'fieldLabels\.clarification',
    'fieldLabels\.acceptedAnswers',
    'fieldLabels\.placeholder',
    'meta\.statement = value',
    'meta\.clarification = value',
    'meta\.placeholder = value',
    'meta\.acceptedAnswers = value\.split'
)) {
    Assert-Match -Actual $adminScreenSource -Pattern $pattern
}

Write-Host 'Platform clarify audio tests passed.'


