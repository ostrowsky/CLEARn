Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$platformRoot = Join-Path $workspaceRoot 'platform'
$webRoot = Join-Path $workspaceRoot 'web'
. (Join-Path $PSScriptRoot 'Assertions.ps1')

function Get-FreePort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
    $listener.Stop()
    return $port
}

function Wait-ForUrl {
    param([string]$Url,[int]$TimeoutSeconds = 60)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5 | Out-Null
            return $true
        }
        catch {
            Start-Sleep -Milliseconds 600
        }
    }

    return $false
}

function Invoke-JsonRequest {
    param(
        [string]$Uri,
        [string]$Method,
        $Payload = $null
    )

    $params = @{
        UseBasicParsing = $true
        Uri = $Uri
        Method = $Method
        ContentType = 'application/json; charset=utf-8'
    }

    if ($null -ne $Payload) {
        $params.Body = ($Payload | ConvertTo-Json -Depth 20 -Compress)
    }

    $response = Invoke-WebRequest @params
    if ([string]::IsNullOrWhiteSpace($response.Content)) {
        return $null
    }

    return ($response.Content | ConvertFrom-Json)
}

function Test-QuestionFormationSourceSentence {
    param([string]$Sentence)

    $trimmed = ([string]$Sentence).Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
        return $false
    }

    if ($trimmed -match '\?\s*$') {
        return $false
    }

    return ($trimmed -notmatch '(?i)^(who|whom|whose|what|which|where|when|why|how|do|does|did|is|are|was|were|will|would|can|could|should|may|might|must|have|has|had)\b')
}

function Test-ContainsAnswer {
    param([string]$Sentence,[string]$Answer)

    $normalizedSentence = ([string]$Sentence).ToLowerInvariant() -replace '[^a-z0-9]+', ' '
    $normalizedAnswer = ([string]$Answer).ToLowerInvariant() -replace '[^a-z0-9]+', ' '
    return $normalizedSentence.Contains($normalizedAnswer.Trim())
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
}
if (-not $nodeCommand -and (Test-Path -LiteralPath 'C:\Program Files\nodejs\node.exe')) {
    $nodeCommand = [PSCustomObject]@{ Source = 'C:\Program Files\nodejs\node.exe' }
}
if (-not $nodeCommand) {
    Write-Host 'Platform question formation API tests skipped: Node.js was not found in this environment.'
    return
}

$tsxCli = Join-Path $platformRoot 'node_modules\tsx\dist\cli.mjs'
if (-not (Test-Path -LiteralPath $tsxCli)) {
    Write-Host 'Platform question formation API tests skipped: tsx CLI was not found. Run pnpm install in platform first.'
    return
}

$tempRoot = Join-Path $workspaceRoot ('tmp-platform-question-formation-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
$tempContentPath = Join-Path $tempRoot 'content.json'
Copy-Item -LiteralPath (Join-Path $webRoot 'data\content.json') -Destination $tempContentPath -Force
$logPath = Join-Path $tempRoot 'platform-question-formation-api.log'

$port = Get-FreePort
$baseUrl = "http://127.0.0.1:$port"
$serverProcess = $null

try {
    Write-TestStep 'Platform API checks question formation against grammar and visible context'
    $command = "Set-Location '$platformRoot'; `$env:APP_ENV='development'; `$env:APP_PORT='$port'; `$env:APP_BASE_URL='$baseUrl'; `$env:DEV_CONTENT_PATH='$tempContentPath'; & '$($nodeCommand.Source)' '.\node_modules\tsx\dist\cli.mjs' '.\apps\api\src\index.ts' *> '$logPath'"
    $serverProcess = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $command) -PassThru -WindowStyle Hidden

    if (-not (Wait-ForUrl -Url "$baseUrl/api/health")) {
        $combinedLogs = if (Test-Path -LiteralPath $logPath) { Get-Content -LiteralPath $logPath -Raw -ErrorAction SilentlyContinue } else { '' }
        if ($combinedLogs -match 'spawn EPERM' -or $combinedLogs -match 'esbuild' -or $combinedLogs -match 'windows sandbox') {
            Write-Host 'Platform question formation API tests skipped: this environment blocks tsx/esbuild child processes.'
            return
        }

        throw "Platform API did not become ready. Logs:`n$combinedLogs"
    }

    $basePayload = @{
        sentence = 'The backend team fixed six API defects in staging yesterday.'
        answer = 'backend team'
        whWord = 'Who'
        expectedQuestion = 'Who fixed six API defects in staging yesterday?'
        acceptedQuestions = @(
            'Who fixed six API defects in staging yesterday?',
            'Who fixed it yesterday?'
        )
    }

    $acceptedPronoun = Invoke-JsonRequest -Uri "$baseUrl/api/practice/question-formation/check" -Method Post -Payload ($basePayload + @{
        userQuestion = 'Who fixed it yesterday?'
    })
    Assert-True -Condition ([bool]$acceptedPronoun.accepted) -Message 'Short visible-context pronoun question should be accepted.'

    $acceptedDid = Invoke-JsonRequest -Uri "$baseUrl/api/practice/question-formation/check" -Method Post -Payload ($basePayload + @{
        userQuestion = 'Who did fix it yesterday?'
    })
    Assert-True -Condition ([bool]$acceptedDid.accepted) -Message 'Did-form visible-context question should be accepted.'

    $rejectedWrongVisibleWord = Invoke-JsonRequest -Uri "$baseUrl/api/practice/question-formation/check" -Method Post -Payload @{
        sentence = 'The backend team fixed six API defects in staging yesterday.'
        answer = 'six API defects'
        whWord = 'What'
        expectedQuestion = 'What did the backend team fix in staging yesterday?'
        acceptedQuestions = @(
            'What did the backend team fix yesterday?',
            'What did the backend team fix in staging yesterday?'
        )
        userQuestion = 'What did the backhand team fix yesterday?'
    }
    Assert-True -Condition (-not [bool]$rejectedWrongVisibleWord.accepted) -Message 'Question formation should reject questions that distort visible sentence words.'

    $rejectedPastAfterDid = Invoke-JsonRequest -Uri "$baseUrl/api/practice/question-formation/check" -Method Post -Payload @{
        sentence = 'The backend team fixed six API defects in staging yesterday.'
        answer = 'six API defects'
        whWord = 'What'
        expectedQuestion = 'What did the backend team fix in staging yesterday?'
        acceptedQuestions = @(
            'What did the backend team fix yesterday?',
            'What did the backend team fix in staging yesterday?'
        )
        userQuestion = 'What did the backend team fixed yesterday?'
    }
    Assert-True -Condition (-not [bool]$rejectedPastAfterDid.accepted) -Message 'Question formation should reject past-tense verbs immediately after did.'

    $rejectedMissingAuxiliary = Invoke-JsonRequest -Uri "$baseUrl/api/practice/question-formation/check" -Method Post -Payload @{
        sentence = 'Stakeholders will review return on investment at the end of the year.'
        answer = 'return on investment'
        whWord = 'What'
        expectedQuestion = 'What will stakeholders review at the end of the year?'
        acceptedQuestions = @(
            'What will stakeholders review?',
            'What will stakeholders review at the end of the year?'
        )
        userQuestion = 'What they review?'
    }
    Assert-True -Condition (-not [bool]$rejectedMissingAuxiliary.accepted) -Message 'Question formation should reject object WH questions without an auxiliary verb.'

    $acceptedVisibleSubject = Invoke-JsonRequest -Uri "$baseUrl/api/practice/question-formation/check" -Method Post -Payload @{
        sentence = 'Stakeholders will review return on investment at the end of the year.'
        answer = 'return on investment'
        whWord = 'What'
        expectedQuestion = 'What will stakeholders review at the end of the year?'
        acceptedQuestions = @(
            'What will stakeholders review?',
            'What will stakeholders review at the end of the year?'
        )
        userQuestion = 'What will stakeholders review?'
    }
    Assert-True -Condition ([bool]$acceptedVisibleSubject.accepted) -Message 'Question formation should accept short object questions that keep the visible subject.'

    $acceptedVisiblePronoun = Invoke-JsonRequest -Uri "$baseUrl/api/practice/question-formation/check" -Method Post -Payload @{
        sentence = 'Stakeholders will review return on investment at the end of the year.'
        answer = 'return on investment'
        whWord = 'What'
        expectedQuestion = 'What will stakeholders review at the end of the year?'
        acceptedQuestions = @(
            'What will stakeholders review?',
            'What will they review?'
        )
        userQuestion = 'What will they review?'
    }
    Assert-True -Condition ([bool]$acceptedVisiblePronoun.accepted) -Message 'Question formation should accept natural pronoun references to already visible subjects.'

    $rejectedModalPastVerb = Invoke-JsonRequest -Uri "$baseUrl/api/practice/question-formation/check" -Method Post -Payload @{
        sentence = 'Stakeholders will review return on investment at the end of the year.'
        answer = 'return on investment'
        whWord = 'What'
        expectedQuestion = 'What will stakeholders review at the end of the year?'
        acceptedQuestions = @(
            'What will stakeholders review?',
            'What will they review?'
        )
        userQuestion = 'What will they reviewed?'
    }
    Assert-True -Condition (-not [bool]$rejectedModalPastVerb.accepted) -Message 'Question formation should reject past-tense verbs after modal auxiliaries.'

    Write-TestStep 'Every bundled question formation exercise is a statement with three valid targets'
    $practiceServicePath = (Join-Path $platformRoot 'apps\api\src\modules\practice\practice.service.ts').Replace('\', '/')
    $deckDumpPath = Join-Path $tempRoot 'dump-question-formation-deck.mts'
    Set-Content -LiteralPath $deckDumpPath -Encoding UTF8 -Value @"
import { defaultQuestionFormationDeck, proceduralQuestionFormationCatalog } from 'file:///$practiceServicePath';
console.log(JSON.stringify([...defaultQuestionFormationDeck, ...proceduralQuestionFormationCatalog]));
"@
    $deckOutput = & $nodeCommand.Source $tsxCli $deckDumpPath
    $deckJson = ($deckOutput | Where-Object { $_ -match '^\s*\[' } | Select-Object -Last 1)
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$deckJson)) -Message 'Could not load bundled question formation exercises for validation.'
    $allExercises = [System.Collections.ArrayList]::new()
    foreach ($item in ($deckJson | ConvertFrom-Json)) {
        [void]$allExercises.Add($item)
    }
    Assert-True -Condition ($allExercises.Count -ge 10) -Message 'Question formation should have a broad bundled exercise catalog.'

    foreach ($exercise in $allExercises) {
        $sentence = [string]$exercise.sentence
        Assert-True -Condition (Test-QuestionFormationSourceSentence -Sentence $sentence) -Message "Question formation source must be a declarative statement, not a question: $sentence"
        Assert-True -Condition ((($sentence).Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries)).Count -le 15) -Message "Question formation source sentence should stay within 15 words: $sentence"
        Assert-Equal -Expected 3 -Actual @($exercise.blanks).Count -Message "Question formation exercise should contain exactly three blanks: $sentence"

        foreach ($blank in @($exercise.blanks)) {
            $acceptedQuestions = if ($blank.PSObject.Properties.Name -contains 'acceptedQuestions') { @($blank.acceptedQuestions) } else { @() }
            Assert-True -Condition (Test-ContainsAnswer -Sentence $sentence -Answer ([string]$blank.answer)) -Message "Question formation answer '$($blank.answer)' should appear in source sentence: $sentence"
            Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$blank.expectedQuestion)) -Message "Question formation blank '$($blank.id)' should include an expected question."

            $acceptedExpected = Invoke-JsonRequest -Uri "$baseUrl/api/practice/question-formation/check" -Method Post -Payload @{
                sentence = $sentence
                answer = [string]$blank.answer
                whWord = [string]$blank.whWord
                expectedQuestion = [string]$blank.expectedQuestion
                acceptedQuestions = $acceptedQuestions
                userQuestion = [string]$blank.expectedQuestion
            }
            Assert-True -Condition ([bool]$acceptedExpected.accepted) -Message "Expected question should be accepted for '$($blank.answer)': $($blank.expectedQuestion)"

            foreach ($variant in $acceptedQuestions) {
                $acceptedVariant = Invoke-JsonRequest -Uri "$baseUrl/api/practice/question-formation/check" -Method Post -Payload @{
                    sentence = $sentence
                    answer = [string]$blank.answer
                    whWord = [string]$blank.whWord
                    expectedQuestion = [string]$blank.expectedQuestion
                    acceptedQuestions = $acceptedQuestions
                    userQuestion = [string]$variant
                }
                Assert-True -Condition ([bool]$acceptedVariant.accepted) -Message "Accepted variant should pass validation for '$($blank.answer)': $variant"
            }
        }
    }
}
finally {
    if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force
    }

    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host 'Platform question formation API tests passed.'
