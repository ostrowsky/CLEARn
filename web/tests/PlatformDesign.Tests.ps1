Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'Assertions.ps1')

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Read-RepoFile {
    param([string]$RelativePath)
    return Get-Content -LiteralPath (Join-Path $repoRoot $RelativePath) -Raw
}

function Assert-StyleUsesPillRadius {
    param(
        [string]$RelativePath,
        [string]$StyleName
    )

    $source = Read-RepoFile $RelativePath
    $pattern = "(?s)\b$([regex]::Escape($StyleName)):\s*\{.*?borderRadius:\s*tokens\.radius\.pill"
    Assert-Match -Actual $source -Pattern $pattern -Message "$RelativePath style '$StyleName' should use the pixel-perfect pill radius."
}

Write-TestStep 'Visual redesign spec and rollback contract are present'
$specPath = Join-Path $repoRoot 'docs\specs\features\visual-redesign.md'
Assert-True -Condition (Test-Path -LiteralPath $specPath) -Message 'visual-redesign.md spec is required before applying the redesign.'
$spec = Get-Content -LiteralPath $specPath -Raw
Assert-Match -Actual $spec -Pattern 'rollback' -Message 'Visual redesign spec should describe rollback safety.'
Assert-Match -Actual $spec -Pattern 'desktop and mobile' -Message 'Visual redesign spec should cover desktop/mobile parity.'

Write-TestStep 'Design tokens match the approved dark mockup palette and typography'
$tokens = Read-RepoFile 'platform\apps\client\src\theme\tokens.ts'
foreach ($expected in @('#000000', '#0a0a0a', '#131313', '#f5f1ea', '#e07a4a', '#ff8c5a', 'Instrument Serif', 'Manrope')) {
    Assert-Match -Actual $tokens -Pattern ([regex]::Escape($expected)) -Message "Missing design token '$expected'."
}
Assert-Match -Actual $tokens -Pattern 'pill:\s*999' -Message 'Mockup buttons and phrase controls should use pill-style radii.'
Assert-Match -Actual $tokens -Pattern 'xl:\s*4' -Message 'Card radii should follow the pixel-perfect handoff token.'
Assert-Match -Actual $tokens -Pattern 'bubble:\s*14' -Message 'Chat bubbles should keep the handoff bubble radius.'

Write-TestStep 'Learner shell uses responsive dark artboard layout and bundled web fonts'
$screen = Read-RepoFile 'platform\apps\client\src\components\Screen.tsx'
$visualRegressionScript = Read-RepoFile 'platform\apps\client\scripts\visual-regression.mjs'
Assert-Match -Actual $screen -Pattern 'useWindowDimensions' -Message 'Screen shell should switch layout by viewport width.'
Assert-Match -Actual $screen -Pattern 'scrollContentCompact' -Message 'Screen shell should define compact mobile padding.'
Assert-Match -Actual $screen -Pattern 'BrandLogo' -Message 'Learner shell should render the approved linked CLEARn logo component.'
Assert-Match -Actual $screen -Pattern 'backgroundColor:\s*tokens\.colors\.background' -Message 'Screen background should use the dark redesign background.'
Assert-Match -Actual $screen -Pattern 'getTitleParts' -Message 'Learner shell should render mockup-style accented title fragments.'
Assert-Match -Actual $screen -Pattern 'titleAccent' -Message 'Mockup titles should support orange serif italic emphasis.'
Assert-Match -Actual $screen -Pattern 'accessibilityLabel="learner-menu-button"' -Message 'Learner pages should expose the compact hamburger menu trigger.'
Assert-Match -Actual $screen -Pattern 'data-clearn-role="learner-menu-trigger-line"' -Message 'Learner pages should render a hamburger-style visual trigger, not visible menu text.'
Assert-Match -Actual $screen -Pattern "getNestedRecord\(ui, \['homeMenu'\]\)" -Message 'Learner menu should read editable homeMenu configuration from content.'
Assert-Match -Actual $screen -Pattern 'accessibilityHint=\{menuTriggerLabel\}' -Message 'Learner menu trigger label should remain editable as semantic accessibility text.'
Assert-Match -Actual $screen -Pattern 'learner-menu-skill-' -Message 'Learner menu overlay should expose editable skill links.'
Assert-Match -Actual $screen -Pattern 'learner-menu-about-' -Message 'Learner menu overlay should expose editable about links.'
Assert-Match -Actual $screen -Pattern 'menuWordLinks\.map' -Message 'Learner menu overlay should render the large ASK / ANSWER / CHAT word stack on every learner page.'
Assert-Match -Actual $screen -Pattern 'accessibilityLabel=\{`learner-menu-word-' -Message 'Learner menu large ASK / ANSWER / CHAT words should be navigable links.'
Assert-Match -Actual $screen -Pattern 'onHoverIn=\{\(\) => setHoveredMenuWord\(item\.word\)\}' -Message 'Learner menu large words should track real hover state.'
Assert-Match -Actual $screen -Pattern 'onPointerEnter=\{\(\) => setHoveredMenuWord\(item\.word\)\}' -Message 'Learner menu large words should also track pointer hover for React Native Web.'
Assert-Match -Actual $screen -Pattern 'menuWordHovered' -Message 'Learner menu large words should brighten on hover.'
Assert-Match -Actual $screen -Pattern 'menuWordIndexHovered' -Message 'Learner menu index labels should move to accent on hover.'
Assert-Match -Actual $screen -Pattern 'useLearnerMenuHoverStyles' -Message 'Learner shell should inject browser-native hover CSS for internal menu overlays.'
Assert-Match -Actual $screen -Pattern '\[aria-label\^="learner-menu-word-"\]:hover' -Message 'Learner menu word hover should be backed by DOM hover CSS.'
Assert-Match -Actual $screen -Pattern '\[aria-label\^="learner-menu-word-"\]:hover\s*\{[\s\S]*?box-shadow:\s*none !important' -Message 'Learner menu word hover should not draw an orange outline around ASK / ANSWER / CHAT.'
Assert-Match -Actual $screen -Pattern '\[role="link"\]:not\(\[aria-label\^="learner-menu-word-"\]\):hover' -Message 'Generic link hover must exclude large ASK / ANSWER / CHAT menu words.'
Assert-Match -Actual $screen -Pattern '\[aria-label\^="learner-menu-skill-"\]:hover' -Message 'Learner menu skill hover should be backed by DOM hover CSS.'
Assert-Match -Actual $screen -Pattern '\[aria-label\^="learner-menu-about-"\]:hover' -Message 'Learner menu about hover should be backed by DOM hover CSS.'
Assert-Match -Actual $screen -Pattern '\[aria-label="learner-menu-button"\]:hover' -Message 'Learner menu trigger hover should be backed by DOM hover CSS.'
Assert-Match -Actual $screen -Pattern '\[aria-label="learner-menu-button"\]:hover \[dir="auto"\]' -Message 'Learner menu trigger hover should recolor hamburger lines on internal pages.'
Assert-Match -Actual $screen -Pattern '\[tabindex="0"\]:not\(input\):not\(textarea\):hover' -Message 'Learner shell should apply hover styling to React Native Web Pressable controls without explicit roles.'
Assert-Match -Actual $screen -Pattern 'box-shadow:\s*inset 0 0 0 1px' -Message 'Generic learner controls should show a visible outline on hover.'
Assert-Match -Actual $screen -Pattern 'filter:\s*brightness\(1\.08\)' -Message 'Generic learner controls should visibly brighten on hover.'
Assert-Match -Actual $screen -Pattern "route:\s*'/asking'" -Message 'Large ASK menu word should link to the asking hub.'
Assert-Match -Actual $screen -Pattern "route:\s*'/answering'" -Message 'Large ANSWER menu word should link to the answering hub.'
Assert-Match -Actual $screen -Pattern "route:\s*'/learning-chat'" -Message 'Large CHAT menu word should link to the learning chat.'
Assert-Match -Actual $screen -Pattern 'menuWords' -Message 'Learner menu overlay should keep a dedicated large-word column instead of only rendering side links.'
Assert-Match -Actual $screen -Pattern 'tokens\.colors\.inkDim' -Message 'Learner menu large words should use the visible dim-gray mockup color, not browser-default black.'
Assert-True -Condition ($screen -notmatch 'styles\.backButton') -Message 'Learner pages should not render the old top-right back pill instead of the compact menu trigger.'
Assert-Match -Actual $visualRegressionScript -Pattern "const learnerRoutes = \['/asking', '/asking/interrupt', '/asking/after-talk'\]" -Message 'Runtime hover regression should cover the asking hub, interrupt lesson, and after-talk lesson.'
Assert-Match -Actual $visualRegressionScript -Pattern 'learner menu trigger hover did not move all hamburger lines to accent' -Message 'Runtime hover regression should fail when internal hamburger hover is broken.'
Assert-Match -Actual $visualRegressionScript -Pattern 'learner menu word hover did not match the mockup colors' -Message 'Runtime hover regression should fail when internal ASK/ANSWER/CHAT hover is broken.'
Assert-Match -Actual $visualRegressionScript -Pattern 'verifyLearnerInteractiveHover' -Message 'Runtime hover regression should cover ordinary learner controls, not only the global menu.'
Assert-Match -Actual $visualRegressionScript -Pattern 'Generate short talk' -Message 'Runtime hover regression should cover after-talk action controls.'
Assert-Match -Actual $visualRegressionScript -Pattern 'Start recording' -Message 'Runtime hover regression should cover interrupt lesson action controls.'

$brandLogo = Read-RepoFile 'platform\apps\client\src\components\BrandLogo.tsx'
Assert-Match -Actual $brandLogo -Pattern "router\.push\(href\)" -Message 'Approved logo should link back to the home page.'
Assert-Match -Actual $brandLogo -Pattern 'tokens\.typography\.serif' -Message 'Logo should use the serif italic accent for the n.'
Assert-Match -Actual $brandLogo -Pattern "' />'" -Message 'Logo should render the approved <CLEARn /> mark.'

$layout = Read-RepoFile 'platform\apps\client\app\_layout.tsx'
Assert-Match -Actual $layout -Pattern 'webFonts' -Message 'Root layout should load the bundled redesign web fonts.'
Assert-Match -Actual $layout -Pattern 'StatusBar style="light"' -Message 'Dark redesign should use a light status bar.'

$webFonts = Read-RepoFile 'platform\apps\client\src\theme\webFonts.ts'
Assert-Match -Actual $webFonts -Pattern '/fonts/.*\.woff2' -Message 'Web font injection should reference bundled font files.'
Assert-True -Condition ((Get-ChildItem -LiteralPath (Join-Path $repoRoot 'platform\apps\client\public\fonts') -Filter '*.woff2' | Measure-Object).Count -ge 3) -Message 'Bundled redesign font files are missing.'

Write-TestStep 'Home navigation follows the mockup module-card structure'
$homeScreen = Read-RepoFile 'platform\apps\client\app\(tabs)\sections.tsx'
foreach ($expected in @('ASK', 'ANSWER', 'CHAT', 'skillMenu', 'aboutMenu', 'BrandLogo')) {
    Assert-Match -Actual $homeScreen -Pattern $expected -Message "Home module navigation is missing '$expected'."
}
Assert-Match -Actual $homeScreen -Pattern "getNestedRecord\(ui, \['homeMenu'\]\)" -Message 'Home menu labels and links should come from editable content meta.'
Assert-True -Condition ($homeScreen -notmatch 'const skillMenu\s*=\s*\[') -Message 'Home skills menu must not be hardcoded in the component.'
Assert-True -Condition ($homeScreen -notmatch 'const aboutMenu\s*=\s*\[') -Message 'Home about menu must not be hardcoded in the component.'
Assert-Match -Actual $homeScreen -Pattern 'bigWordHovered' -Message 'ASK/ANSWER/CHAT should brighten on hover.'
Assert-Match -Actual $homeScreen -Pattern 'sideLinkTextHovered' -Message 'Skills and about links should brighten on hover.'
Assert-Match -Actual $homeScreen -Pattern 'setMenuOpen\(\(current\) => !current\)' -Message 'Home menu should use one toggle control instead of rendering a separate hardcoded x.'
Assert-True -Condition ($homeScreen -notmatch 'home-close|closeIconLine|closeLinkHovered|closeLabel') -Message 'Home menu must not render a hardcoded top-right x control.'
Assert-Match -Actual $homeScreen -Pattern 'onHoverIn' -Message 'Home menu hover should use real web hover events, not inert style-only declarations.'
Assert-Match -Actual $homeScreen -Pattern 'setHoveredItem' -Message 'Home menu should track hover state for React Native Web.'
Assert-Match -Actual $homeScreen -Pattern 'useHomeMenuHoverStyles' -Message 'Home menu should inject browser-native hover CSS for React Native Web.'
Assert-True -Condition ($homeScreen -notmatch 'Redirect href="/"') -Message 'Home screen must not use a render-time /sections -> / redirect because it can loop when opened from admin.'
Assert-Match -Actual $homeScreen -Pattern '\[aria-label\^="home-module-"\]:hover' -Message 'ASK/ANSWER/CHAT hover should be backed by DOM hover CSS.'
Assert-Match -Actual $homeScreen -Pattern '\[aria-label\^="home-module-"\]:hover\s*\{[\s\S]*?box-shadow:\s*none !important' -Message 'Home overlay ASK / ANSWER / CHAT hover should not draw an orange outline.'
Assert-Match -Actual $homeScreen -Pattern '\[aria-label\^="home-skill-"\]:hover' -Message 'Skill links should be backed by DOM hover CSS.'
Assert-Match -Actual $homeScreen -Pattern '\[aria-label\^="home-about-"\]:hover' -Message 'About links should be backed by DOM hover CSS.'
Assert-Match -Actual $homeScreen -Pattern '\[aria-label="home-menu-button"\]:hover' -Message 'Menu toggle should be backed by DOM hover CSS.'
Assert-Match -Actual $homeScreen -Pattern 'accessibilityLabel=\{`home-module-' -Message 'Module hover targets should expose stable accessibility labels.'
Assert-Match -Actual $homeScreen -Pattern 'accessibilityLabel=\{`home-skill-' -Message 'Skill hover targets should expose stable accessibility labels.'
Assert-Match -Actual $homeScreen -Pattern 'accessibilityLabel=\{`home-about-' -Message 'About hover targets should expose stable accessibility labels.'
Assert-Match -Actual $homeScreen -Pattern '\{renderTopBar\(\)\}' -Message 'Home and menu screens should render the full top bar with the start-practicing link and hamburger control.'
Assert-True -Condition ($homeScreen -notmatch 'renderTopBar\(compact\)') -Message 'Home screen must not pass compact as the top-bar action flag because it hides the desktop menu.'
Assert-Match -Actual $homeScreen -Pattern 'accessibilityLabel="home-menu-button"' -Message 'Home screen should expose the compact hamburger menu control.'
Assert-Match -Actual $homeScreen -Pattern 'accessibilityHint=\{homeCopy\.menuTrigger\}' -Message 'Home menu trigger label should remain editable as semantic accessibility text.'
Assert-Match -Actual $homeScreen -Pattern 'styles\.pathSection' -Message 'Home screen should render the mockup path section below the hero.'
Assert-Match -Actual $homeScreen -Pattern 'homeCards\.map' -Message 'Home screen should render module cards from editable content.'
Assert-Match -Actual $homeScreen -Pattern 'accessibilityLabel=\{`home-card-' -Message 'Home module cards should expose stable accessibility labels for smoke and visual checks.'
Assert-Match -Actual $homeScreen -Pattern 'menuTriggerLabel' -Message 'Home top navigation should use the editable compact ASK ANSWER chat menu trigger.'
Assert-Match -Actual $homeScreen -Pattern 'data-clearn-role="menu-trigger-line"' -Message 'Home top navigation should render a hamburger-style visual trigger.'
Assert-True -Condition ($homeScreen -notmatch 'menu-trigger-text') -Message 'Home top navigation must not render visible ASK ANSWER chat text in the menu trigger.'
$liveContent = Get-Content -LiteralPath (Join-Path $repoRoot 'web\data\content.json') -Raw
Assert-Match -Actual $liveContent -Pattern '"homeMenu"' -Message 'Editable home menu config should be present in live content.'
Assert-Match -Actual $liveContent -Pattern '"menuTriggerLabel"\s*:\s*"ASK ANSWER chat"' -Message 'Editable compact learner menu label should live in content.'
Assert-Match -Actual $liveContent -Pattern '"skillsHeading"\s*:\s*"SKILLS"' -Message 'Editable skills heading should live in content.'
Assert-Match -Actual $liveContent -Pattern '"aboutHeading"\s*:\s*"ABOUT"' -Message 'Editable about heading should live in content.'
$homeSectionMatch = [regex]::Match($liveContent, '"id":\s*"home"[\s\S]*?(?=\{\s*"id":\s*"asking-hub")')
Assert-True -Condition $homeSectionMatch.Success -Message 'Home section should exist in live content.'
Assert-True -Condition ($homeSectionMatch.Value -notmatch '\]\s*,\s*"title"\s*:') -Message 'Home section must not contain a duplicate section title after its blocks array.'

Write-TestStep 'Key learner practice screens no longer use old light panel colors'
$learnerFiles = @(
    'platform\apps\client\app\practice\answering\[mode].tsx',
    'platform\apps\client\app\practice\chat.tsx',
    'platform\apps\client\app\practice\asking\clarify.tsx',
    'platform\apps\client\src\components\practice\AskAfterComposer.tsx',
    'platform\apps\client\src\components\practice\QuestionFormationPractice.tsx',
    'platform\apps\client\src\components\practice\ClarifyPracticeInlineList.tsx'
)
$oldPanelPattern = '#fff8ef|#fffaf4|#fffaf3|#fff6ea|#fff2ec|#fff1ed|#ffe5ca|#f8ead8|#fce1cc|#ecf8f0|#eefcf3'
foreach ($relativePath in $learnerFiles) {
    $source = Read-RepoFile $relativePath
    Assert-True -Condition ($source -notmatch $oldPanelPattern) -Message "Old light panel color remains in $relativePath."
}

Write-TestStep 'Interactive controls use the pixel-perfect pill radius'
$answeringSource = Read-RepoFile 'platform\apps\client\app\practice\answering\[mode].tsx'
Assert-Match -Actual $answeringSource -Pattern 'getReactionCategoryPalette' -Message 'Answering reaction cards should use per-type colors from the redesign.'
foreach ($expectedColor in @('accentGreen', 'accentGold', 'accentBlue')) {
    Assert-Match -Actual $answeringSource -Pattern $expectedColor -Message "Answering reaction cards should include the $expectedColor redesign color."
}

$pillStyleExpectations = @{
    'platform\apps\client\app\practice\answering\[mode].tsx' = @('button', 'secondaryButton', 'reactionCategoryButton', 'choiceChip')
    'platform\apps\client\app\practice\chat.tsx' = @('capabilityPill', 'primaryButton', 'secondaryButton', 'ghostButton', 'chip')
    'platform\apps\client\app\practice\asking\clarify.tsx' = @('button', 'secondaryButton')
    'platform\apps\client\app\section\[id].tsx' = @('mediaButton', 'practiceButton')
    'platform\apps\client\app\admin.tsx' = @('choiceChip', 'primaryButton', 'secondaryButton', 'dangerButton')
    'platform\apps\client\src\components\AdminMediaBackupControls.tsx' = @('button')
    'platform\apps\client\src\components\practice\AskAfterComposer.tsx' = @('bankItem', 'button', 'secondaryButton')
    'platform\apps\client\src\components\practice\ClarifyPracticeInlineList.tsx' = @('button', 'secondaryButton')
    'platform\apps\client\src\components\practice\QuestionFormationPractice.tsx' = @('countdownPill', 'button', 'secondaryButton', 'secondaryButtonWide', 'hintCard')
}

foreach ($relativePath in $pillStyleExpectations.Keys) {
    foreach ($styleName in $pillStyleExpectations[$relativePath]) {
        Assert-StyleUsesPillRadius -RelativePath $relativePath -StyleName $styleName
    }
}

Write-Host 'Platform design tests passed.'
