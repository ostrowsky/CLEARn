Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot

. (Join-Path $PSScriptRoot "Assertions.ps1")
. (Join-Path $projectRoot "app\Services.ps1")

Write-TestStep "Clarify exercise returns a context-aware prompt"
$clarify = Get-ClarifyExercise -Context "I am a backend engineer working on billing APIs." -Offset 0
Assert-Match -Actual $clarify.prompt -Pattern "deployment|project|service|migration|contacted"
Assert-Match -Actual $clarify.expectedQuestion -Pattern "\?"
Assert-Match -Actual $clarify.target -Pattern "WHAT|WHO|WHEN|WHERE|HOW MUCH|HOW MANY"

Write-TestStep "Clarifying question feedback accepts the expected shape"
$clarifyFeedback = Test-ClarifyingQuestion `
    -UserQuestion "Sorry, the deployment window is WHEN?" `
    -ExpectedQuestion "Sorry, the deployment window is WHEN?" `
    -Target "WHEN" `
    -Focus "deployment window"
Assert-True -Condition $clarifyFeedback.accepted -Message "The feedback should accept a correct clarification question."

Write-TestStep "Ask-after-talk brief contains several speech lines"
$brief = Get-AskAfterTalkBrief -Context "I work on analytics and retention dashboards."
Assert-True -Condition ($brief.speechLines.Count -ge 3) -Message "Speech lines should contain at least three lines."
Assert-Match -Actual $brief.sampleQuestion -Pattern "\?"

Write-TestStep "Ask-after-talk feedback rewards a strong question shape"
$afterFeedback = Test-AskAfterQuestion -Question "You mentioned the next release. Could you be a little more specific about that?"
Assert-True -Condition $afterFeedback.accepted -Message "The follow-up question should be accepted."

Write-TestStep "Answering session closes after five lines"
$store = @{}
$session = New-AnsweringSession -Context "I lead a frontend design system rollout." -Mode "difficult"
$store[$session.sessionId] = $session
$updatedOne = Submit-AnsweringReply -SessionStore $store -SessionId $session.sessionId -UserReply "We had an API dependency and re-planned the timeline."
Assert-Equal -Expected 3 -Actual $updatedOne.messages.Count
Assert-True -Condition (-not $updatedOne.completed)
$updatedTwo = Submit-AnsweringReply -SessionStore $store -SessionId $session.sessionId -UserReply "The biggest risk is testing coverage, so we are pairing with QA."
Assert-Equal -Expected 5 -Actual $updatedTwo.messages.Count
Assert-True -Condition $updatedTwo.completed -Message "The dialogue should complete at the five-line cap."

Write-Host "Service tests passed."

