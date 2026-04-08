Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$platformRoot = Join-Path $workspaceRoot 'platform'
$webRoot = Join-Path $workspaceRoot 'web'
. (Join-Path $PSScriptRoot 'Assertions.ps1')

Write-TestStep 'Learning chat content is present in the shared contract'
$content = Get-Content -LiteralPath (Join-Path $webRoot 'data\content.template.json') -Raw | ConvertFrom-Json
Assert-True -Condition ($null -ne $content.meta.practice.learningChat)
Assert-True -Condition ($null -ne $content.meta.practice.learningChat.scenarios.meeting)
Assert-True -Condition ($null -ne $content.meta.practice.learningChat.capabilities)
Assert-True -Condition ($null -ne $content.meta.ui.labels.coachScenario)
Assert-True -Condition ($null -ne $content.meta.ui.labels.coachLearnerRole)
Assert-True -Condition ($null -ne $content.meta.ui.labels.coachAssistantRole)
Assert-True -Condition ($null -ne $content.meta.ui.buttons.startCoachChat)
Assert-True -Condition ($null -ne $content.meta.ui.buttons.sendCoachReply)
Assert-True -Condition ($null -ne $content.meta.ui.buttons.restartCoachChat)
Assert-True -Condition ($null -ne $content.meta.ui.placeholders.coachChatContext)
Assert-True -Condition ($null -ne $content.meta.ui.placeholders.coachChatGoal)
Assert-True -Condition ($null -ne $content.meta.ui.placeholders.coachChatReply)
Assert-True -Condition ($null -ne $content.meta.ui.feedback.coachChatReady)
Assert-True -Condition ($null -ne $content.meta.ui.feedback.coachChatCompleted)
Assert-True -Condition ($null -ne $content.meta.ui.admin.taxonomies.sectionTypes.'practice-chat')
Assert-True -Condition ($null -ne $content.meta.ui.admin.taxonomies.blockKinds.'practice-learning-chat')
Assert-True -Condition ($null -ne $content.meta.ui.admin.taxonomies.rendererKinds.'practice-learning-chat')
Assert-True -Condition ($null -ne $content.meta.runtime.sectionViews.'practice-chat')
Assert-True -Condition ($null -ne $content.meta.runtime.blockRenderers.'practice-learning-chat')
Assert-True -Condition ($null -ne $content.meta.runtime.practiceScreens.coachChat)

Write-TestStep 'Live content exposes the home card and learning chat section'
$liveContent = Get-Content -LiteralPath (Join-Path $webRoot 'data\content.json') -Raw | ConvertFrom-Json
Assert-True -Condition ($null -ne $liveContent.meta.practice.learningChat) -Message 'Live content is missing meta.practice.learningChat.'
Assert-True -Condition ($null -ne $liveContent.meta.practice.learningChat.scenarios.meeting) -Message 'Live content is missing the meeting learning chat scenario.'
Assert-True -Condition ($null -ne $liveContent.meta.practice.learningChat.capabilities) -Message 'Live content is missing learning chat capabilities.'
Assert-True -Condition ($null -ne $liveContent.meta.ui.labels.coachScenario) -Message 'Live content is missing coachScenario label.'
Assert-True -Condition ($null -ne $liveContent.meta.ui.buttons.startCoachChat) -Message 'Live content is missing startCoachChat button copy.'
Assert-True -Condition ($null -ne $liveContent.meta.ui.placeholders.coachChatContext) -Message 'Live content is missing coachChatContext placeholder.'
Assert-True -Condition ($null -ne $liveContent.meta.ui.feedback.coachChatReady) -Message 'Live content is missing coachChatReady feedback copy.'
Assert-True -Condition ($null -ne $liveContent.meta.ui.admin.taxonomies.sectionTypes.'practice-chat') -Message 'Live content is missing practice-chat section taxonomy.'
Assert-True -Condition ($null -ne $liveContent.meta.ui.admin.taxonomies.blockKinds.'practice-learning-chat') -Message 'Live content is missing practice-learning-chat block taxonomy.'
Assert-True -Condition ($null -ne $liveContent.meta.ui.admin.taxonomies.rendererKinds.'practice-learning-chat') -Message 'Live content is missing practice-learning-chat renderer taxonomy.'
Assert-True -Condition ($null -ne $liveContent.meta.runtime.sectionViews.'practice-chat') -Message 'Live content is missing runtime section view for practice-chat.'
Assert-True -Condition ($null -ne $liveContent.meta.runtime.blockRenderers.'practice-learning-chat') -Message 'Live content is missing runtime block renderer for practice-learning-chat.'
Assert-True -Condition ($null -ne $liveContent.meta.runtime.practiceScreens.coachChat) -Message 'Live content is missing runtime practice screen config for coachChat.'
$homeSection = $liveContent.sections | Where-Object id -eq 'home'
Assert-True -Condition ($null -ne $homeSection)
Assert-True -Condition (@($homeSection.blocks | Where-Object route -eq '/learning-chat').Count -ge 1)
$learningSection = $liveContent.sections | Where-Object id -eq 'learning-chat'
Assert-True -Condition ($null -ne $learningSection)
Assert-Equal -Expected '/learning-chat' -Actual $learningSection.route
Assert-Equal -Expected 'practice-chat' -Actual $learningSection.type
Assert-True -Condition (@($learningSection.blocks | Where-Object kind -eq 'practice-learning-chat').Count -ge 1)

Write-TestStep 'Platform API and client expose coach chat endpoints'
$apiClientSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\src\lib\api.ts') -Raw
Assert-Match -Actual $apiClientSource -Pattern 'startCoachChat'
Assert-Match -Actual $apiClientSource -Pattern 'continueCoachChat'
Assert-Match -Actual $apiClientSource -Pattern '/api/coach/session/start'
Assert-Match -Actual $apiClientSource -Pattern '/api/coach/session/respond'

$routesSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\routes\registerRoutes.ts') -Raw
Assert-Match -Actual $routesSource -Pattern '/api/coach/session/start'
Assert-Match -Actual $routesSource -Pattern '/api/coach/session/respond'
Assert-Match -Actual $routesSource -Pattern 'CoachChatSessionService'

$coachServiceSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\modules\session\coach.service.ts') -Raw
Assert-Match -Actual $coachServiceSource -Pattern 'withChatProvider'
Assert-Match -Actual $coachServiceSource -Pattern 'generateCoachTurn'
Assert-Match -Actual $coachServiceSource -Pattern 'fallbackReplyTemplate'
Assert-Match -Actual $coachServiceSource -Pattern 'mapInferredScenarioKey'
Assert-Match -Actual $coachServiceSource -Pattern 'buildFallbackAssistantQuestion'
Assert-Match -Actual $coachServiceSource -Pattern 'buildPromptMatchedSuggestions'
Assert-Match -Actual $coachServiceSource -Pattern "transcriptMode: 'text'"

Write-TestStep 'Platform chat screen is wired to content meta and API methods'
$chatScreenSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\app\practice\chat.tsx') -Raw
foreach ($pattern in @(
    'apiClient.startCoachChat',
    'apiClient.continueCoachChat',
    'getPracticeConfig',
    'getPracticeScreenConfig',
    'getNestedString',
    'coachChatContext',
    'coachChatGoal',
    'coachChatReply',
    'coachLearnerRole',
    'coachAssistantRole',
    'useSpeechDraft',
    'startRecording',
    'stopRecording',
    'speechStatus'
)) {
    Assert-Match -Actual $chatScreenSource -Pattern $pattern
}
foreach ($pattern in @(
    "'Start learning chat'",
    "'Send message'",
    "'Restart chat'",
    "'Learning chat'",
    "'Coach feedback'",
    "'Quick replies'",
    "'Learner'",
    "'Coach'"
)) {
    Assert-True -Condition ($chatScreenSource -cnotmatch $pattern) -Message "Coach chat screen still hardcodes '$pattern'."
}

Write-Host 'Platform coach chat tests passed.'


