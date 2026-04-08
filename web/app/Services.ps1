Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'ContentStore.ps1')

function Get-ServicesProjectRoot {
    return (Split-Path -Parent $PSScriptRoot)
}

function Get-ServicesContent {
    return (Get-AppContent -ProjectRoot (Get-ServicesProjectRoot))
}

function Get-PracticeConfig {
    $content = Get-ServicesContent
    return $content.meta.practice
}

function Get-AskAfterPhraseLists {
    $content = Get-ServicesContent
    $section = $content.sections | Where-Object { $_.route -eq '/asking/after-talk' } | Select-Object -First 1
    $contextBlock = $section.blocks | Where-Object { $_.id -eq 'context-leads' } | Select-Object -First 1
    $followBlock = $section.blocks | Where-Object { $_.id -eq 'follow-up-leads' } | Select-Object -First 1

    return [PSCustomObject]@{
        contextOpeners = @($contextBlock.materials | ForEach-Object { [string]$_.body })
        followUps = @($followBlock.materials | ForEach-Object { [string]$_.body })
    }
}

function Format-TemplateText {
    param(
        [string]$Template,
        [hashtable]$Values
    )

    $result = [string]$Template
    foreach ($entry in $Values.GetEnumerator()) {
        $result = $result.Replace(('{' + $entry.Key + '}'), [string]$entry.Value)
    }

    return $result
}

function Get-ContextProfileKey {
    param([string]$Context)

    if ([string]::IsNullOrWhiteSpace($Context)) { return 'general' }

    $lower = $Context.ToLowerInvariant()
    if ($lower -match 'front|react|ui|ux|design system|css|angular|javascript') { return 'frontend' }
    if ($lower -match 'back|api|microservice|service|database|sql|java|dotnet|server') { return 'backend' }
    if ($lower -match 'data|analytics|bi|dashboard|metric|insight|retention') { return 'data' }
    if ($lower -match 'product|roadmap|discovery|stakeholder|priorit') { return 'product' }
    if ($lower -match 'qa|test|quality|automation|regression') { return 'qa' }
    if ($lower -match 'devops|infrastructure|kubernetes|ci|cd|deploy') { return 'backend' }
    return 'general'
}

function Get-ProfileData {
    param([string]$Context)

    $config = Get-PracticeConfig
    $key = Get-ContextProfileKey -Context $Context
    return $config.clarifyProfiles.$key
}

function Get-StableIndex {
    param([string]$Seed,[int]$Count,[int]$Offset = 0)

    if ($Count -le 0) { return 0 }

    $sum = 0
    foreach ($character in ($Seed.ToCharArray())) {
        $sum += [int][char]$character
    }

    return (($sum + $Offset) % $Count)
}

function Get-RotatedItems {
    param([object[]]$Items,[string]$Seed,[int]$Take = 4,[int]$Offset = 0)

    if (-not $Items -or $Items.Count -eq 0) { return @() }

    $start = Get-StableIndex -Seed $Seed -Count $Items.Count -Offset $Offset
    $selected = @()
    for ($index = 0; $index -lt $Take; $index += 1) {
        $selected += $Items[(($start + $index) % $Items.Count)]
    }

    return $selected
}

function Get-ContextSummary {
    param([string]$Context)

    if ([string]::IsNullOrWhiteSpace($Context)) { return 'your current project' }

    $clean = ($Context -replace '\s+', ' ').Trim()
    if ($clean.Length -gt 96) { return ($clean.Substring(0, 93) + '...') }
    return $clean
}

function Test-RemoteLlmConfigured {
    return [bool]($env:SOFTSKILLS_LLM_API_KEY -and $env:SOFTSKILLS_LLM_MODEL)
}

function Get-GeneratorMode {
    if (Test-RemoteLlmConfigured) { return 'remote-llm' }
    return 'local-practice-engine'
}

function Invoke-OptionalLlmJson {
    param([string]$SystemPrompt,[string]$UserPrompt)

    if (-not (Test-RemoteLlmConfigured)) {
        return [PSCustomObject]@{ success = $false; payload = $null; error = $null; source = 'not-configured' }
    }

    $endpoint = $env:SOFTSKILLS_LLM_ENDPOINT
    if ([string]::IsNullOrWhiteSpace($endpoint)) {
        $endpoint = 'https://api.openai.com/v1/chat/completions'
    }

    try {
        $body = @{
            model = $env:SOFTSKILLS_LLM_MODEL
            temperature = 0.8
            response_format = @{ type = 'json_object' }
            messages = @(
                @{ role = 'system'; content = $SystemPrompt },
                @{ role = 'user'; content = $UserPrompt }
            )
        }

        $headers = @{ Authorization = "Bearer $($env:SOFTSKILLS_LLM_API_KEY)"; 'Content-Type' = 'application/json' }
        $response = Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers -Body ($body | ConvertTo-Json -Depth 8)
        $content = $response.choices[0].message.content
        if ([string]::IsNullOrWhiteSpace($content)) {
            return [PSCustomObject]@{ success = $false; payload = $null; error = 'The provider returned an empty response body.'; source = 'remote-error' }
        }

        return [PSCustomObject]@{ success = $true; payload = ($content | ConvertFrom-Json); error = $null; source = 'remote-llm' }
    }
    catch {
        return [PSCustomObject]@{ success = $false; payload = $null; error = $_.Exception.Message; source = 'remote-error' }
    }
}

function Get-ClarifyExercise {
    param([string]$Context,[int]$Offset = 0)

    $config = Get-PracticeConfig
    $profileKey = Get-ContextProfileKey -Context $Context
    $profile = Get-ProfileData -Context $Context
    $summary = Get-ContextSummary -Context $Context
    $scenario = $profile.clarifyExercises[(Get-StableIndex -Seed $summary -Count $profile.clarifyExercises.Count -Offset $Offset)]

    $remote = Invoke-OptionalLlmJson `
        -SystemPrompt 'You create concise English practice prompts for IT professionals. Return JSON with prompt, expectedQuestion, target, focus and coachingTip.' `
        -UserPrompt "Context: $Context`nBase prompt: $($scenario.fragment)`nReturn one missing-detail practice item."

    if ($remote.success -and $remote.payload.prompt -and $remote.payload.expectedQuestion -and $remote.payload.target) {
        return [PSCustomObject]@{
            profileKey = $profileKey
            prompt = [string]$remote.payload.prompt
            expectedQuestion = [string]$remote.payload.expectedQuestion
            target = [string]$remote.payload.target
            focus = [string]$remote.payload.focus
            coachingTip = [string]$remote.payload.coachingTip
            generatorMode = 'remote-llm'
        }
    }

    return [PSCustomObject]@{
        profileKey = $profileKey
        prompt = [string]$scenario.fragment
        expectedQuestion = [string]$scenario.expectedQuestion
        target = [string]$scenario.target
        focus = [string]$scenario.focus
        coachingTip = [string]$config.clarifyCoachingTip
        generatorMode = if (Test-RemoteLlmConfigured) { 'local-fallback' } else { 'local-practice-engine' }
        providerError = $remote.error
    }
}

function Normalize-QuestionText {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) { return '' }
    return (((($Text.ToLowerInvariant()) -replace '[^a-z0-9? ]', ' ') -replace '\s+', ' ').Trim())
}

function Test-ClarifyingQuestion {
    param([string]$UserQuestion,[string]$ExpectedQuestion,[string]$Target,[string]$Focus)

    $config = Get-PracticeConfig
    $normalized = Normalize-QuestionText -Text $UserQuestion
    $normalizedTarget = Normalize-QuestionText -Text $Target
    $focusTokens = @((Normalize-QuestionText -Text $Focus).Split(' ') | Where-Object { $_.Length -ge 3 })
    $hasSorry = ($normalized -match '\bsorry\b') -or ($normalized -match '\bpardon\b') -or ($normalized -match '\bexcuse\b')
    $hasTarget = $normalized -match ('\b' + [regex]::Escape($normalizedTarget) + '\b')
    $hasFocus = $false
    foreach ($token in $focusTokens) {
        if ($normalized -match ('\b' + [regex]::Escape($token) + '\b')) { $hasFocus = $true; break }
    }

    $score = 0
    if ($hasSorry) { $score += 1 }
    if ($hasFocus) { $score += 1 }
    if ($hasTarget) { $score += 2 }

    $accepted = $hasTarget -and ($hasFocus -or $normalized.Length -ge 12)
    $feedback = if ($accepted) {
        $config.clarifyFeedback.accepted
    }
    elseif (-not $hasTarget) {
        Format-TemplateText -Template ([string]$config.clarifyFeedback.wrongTarget) -Values @{ target = $Target }
    }
    elseif (-not $hasFocus) {
        $config.clarifyFeedback.missingFocus
    }
    else {
        $config.clarifyFeedback.missingPolite
    }

    return [PSCustomObject]@{ accepted = $accepted; score = $score; feedback = $feedback; expectedQuestion = $ExpectedQuestion }
}

function Get-AskWithoutContextExercise {
    param([int]$Offset = 0)

    $config = Get-PracticeConfig
    $scenario = $config.noContextDeck[(Get-StableIndex -Seed 'generic' -Count $config.noContextDeck.Count -Offset $Offset)]
    $remote = Invoke-OptionalLlmJson `
        -SystemPrompt 'You create concise English clarification drills for IT professionals. Return JSON with prompt, expectedQuestion, target, focus and coachingTip.' `
        -UserPrompt 'Create one generic missing-detail workplace prompt without needing any role context. Use a target like WHO, WHAT, WHEN, WHERE, HOW MUCH, or HOW MANY.'

    if ($remote.success -and $remote.payload.prompt -and $remote.payload.expectedQuestion -and $remote.payload.target) {
        return [PSCustomObject]@{
            prompt = [string]$remote.payload.prompt
            expectedQuestion = [string]$remote.payload.expectedQuestion
            target = [string]$remote.payload.target
            focus = [string]$remote.payload.focus
            coachingTip = [string]$remote.payload.coachingTip
            generatorMode = 'remote-llm'
        }
    }

    return [PSCustomObject]@{
        prompt = [string]$scenario.fragment
        expectedQuestion = [string]$scenario.expectedQuestion
        target = [string]$scenario.target
        focus = [string]$scenario.focus
        coachingTip = [string]$config.withoutContextCoachingTip
        generatorMode = if (Test-RemoteLlmConfigured) { 'local-fallback' } else { 'curated-drill' }
        providerError = $remote.error
    }
}

function Get-AskAfterTalkBrief {
    param([string]$Context,[int]$Offset = 0)

    $config = Get-PracticeConfig
    $profile = Get-ProfileData -Context $Context
    $summary = Get-ContextSummary -Context $Context
    $speechLines = Get-RotatedItems -Items $profile.talkFacts -Seed $summary -Take 4 -Offset $Offset
    $phraseLists = Get-AskAfterPhraseLists

    $remote = Invoke-OptionalLlmJson `
        -SystemPrompt 'You create short workplace speeches for English learners. Return JSON with speechLines as an array of 3-4 strings, a sampleQuestion and a coachingTip.' `
        -UserPrompt "Context: $Context`nCreate a short talk for a follow-up question exercise for an IT professional."

    if ($remote.success -and $remote.payload.speechLines) {
        return [PSCustomObject]@{
            speechLines = @($remote.payload.speechLines)
            sampleQuestion = [string]$remote.payload.sampleQuestion
            coachingTip = [string]$remote.payload.coachingTip
            generatorMode = 'remote-llm'
            contextOpeners = $phraseLists.contextOpeners
            followUps = $phraseLists.followUps
        }
    }

    return [PSCustomObject]@{
        speechLines = $speechLines
        sampleQuestion = [string]$config.askAfterSampleQuestion
        coachingTip = [string]$config.askAfterCoachingTip
        generatorMode = if (Test-RemoteLlmConfigured) { 'local-fallback' } else { 'local-practice-engine' }
        contextOpeners = $phraseLists.contextOpeners
        followUps = $phraseLists.followUps
        providerError = $remote.error
    }
}

function Test-AskAfterQuestion {
    param([string]$Question)

    $config = Get-PracticeConfig
    $phraseLists = Get-AskAfterPhraseLists
    $normalized = Normalize-QuestionText -Text $Question
    $contextPatterns = @($phraseLists.contextOpeners | ForEach-Object { Normalize-QuestionText -Text $_ })
    $followPatterns = @($phraseLists.followUps | ForEach-Object { Normalize-QuestionText -Text $_ })

    $hasContextLeadIn = ($contextPatterns | Where-Object { $normalized.Contains($_) } | Select-Object -First 1) -ne $null
    $hasFollowUp = ($followPatterns | Where-Object { $normalized.Contains((((($_ -replace 'who when what', '') -replace '\.\.\.', '') -replace '\?', '').Trim())) } | Select-Object -First 1) -ne $null
    $hasQuestionMark = $Question.Contains('?')
    $accepted = $hasContextLeadIn -and $hasFollowUp -and $hasQuestionMark

    $feedback = if ($accepted) {
        $config.askAfterFeedback.accepted
    }
    elseif (-not $hasContextLeadIn) {
        $config.askAfterFeedback.missingContext
    }
    elseif (-not $hasFollowUp) {
        $config.askAfterFeedback.missingFollow
    }
    else {
        $config.askAfterFeedback.missingQuestion
    }

    $score = 0
    if ($hasContextLeadIn) { $score += 2 }
    if ($hasFollowUp) { $score += 2 }
    if ($hasQuestionMark) { $score += 1 }

    return [PSCustomObject]@{ accepted = $accepted; score = $score; feedback = $feedback }
}

function Get-AnsweringPromptPack {
    param([string]$Context,[string]$Mode)

    $config = Get-PracticeConfig
    $profile = Get-ProfileData -Context $Context
    $summary = Get-ContextSummary -Context $Context
    $topic = [string]$profile.topic
    $modeConfig = $config.answeringModes.$Mode
    if (-not $modeConfig) { throw "Unknown answering mode: $Mode" }

    $localPack = @{
        promptOne = Format-TemplateText -Template ([string]$modeConfig.promptOne) -Values @{ summary = $summary; topic = $topic }
        promptTwo = Format-TemplateText -Template ([string]$modeConfig.promptTwo) -Values @{ summary = $summary; topic = $topic }
        wrapUp = [string]$modeConfig.wrapUp
        coachingTip = [string]$modeConfig.coachingTip
    }

    $remote = Invoke-OptionalLlmJson `
        -SystemPrompt 'You create short meeting-practice dialogues for IT professionals learning English. Return JSON with promptOne, promptTwo, wrapUp and coachingTip.' `
        -UserPrompt "Mode: $Mode`nContext: $Context`nCreate two assistant questions and one short wrap-up for a five-line dialogue. Keep everything concise and realistic for meetings, interviews, one-to-ones, agile rituals, or Q&A sessions."

    if ($remote.success -and $remote.payload.promptOne -and $remote.payload.promptTwo -and $remote.payload.wrapUp) {
        return @{
            promptOne = [string]$remote.payload.promptOne
            promptTwo = [string]$remote.payload.promptTwo
            wrapUp = [string]$remote.payload.wrapUp
            coachingTip = [string]$remote.payload.coachingTip
            generatorMode = 'remote-llm'
            providerError = $null
        }
    }

    $localPack.generatorMode = if (Test-RemoteLlmConfigured) { 'local-fallback' } else { 'local-practice-engine' }
    $localPack.providerError = $remote.error
    return $localPack
}

function New-AnsweringSession {
    param([string]$Context,[string]$Mode)

    $pack = Get-AnsweringPromptPack -Context $Context -Mode $Mode
    return @{
        sessionId = [guid]::NewGuid().ToString()
        mode = $Mode
        context = $Context
        messageLimit = 5
        coachingTip = $pack.coachingTip
        promptTwo = $pack.promptTwo
        wrapUp = $pack.wrapUp
        completed = $false
        generatorMode = $pack.generatorMode
        providerError = $pack.providerError
        messages = @([PSCustomObject]@{ role = 'assistant'; text = $pack.promptOne })
    }
}

function Submit-AnsweringReply {
    param([hashtable]$SessionStore,[string]$SessionId,[string]$UserReply)

    if (-not $SessionStore.ContainsKey($SessionId)) { throw 'Answering session not found.' }
    $session = $SessionStore[$SessionId]
    if ($session.completed) {
        return [PSCustomObject]@{ sessionId = $session.sessionId; completed = $true; messages = $session.messages; coachingTip = $session.coachingTip; messageLimit = $session.messageLimit }
    }

    $session.messages += [PSCustomObject]@{ role = 'user'; text = $UserReply }
    if ($session.messages.Count -ge $session.messageLimit) {
        $session.completed = $true
    }
    elseif ($session.messages.Count -eq 2) {
        $session.messages += [PSCustomObject]@{ role = 'assistant'; text = $session.promptTwo }
    }
    else {
        $session.messages += [PSCustomObject]@{ role = 'assistant'; text = $session.wrapUp }
        $session.completed = $true
    }

    $SessionStore[$SessionId] = $session
    return [PSCustomObject]@{
        sessionId = $session.sessionId
        completed = $session.completed
        messages = $session.messages
        coachingTip = $session.coachingTip
        messageLimit = $session.messageLimit
        generatorMode = $session.generatorMode
        providerError = $session.providerError
    }
}


