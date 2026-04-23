Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Assertions.ps1')

Write-TestStep 'Content template contains editable UI, practice, and runtime meta'
$content = Get-Content -LiteralPath (Join-Path $projectRoot 'data\content.template.json') -Raw | ConvertFrom-Json
Assert-True -Condition ($null -ne $content.meta.ui.admin.fieldLabels)
Assert-True -Condition ($null -ne $content.meta.ui.admin.actions)
Assert-True -Condition ($null -ne $content.meta.ui.admin.actions.uploadMedia)
Assert-True -Condition ($null -ne $content.meta.ui.admin.actions.openAsset)
Assert-True -Condition ($null -ne $content.meta.ui.admin.messages)
Assert-True -Condition ($null -ne $content.meta.ui.admin.taxonomies)
Assert-True -Condition ($null -ne $content.meta.practice.answeringModes.good)
Assert-True -Condition ($null -ne $content.meta.practice.clarifyProfiles.backend)
Assert-True -Condition ($null -ne $content.meta.practice.questionFormationRevealDelayMs)
Assert-True -Condition ($null -ne $content.meta.runtime.defaults)
Assert-True -Condition ($null -ne $content.meta.runtime.sectionViews)
Assert-True -Condition ($null -ne $content.meta.runtime.blockRenderers)
Assert-True -Condition ($null -ne $content.meta.runtime.practiceScreens)
Assert-True -Condition ($null -ne $content.meta.runtime.blockGroups)

Write-TestStep 'Live and template content stay small enough for public preview'
function Measure-LargestString {
    param(
        [object]$Value,
        [string]$Path = '$'
    )

    if ($null -eq $Value) {
        return [pscustomobject]@{ Path = $Path; Length = 0 }
    }

    if ($Value -is [string]) {
        return [pscustomobject]@{ Path = $Path; Length = $Value.Length }
    }

    $largest = [pscustomobject]@{ Path = $Path; Length = 0 }
    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string]) -and -not ($Value -is [pscustomobject])) {
        $index = 0
        foreach ($item in $Value) {
            $candidate = Measure-LargestString -Value $item -Path "$Path[$index]"
            if ($candidate.Length -gt $largest.Length) {
                $largest = $candidate
            }
            $index++
        }
        return $largest
    }

    if ($Value -is [pscustomobject]) {
        foreach ($property in $Value.PSObject.Properties) {
            $candidate = Measure-LargestString -Value $property.Value -Path "$Path.$($property.Name)"
            if ($candidate.Length -gt $largest.Length) {
                $largest = $candidate
            }
        }
    }

    return $largest
}

foreach ($fileName in @('content.template.json', 'content.json')) {
    $filePath = Join-Path $projectRoot ('data\' + $fileName)
    $rawContent = Get-Content -LiteralPath $filePath -Raw
    $parsedContent = $rawContent | ConvertFrom-Json
    $largestString = Measure-LargestString -Value $parsedContent

    Assert-True -Condition ($rawContent.Length -lt 1000000) -Message "$fileName is too large for the public preview content payload."
    Assert-True -Condition ($largestString.Length -lt 10000) -Message "$fileName contains an oversized string at $($largestString.Path)."
}

Write-TestStep 'Legacy admin UI no longer hardcodes user-facing copy or schema constants'
$adminScript = Get-Content -LiteralPath (Join-Path $projectRoot 'static\admin.js') -Raw
foreach ($pattern in @(
    'SOFTskills content admin',
    'Open learner app',
    'Refresh admin',
    'Save content',
    'Reload from disk',
    'Create the first section to start managing content',
    'No file uploaded yet',
    'Section added\.',
    'Block added\.',
    'Material added\.'
)) {
    Assert-True -Condition ($adminScript -cnotmatch $pattern) -Message "Admin script still hardcodes '$pattern'."
}
foreach ($pattern in @('SECTION_TYPES', 'BLOCK_KINDS', 'MATERIAL_TYPES')) {
    Assert-True -Condition ($adminScript -cnotmatch $pattern) -Message "Admin script still hardcodes '$pattern'."
}

Write-TestStep 'Legacy learner runtime no longer ships fallback content engines or renderer special-cases'
$appScript = Get-Content -LiteralPath (Join-Path $projectRoot 'static\app.js') -Raw
foreach ($pattern in @(
    'LOCAL_PROFILE_CATALOG',
    'LOCAL_NO_CONTEXT_DECK',
    'browser-practice-engine',
    'Practice asking questions',
    'Practice answering questions',
    "block.kind === 'practice-clarify'",
    "block.kind === 'practice-ask-after'",
    "block.kind === 'practice-without-context'",
    "block.kind === 'practice-answering'",
    "section.type === 'landing'",
    "section.type === 'hub'",
    "getFirstBlockByKind\(findSectionByRoute\('/asking/interrupt'",
    "getBlocksByKind\(section, 'panel'\)\[0\]",
    "getBlocksByKind\(section, 'panel'\)\[1\]"
)) {
    Assert-True -Condition ($appScript -cnotmatch $pattern) -Message "Learner script still hardcodes '$pattern'."
}
Assert-Match -Actual $appScript -Pattern '/api/content'
Assert-Match -Actual $appScript -Pattern 'getSectionViewConfig'
Assert-Match -Actual $appScript -Pattern 'getBlockRenderer'
Assert-Match -Actual $appScript -Pattern 'getPracticeScreenConfig'
Assert-Match -Actual $appScript -Pattern 'getBlockGroupConfig'

Write-TestStep 'Shared platform client reads visible copy and runtime rules from content meta'
$screenSource = Get-Content -LiteralPath 'D:\Projects\SOFTskills\platform\apps\client\src\components\Screen.tsx' -Raw
$sectionsSource = Get-Content -LiteralPath 'D:\Projects\SOFTskills\platform\apps\client\app\(tabs)\sections.tsx' -Raw
$sectionSource = Get-Content -LiteralPath 'D:\Projects\SOFTskills\platform\apps\client\app\section\[id].tsx' -Raw
$clarifySource = Get-Content -LiteralPath 'D:\Projects\SOFTskills\platform\apps\client\app\practice\asking\clarify.tsx' -Raw
$answeringSource = Get-Content -LiteralPath 'D:\Projects\SOFTskills\platform\apps\client\app\practice\answering\[mode].tsx' -Raw
$contentMetaSource = Get-Content -LiteralPath 'D:\Projects\SOFTskills\platform\apps\client\src\lib\contentMeta.ts' -Raw
$domainSource = Get-Content -LiteralPath 'D:\Projects\SOFTskills\platform\packages\domain\src\content.ts' -Raw
$indexSource = Get-Content -LiteralPath 'D:\Projects\SOFTskills\platform\apps\client\app\(tabs)\index.tsx' -Raw
foreach ($source in @($sectionsSource, $sectionSource, $clarifySource, $answeringSource)) {
    Assert-Match -Actual $source -Pattern 'getNestedString'
}
foreach ($pattern in @(
    'Shared web \+ mobile prototype',
    'Prototype focus: asking and answering questions for workplace English\.',
    'Back to home',
    'Open live practice',
    'Unable to load content',
    'SOFTskills'
)) {
    Assert-True -Condition ($screenSource -cnotmatch $pattern) -Message "Platform screen chrome still hardcodes '$pattern'."
    Assert-True -Condition ($sectionsSource -cnotmatch $pattern) -Message "Sections screen still hardcodes '$pattern'."
    Assert-True -Condition ($sectionSource -cnotmatch $pattern) -Message "Section screen still hardcodes '$pattern'."
}
foreach ($pattern in @(
    "block.kind === 'practice-clarify'",
    "block.kind === 'practice-answering'",
    "section.type !== 'landing' && section.type !== 'hub'",
    "findFirstBlock\(section, 'practice-clarify'\)",
    "findFirstBlock\(section, 'practice-answering'\)",
    "getSectionByRoute\(content, '/asking/interrupt'\)"
)) {
    Assert-True -Condition ($sectionSource -cnotmatch $pattern) -Message "Section screen still hardcodes '$pattern'."
    Assert-True -Condition ($clarifySource -cnotmatch $pattern) -Message "Clarify screen still hardcodes '$pattern'."
    Assert-True -Condition ($answeringSource -cnotmatch $pattern) -Message "Answering screen still hardcodes '$pattern'."
}
Assert-Match -Actual $screenSource -Pattern 'appTitle\?'
Assert-Match -Actual $screenSource -Pattern 'brandTagline\?'
Assert-Match -Actual $screenSource -Pattern 'footerNote\?'
Assert-Match -Actual $indexSource -Pattern 'Redirect'
Assert-Match -Actual $contentMetaSource -Pattern 'getSectionViewConfig'
Assert-Match -Actual $contentMetaSource -Pattern 'getBlockRenderer'
Assert-Match -Actual $contentMetaSource -Pattern 'findPracticeScreenForSection'
Assert-Match -Actual $contentMetaSource -Pattern 'fillRuntimeTemplate'
Assert-Match -Actual $sectionSource -Pattern 'getSectionViewConfig'
Assert-Match -Actual $sectionSource -Pattern 'findPracticeScreenForSection'
Assert-Match -Actual $clarifySource -Pattern 'getPracticeScreenConfig'
Assert-Match -Actual $answeringSource -Pattern 'getPracticeScreenConfig'
Assert-Match -Actual $domainSource -Pattern 'export type MaterialType = string;'
Assert-Match -Actual $domainSource -Pattern 'export type BlockKind = string;'
Assert-Match -Actual $domainSource -Pattern 'export type SectionType = string;'

Write-TestStep 'Platform admin screen reads visible copy from content meta'
$platformAdminSource = Get-Content -LiteralPath 'D:\Projects\SOFTskills\platform\apps\client\app\admin.tsx' -Raw
foreach ($pattern in @(
    'SOFTskills content admin',
    'Open learner app',
    'Refresh admin',
    'Save content',
    'Reload from disk',
    'Upload media',
    'Open asset'
)) {
    Assert-True -Condition ($platformAdminSource -cnotmatch $pattern) -Message "Platform admin screen still hardcodes '$pattern'."
}
foreach ($pattern in @(
    'getAdminText',
    'getTaxonomyValues',
    'apiClient.getAdminContent',
    'apiClient.saveAdminContent',
    'apiClient.uploadAdminMedia',
    'apiClient.deleteAdminMedia'
)) {
    Assert-Match -Actual $platformAdminSource -Pattern $pattern
}
Write-TestStep 'Shared platform API no longer hardcodes practice feedback text'
$practiceServiceSource = Get-Content -LiteralPath 'D:\Projects\SOFTskills\platform\apps\api\src\modules\practice\practice.service.ts' -Raw
$answeringServiceSource = Get-Content -LiteralPath 'D:\Projects\SOFTskills\platform\apps\api\src\modules\session\answering.service.ts' -Raw
foreach ($pattern in @(
    'Strong clarification question',
    'Good follow-up',
    'Could you explain the main business impact',
    'Thanks\. That was concise and appropriate\.'
)) {
    Assert-True -Condition ($practiceServiceSource -cnotmatch $pattern) -Message "Practice service still hardcodes '$pattern'."
    Assert-True -Condition ($answeringServiceSource -cnotmatch $pattern) -Message "Answering service still hardcodes '$pattern'."
}

Write-Host 'Content-driven runtime tests passed.'




