Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$platformRoot = Join-Path $workspaceRoot 'platform'
$webRoot = Join-Path $workspaceRoot 'web'
. (Join-Path $PSScriptRoot 'Assertions.ps1')

function Get-Prop {
    param([object]$Value, [string]$Name, [object]$Default = $null)
    if ($null -eq $Value) { return $Default }
    $prop = $Value.PSObject.Properties[$Name]
    if ($null -eq $prop) { return $Default }
    return $prop.Value
}

function Has-Prop {
    param([object]$Value, [string]$Name)
    if ($null -eq $Value) { return $false }
    return $null -ne $Value.PSObject.Properties[$Name]
}

function Convert-ToSeconds {
    param([string]$Value)
    $clean = ([string]$Value).Trim().ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($clean)) { return 0 }

    if ($clean -match '^\d+:\d{1,2}(:\d{1,2})?$') {
        $total = 0
        foreach ($part in ($clean.Split(':') | ForEach-Object { [int]$_ })) { $total = ($total * 60) + $part }
        return $total
    }

    if ($clean -match '^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$' -and ($Matches[1] -or $Matches[2] -or $Matches[3])) {
        $hours = if ($Matches[1]) { [int]$Matches[1] } else { 0 }
        $minutes = if ($Matches[2]) { [int]$Matches[2] } else { 0 }
        $seconds = if ($Matches[3]) { [int]$Matches[3] } else { 0 }
        return ($hours * 3600) + ($minutes * 60) + $seconds
    }

    $numeric = 0
    if ([int]::TryParse($clean, [ref]$numeric)) { return $numeric }
    return 0
}

function Get-QueryParam {
    param([string]$Url, [string]$Name)
    try {
        $uri = [System.Uri]::new($Url)
        foreach ($pair in ($uri.Query.TrimStart('?') -split '&')) {
            if ([string]::IsNullOrWhiteSpace($pair)) { continue }
            $parts = $pair -split '=', 2
            $key = [System.Uri]::UnescapeDataString($parts[0])
            if ($key -ne $Name) { continue }
            if ($parts.Count -lt 2) { return '' }
            return [System.Uri]::UnescapeDataString($parts[1])
        }
    } catch {}
    return ''
}

function Get-MetaValue {
    param([object]$Material, [string[]]$Names)
    $meta = Get-Prop -Value $Material -Name 'meta' -Default $null
    foreach ($name in $Names) {
        $value = Get-Prop -Value $meta -Name $name -Default $null
        if ($null -ne $value -and -not [string]::IsNullOrWhiteSpace([string]$value)) { return [string]$value }
    }
    return ''
}

function Get-TranscriptSegments {
    param([object]$Material)
    $meta = Get-Prop -Value $Material -Name 'meta' -Default $null
    $segments = Get-Prop -Value $meta -Name 'transcriptSegments' -Default $null
    if ($null -eq $segments) { return @() }
    return @($segments)
}

function Get-PlainTranscript {
    param([object]$Material)
    return ([string](Get-MetaValue -Material $Material -Names @('transcript', 'videoTranscript', 'caption'))).Trim()
}

function Test-TranscriptSegmentsCoverBounds {
    param([object]$Material, [int]$SegmentStart, [int]$SegmentEnd, [string]$Context)
    $segments = @(Get-TranscriptSegments -Material $Material)
    Assert-True -Condition ($segments.Count -gt 0) -Message "$Context must define transcriptSegments when transcript timing must be validated."

    foreach ($segment in $segments) {
        $text = [string](Get-Prop -Value $segment -Name 'text' -Default '')
        $segmentStartRaw = [string](Get-Prop -Value $segment -Name 'start' -Default '')
        $segmentEndRaw = [string](Get-Prop -Value $segment -Name 'end' -Default '')
        Assert-True -Condition (-not [string]::IsNullOrWhiteSpace($text)) -Message "$Context transcript segment must contain non-empty text."
        Assert-True -Condition (-not [string]::IsNullOrWhiteSpace($segmentStartRaw)) -Message "$Context transcript segment must define start time."
        Assert-True -Condition (-not [string]::IsNullOrWhiteSpace($segmentEndRaw)) -Message "$Context transcript segment must define end time."

        $segmentTranscriptStart = Convert-ToSeconds $segmentStartRaw
        $segmentTranscriptEnd = Convert-ToSeconds $segmentEndRaw
        Assert-True -Condition ($segmentTranscriptEnd -gt $segmentTranscriptStart) -Message "$Context transcript segment end must be greater than start."
        Assert-True -Condition ($segmentTranscriptStart -ge $SegmentStart) -Message "$Context transcript segment starts before the configured YouTube segment."
        Assert-True -Condition ($segmentTranscriptStart -lt $SegmentEnd) -Message "$Context transcript segment starts after the configured YouTube segment end."
        Assert-True -Condition ($segmentTranscriptEnd -le $SegmentEnd) -Message "$Context transcript segment ends after the configured YouTube segment end."
    }
}

function Find-VideoMaterials {
    param([object]$Node, [string]$Path = '$')
    $results = New-Object System.Collections.Generic.List[object]
    if ($null -eq $Node) { return $results }

    if ($Node -is [System.Collections.IEnumerable] -and $Node -isnot [string]) {
        $index = 0
        foreach ($item in $Node) {
            foreach ($result in (Find-VideoMaterials -Node $item -Path "$Path[$index]")) { $results.Add($result) }
            $index += 1
        }
        return $results
    }

    if ($Node -is [pscustomobject]) {
        if ((Has-Prop -Value $Node -Name 'type') -and ([string](Get-Prop -Value $Node -Name 'type') -eq 'video')) {
            $results.Add([pscustomobject]@{ Path = $Path; Material = $Node })
        }
        foreach ($property in @($Node.PSObject.Properties)) {
            foreach ($result in (Find-VideoMaterials -Node $property.Value -Path "$Path.$($property.Name)")) { $results.Add($result) }
        }
    }
    return $results
}

function Test-YouTubeUrl {
    param([string]$Url)
    return $Url -match 'youtu\.be/' -or $Url -match 'youtube\.com/(watch|embed|shorts|live)'
}

function Get-VideoSegmentBounds {
    param([object]$Material)
    $url = [string](Get-Prop -Value $Material -Name 'url' -Default '')
    $startRaw = Get-QueryParam -Url $url -Name 'start'
    if ([string]::IsNullOrWhiteSpace($startRaw)) { $startRaw = Get-QueryParam -Url $url -Name 't' }
    $endRaw = Get-QueryParam -Url $url -Name 'end'
    return [pscustomobject]@{ StartRaw = $startRaw; EndRaw = $endRaw; Start = Convert-ToSeconds $startRaw; End = Convert-ToSeconds $endRaw }
}

function Invoke-YouTubeTranscriptLiveCheck {
    param([string]$Url, [int]$ExpectedStart, [int]$ExpectedEnd, [string]$Context)
    if ([string]$env:RUN_YOUTUBE_TRANSCRIPT_LIVE_TESTS -ne '1') { return }

    $baseUrl = [string]$env:YOUTUBE_TRANSCRIPT_TEST_API_BASE_URL
    if ([string]::IsNullOrWhiteSpace($baseUrl)) { $baseUrl = [string]$env:EXPO_PUBLIC_API_BASE_URL }
    if ([string]::IsNullOrWhiteSpace($baseUrl)) { $baseUrl = 'https://clearn-api.onrender.com' }

    $endpoint = "$($baseUrl.TrimEnd('/'))/api/media/youtube-transcript-segment?url=$([System.Uri]::EscapeDataString($Url))"
    $response = Invoke-RestMethod -Method Get -Uri $endpoint -TimeoutSec 45
    Assert-True -Condition ([bool]$response.available) -Message "$Context live YouTube transcript must be available from $endpoint"
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$response.text)) -Message "$Context live YouTube transcript text must not be empty."
    Assert-Equal -Expected ([string]$ExpectedStart) -Actual ([string][int]$response.start) -Message "$Context live YouTube transcript start must match video start."
    Assert-Equal -Expected ([string]$ExpectedEnd) -Actual ([string][int]$response.end) -Message "$Context live YouTube transcript end must match video end."
}

Write-TestStep 'Learner video materials render inline for uploaded files and streaming URLs'
$sectionSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\app\section\[id].tsx') -Raw
foreach ($pattern in @(
    'getYouTubeVideoInfo',
    'parsed\.searchParams\.get\(''start''\)',
    'parsed\.searchParams\.get\(''t''\)',
    'parsed\.searchParams\.get\(''end''\)',
    "params\.set\('start', String\(youTubeInfo\.start\)\)",
    "params\.set\('end', String\(youTubeInfo\.end\)\)",
    "params\.set\('enablejsapi', '1'\)",
    "params\.set\('origin'",
    'useFocusedMediaActive',
    'useFocusEffect',
    'https://www\.youtube\.com/embed/',
    'WebVideoEmbed',
    '<iframe',
    'WebVideoPlayer',
    '<video controls playsInline preload="metadata"',
    '<source src=\{url\}',
    'aspectRatio: 16 / 9',
    "objectFit: 'contain'",
    'VideoTranscript',
    'apiClient\.getVideoTranscript\(mediaUrl\)',
    'getMaterialTranscript',
    'transcriptSegments',
    'transcriptBox',
    'maxHeight: 220',
    'ScrollView',
    'transcriptText'
)) { Assert-Match -Actual $sectionSource -Pattern $pattern }

Write-TestStep 'YouTube segment embeds force-stop playback at the configured end time'
foreach ($pattern in @(
    'youtubeSegmentEnd',
    'iframeRef',
    'postMessage',
    'getCurrentTime',
    'infoDelivery',
    'currentTime >= youtubeSegmentEnd',
    'pauseVideo',
    'seekTo',
    'window\.addEventListener\(''message''',
    'window\.setInterval'
)) { Assert-Match -Actual $sectionSource -Pattern $pattern }

Write-TestStep 'Every configured YouTube video material is clipped to a finite segment'
foreach ($fileName in @('content.json', 'content.template.json')) {
    $content = Get-Content -LiteralPath (Join-Path $webRoot "data\$fileName") -Raw | ConvertFrom-Json
    foreach ($video in (Find-VideoMaterials -Node $content -Path $fileName)) {
        $material = $video.Material
        $url = [string](Get-Prop -Value $material -Name 'url' -Default '')
        if ([string]::IsNullOrWhiteSpace($url) -or -not (Test-YouTubeUrl -Url $url)) { continue }

        $bounds = Get-VideoSegmentBounds -Material $material
        Assert-True -Condition (-not [string]::IsNullOrWhiteSpace($bounds.StartRaw)) -Message "$fileName $($video.Path) YouTube video must define start/t; otherwise the full video can be shown. URL: $url"
        Assert-True -Condition (-not [string]::IsNullOrWhiteSpace($bounds.EndRaw)) -Message "$fileName $($video.Path) YouTube video must define end; otherwise playback can continue to the full video. URL: $url"
        Assert-True -Condition ($bounds.Start -ge 0) -Message "$fileName $($video.Path) YouTube segment start must be >= 0. URL: $url"
        Assert-True -Condition ($bounds.End -gt $bounds.Start) -Message "$fileName $($video.Path) YouTube segment end must be greater than start. URL: $url"
    }
}

Write-TestStep 'Every configured YouTube video material has transcript coverage for its time segment'
$apiSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\src\lib\api.ts') -Raw
foreach ($fileName in @('content.json', 'content.template.json')) {
    $content = Get-Content -LiteralPath (Join-Path $webRoot "data\$fileName") -Raw | ConvertFrom-Json
    foreach ($video in (Find-VideoMaterials -Node $content -Path $fileName)) {
        $material = $video.Material
        $url = [string](Get-Prop -Value $material -Name 'url' -Default '')
        if ([string]::IsNullOrWhiteSpace($url) -or -not (Test-YouTubeUrl -Url $url)) { continue }

        $bounds = Get-VideoSegmentBounds -Material $material
        $context = "$fileName $($video.Path) URL: $url"
        $plainTranscript = Get-PlainTranscript -Material $material
        $segments = @(Get-TranscriptSegments -Material $material)

        if ($segments.Count -gt 0) {
            Test-TranscriptSegmentsCoverBounds -Material $material -SegmentStart $bounds.Start -SegmentEnd $bounds.End -Context $context
        } elseif (-not [string]::IsNullOrWhiteSpace($plainTranscript)) {
            Assert-True -Condition ($plainTranscript.Length -ge 20) -Message "$context plain transcript must contain meaningful text."
        } else {
            Assert-Match -Actual $sectionSource -Pattern 'apiClient\.getVideoTranscript\(mediaUrl\)'
            Assert-Match -Actual $apiSource -Pattern '/api/media/youtube-transcript-segment\?url='
            Invoke-YouTubeTranscriptLiveCheck -Url $url -ExpectedStart $bounds.Start -ExpectedEnd $bounds.End -Context $context
        }
    }
}

Write-TestStep 'API upload route supports byte ranges for browser video playback'
$routesSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\routes\registerRoutes.ts') -Raw
foreach ($pattern in @(
    'createReadStream',
    'parseRangeHeader',
    'request\.headers\.range',
    '\.code\(206\)',
    'Accept-Ranges',
    'Content-Range',
    'Content-Length',
    'createReadStream\(absolutePath, \{ start: range\.start, end: range\.end \}\)'
)) { Assert-Match -Actual $routesSource -Pattern $pattern }

Write-TestStep 'Segmented YouTube transcript route mirrors youtube-transcript segment semantics'
$segmentTranscriptSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\routes\registerVideoTranscriptSegmentRoutes.ts') -Raw
foreach ($pattern in @(
    '/api/media/youtube-transcript-segment',
    'parsed\.searchParams\.get\(''end''\)',
    "const transcriptLanguages = \['ru', 'ru-RU', 'en', 'en-US', 'en-GB'\]",
    'pickTranscriptSegmentText\(segments: TranscriptSegment\[\], start: number, end: number\)',
    'segments\.filter\(\(item\) => item\.start >= segmentStart && item\.start < segmentEnd\)',
    'Transcript for the selected YouTube segment was not found'
)) { Assert-Match -Actual $segmentTranscriptSource -Pattern $pattern }
Assert-True -Condition ($segmentTranscriptSource -cnotmatch 'pickTranscriptSegmentText\(segments, info\.start\)') -Message 'Transcript selection must pass both start and end; start-only selection hides end-boundary bugs.'

Write-TestStep 'API registers the segmented YouTube transcript route'
$apiIndexSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\index.ts') -Raw
foreach ($pattern in @('registerVideoTranscriptSegmentRoutes', 'await registerVideoTranscriptSegmentRoutes\(app\)')) { Assert-Match -Actual $apiIndexSource -Pattern $pattern }

Write-TestStep 'Admin exposes editable video transcript metadata'
$adminSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\app\admin.tsx') -Raw
foreach ($pattern in @("material\.type === 'video'", 'fieldLabels\.transcript', "readMaterialMetaString\(material, 'transcript'\)", 'meta\.transcript = value')) { Assert-Match -Actual $adminSource -Pattern $pattern }

foreach ($fileName in @('content.json', 'content.template.json')) {
    $content = Get-Content -LiteralPath (Join-Path $webRoot "data\$fileName") -Raw | ConvertFrom-Json
    Assert-Equal -Expected 'Transcript' -Actual ([string]$content.meta.ui.admin.fieldLabels.transcript) -Message "$fileName should expose the video transcript field label."
}

Write-Host 'Platform media tests passed.'
