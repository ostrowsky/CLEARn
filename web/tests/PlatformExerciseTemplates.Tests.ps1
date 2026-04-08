Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$platformRoot = Join-Path $workspaceRoot 'platform'
$webRoot = Join-Path $workspaceRoot 'web'
. (Join-Path $PSScriptRoot 'Assertions.ps1')

$exerciseSectionTypes = @(
    'exercise-ask-after',
    'exercise-answering-mixed',
    'exercise-answering-good',
    'exercise-answering-difficult',
    'exercise-answering-unnecessary',
    'exercise-answering-irrelevant'
)

Write-TestStep 'Reusable exercise section types and templates exist in template and live content'
foreach ($fileName in @('content.template.json', 'content.json')) {
    $content = Get-Content -LiteralPath (Join-Path $webRoot ('data\' + $fileName)) -Raw | ConvertFrom-Json
    foreach ($sectionType in $exerciseSectionTypes) {
        Assert-True -Condition ($null -ne $content.meta.ui.admin.taxonomies.sectionTypes.$sectionType) -Message "$fileName is missing section type $sectionType."
        Assert-True -Condition ($null -ne $content.meta.ui.admin.templates.sectionTypes.$sectionType) -Message "$fileName is missing template for $sectionType."
        Assert-True -Condition ($null -ne $content.meta.runtime.sectionViews.$sectionType) -Message "$fileName is missing runtime section view for $sectionType."
    }

    $askAfterTemplate = $content.meta.ui.admin.templates.sectionTypes.'exercise-ask-after'
    Assert-Equal -Expected 3 -Actual @($askAfterTemplate.blocks).Count -Message "$fileName should seed three blocks for exercise-ask-after."
    Assert-Equal -Expected 'panel' -Actual ([string]$askAfterTemplate.blocks[0].kind)
    Assert-Equal -Expected 'panel' -Actual ([string]$askAfterTemplate.blocks[1].kind)
    Assert-Equal -Expected 'practice-ask-after' -Actual ([string]$askAfterTemplate.blocks[2].kind)
    Assert-True -Condition (@($askAfterTemplate.blocks[0].materials).Count -ge 7) -Message "$fileName should seed lead-in phrases for exercise-ask-after."
    Assert-True -Condition (@($askAfterTemplate.blocks[1].materials).Count -ge 5) -Message "$fileName should seed follow-up phrases for exercise-ask-after."

    $mixedTemplate = $content.meta.ui.admin.templates.sectionTypes.'exercise-answering-mixed'
    Assert-Equal -Expected 2 -Actual @($mixedTemplate.blocks).Count -Message "$fileName should seed two blocks for exercise-answering-mixed."
    Assert-Equal -Expected 'panel' -Actual ([string]$mixedTemplate.blocks[0].kind)
    Assert-Equal -Expected 'practice-answering' -Actual ([string]$mixedTemplate.blocks[1].kind)

    foreach ($sectionType in @('exercise-answering-good', 'exercise-answering-difficult', 'exercise-answering-unnecessary', 'exercise-answering-irrelevant')) {
        $template = $content.meta.ui.admin.templates.sectionTypes.$sectionType
        Assert-Equal -Expected 2 -Actual @($template.blocks).Count -Message "$fileName should seed two blocks for $sectionType."
        Assert-Equal -Expected 'panel' -Actual ([string]$template.blocks[0].kind)
        Assert-Equal -Expected 'practice-answering' -Actual ([string]$template.blocks[1].kind)
    }

    Assert-Equal -Expected $false -Actual ([bool]$content.meta.runtime.sectionViews.'practice-ask-after'.collapsible) -Message "$fileName should render practice-ask-after without accordion toggles."
    Assert-Equal -Expected 2 -Actual ([int]$content.meta.runtime.sectionViews.'practice-ask-after'.featuredBlockCount) -Message "$fileName should place the first two practice ask-after blocks on one row."
    Assert-Equal -Expected $false -Actual ([bool]$content.meta.runtime.sectionViews.'exercise-ask-after'.collapsible) -Message "$fileName should render exercise-ask-after without accordion toggles."
    Assert-Equal -Expected 2 -Actual ([int]$content.meta.runtime.sectionViews.'exercise-ask-after'.featuredBlockCount) -Message "$fileName should place the first two exercise ask-after blocks on one row."

    Assert-Equal -Expected 'exercise-ask-after' -Actual ([string]$content.meta.runtime.practiceScreens.askAfter.sectionType)
    Assert-Match -Actual ([string]$content.meta.runtime.practiceScreens.askAfter.targetHrefTemplate) -Pattern 'sectionId='
    Assert-Match -Actual ([string]$content.meta.runtime.practiceScreens.askAfter.targetHrefTemplate) -Pattern 'blockId='
    Assert-Match -Actual ([string]$content.meta.runtime.practiceScreens.answering.targetHrefTemplate) -Pattern 'sectionId='
    Assert-Match -Actual ([string]$content.meta.runtime.practiceScreens.answering.targetHrefTemplate) -Pattern 'blockId='
    Assert-Equal -Expected 'exercise-answering-mixed' -Actual ([string]$content.meta.runtime.practiceScreens.answeringMixedExercise.sectionType)
    Assert-Equal -Expected 'exercise-answering-good' -Actual ([string]$content.meta.runtime.practiceScreens.answeringGoodExercise.sectionType)
    Assert-Equal -Expected 'exercise-answering-difficult' -Actual ([string]$content.meta.runtime.practiceScreens.answeringDifficultExercise.sectionType)
    Assert-Equal -Expected 'exercise-answering-unnecessary' -Actual ([string]$content.meta.runtime.practiceScreens.answeringUnnecessaryExercise.sectionType)
    Assert-Equal -Expected 'exercise-answering-irrelevant' -Actual ([string]$content.meta.runtime.practiceScreens.answeringIrrelevantExercise.sectionType)
}

Write-TestStep 'Shared template engine and reusable practice screens are wired in platform code'
$adminContentSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\src\lib\adminContent.ts') -Raw
foreach ($pattern in @(
    'Record<string, unknown>',
    'Array\.isArray\(template.blocks\)',
    'createBlockFromTemplate',
    'template.blocks.map'
)) {
    Assert-Match -Actual $adminContentSource -Pattern $pattern
}

$askAfterSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\app\practice\asking\after-talk.tsx') -Raw
foreach ($pattern in @(
    'useLocalSearchParams',
    'sectionId',
    'blockId',
    'AskAfterComposer'
)) {
    Assert-Match -Actual $askAfterSource -Pattern $pattern
}

$askAfterComposerSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\src\components\practice\AskAfterComposer.tsx') -Raw
foreach ($pattern in @(
    'apiClient\.askAfter',
    'apiClient\.checkAskAfter',
    'getBlockGroupConfig',
    'questionPreviewLabel',
    'useSpeechDraft',
    'questionDraft',
    'startRecording',
    'stopRecording',
    'selectedContextPhrase',
    'selectedFollowPhrase',
    'createPhraseDragProps',
    'createPhraseDropProps',
    'speaker',
    'text'
)) {
    Assert-Match -Actual $askAfterComposerSource -Pattern $pattern
}

$sectionSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\app\section\[id].tsx') -Raw
foreach ($pattern in @(
    'AskAfterComposer',
    'showInlineAskAfterComposer',
    "section.type === 'practice-ask-after'",
    "section.type === 'exercise-ask-after'"
)) {
    Assert-Match -Actual $sectionSource -Pattern $pattern
}

$answeringSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\app\practice\answering\[mode].tsx') -Raw
foreach ($pattern in @(
    'sectionId',
    'blockId',
    'fillRuntimeTemplate',
    'apiClient\.startAnswering',
    'apiClient\.respondAnswering',
    'apiClient\.speechToText',
    'selectedReactionId',
    'questionProgressLabel'
)) {
    Assert-Match -Actual $answeringSource -Pattern $pattern
}

Write-Host 'Platform reusable exercise template tests passed.'