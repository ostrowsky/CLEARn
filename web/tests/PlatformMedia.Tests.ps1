Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$platformRoot = Join-Path $workspaceRoot 'platform'
$webRoot = Join-Path $workspaceRoot 'web'
. (Join-Path $PSScriptRoot 'Assertions.ps1')

function Convert-ToSeconds {
    param([string]$Value)

    $clean = ([string]$Value).Trim().ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($clean)) {
        return 0
    }

    if ($clean -match '^\d+:\d{1,2}(:\d{1,2})?$') {
        $parts = $clean.Split(':') | ForEach-Object { [int]$_ }
        $total = 0
        foreach ($part in $parts) {
            $total = ($total * 60) + $part
        }
        return $total
    }

    $hours = 0
    $minutes = 0
    $seconds = 0
    if ($clean -match '(\d+)h') { $hours = [int]$Matches[1] }
    if ($clean -match '(\d+)m') { $minutes = [int]$Matches[1] }
    if ($clean -match '(\d+)s?') { $seconds = [int]$Matches[1] }

    if (($hours + $minutes + $seconds) -gt 0) {
        return ($hours * 3600) + ($minutes * 60) + $seconds
    }

    $numeric = 0
    if ([int]::TryParse($clean, [ref]$numeric)) {
        return $numeric
    }

    return 0
}

function Get-QueryParam {
    param(
        [string]$Url,
        [string]$Name
    )

    try {
        $uri = [System.Uri]::new($Url)
        $query = [System.Web.HttpUtility]::ParseQueryString($uri.Query)
        return [string]$query[$Name]
    } catch {
        return ''
    }
}

function Get-MetaValue {
    param(
        [object]$Material,
        [string[]]$Names
    )

    if ($null -eq $Material.meta) {
        return ''
    }

    foreach ($name in $Names) {
        if ($Material.meta.PSObject.Properties.Name -contains $name) {
            return [string]$Material.meta.$name
        }
    }

    return ''
}

function Find-VideoMaterials {
    param(
        [object]$Node,
        [string]$Path = '$'
    )

    $results = New-Object System.Collections.Generic.List[object]
    if ($null -eq $Node) {
        return $results
    }

    if ($Node -is [System.Collections.IEnumerable] -and $Node -isnot [string]) {
        $index = 0
        foreach ($item in $Node) {
            foreach ($result in (Find-VideoMaterials -Node $item -Path "$Path[$index]")) {
                $results.Add($result)
            }
            $index += 1
        }
        return $results
    }

    if ($Node -is [pscustomobject]) {
        $propertyNames = $Node.PSObject.Properties.Name
        if (($propertyNames -contains 'type') -and (($Node.type -as [string]) -eq 'video')) {
            $results.Add([pscustomobject]@{
                Path = $Path
                Material = $Node
            })
        }

        foreach ($property in $Node.PSObject.Properties) {
            foreach ($result in (Find-VideoMaterials -Node $property.Value -Path "$Path.$($property.Name)")) {
                $results.Add($result)
            }
        }
    }

    return $results
}

function Test-YouTubeUrl {
    param([string]$Url)
    return $Url -match 'youtu\.be/' -or $Url -match 'youtube\.com/(watch|embed|shorts|live)'
}

function Test-UploadedMediaUrl {
    param([string]$Url)
    return $Url -match '^/uploads/' -or $Url -match '/uploads/'
}

Write-TestStep 'Learner video materials render inline for uploaded files and streaming URLs'
$sectionSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\app\section\[id].tsx') -Raw
foreach ($pattern in @(
    'getYouTubeVideoInfo',
    "shorts'",
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
    'Platform\.OS !== ''web'' \? <MaterialOpenButton url=\{mediaUrl\}',
    'transcriptBox',
    'maxHeight: 220',
    'ScrollView',
    'transcriptText'
)) {
    Assert-Match -Actual $sectionSource -Pattern $pattern
}
Assert-Match -Actual $sectionSource -Pattern "\{Platform\.OS !== 'web' \? <MaterialOpenButton url=\{mediaUrl\} label=\{options\.openMediaLabel\} /> : null\}"

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
)) {
    Assert-Match -Actual $sectionSource -Pattern $pattern
}

Write-TestStep 'Every configured video material is clipped to a finite segment'
foreach ($fileName in @('content.json', 'content.template.json')) {
    $contentPath = Join-Path $webRoot "data\$fileName"
    $content = Get-Content -LiteralPath $contentPath -Raw | ConvertFrom-Json
    $videos = Find-VideoMaterials -Node $content -Path $fileName

    foreach ($video in $videos) {
        $material = $video.Material
        $url = [string]$material.url
        if ([string]::IsNullOrWhiteSpace($url)) {
            continue
        }

        if (Test-YouTubeUrl -Url $url) {
            $startRaw = Get-QueryParam -Url $url -Name 'start'
            if ([string]::IsNullOrWhiteSpace($startRaw)) {
                $startRaw = Get-QueryParam -Url $url -Name 't'
            }
            $endRaw = Get-QueryParam -Url $url -Name 'end'
            Assert-True -Condition (-not [string]::IsNullOrWhiteSpace($startRaw)) -Message "$fileName $($video.Path) YouTube video must define start/t; otherwise the full video can be shown. URL: $url"
            Assert-True -Condition (-not [string]::IsNullOrWhiteSpace($endRaw)) -Message "$fileName $($video.Path) YouTube video must define end; otherwise playback can continue to the full video. URL: $url"

            $segmentStart = Convert-ToSeconds $startRaw
            $segmentEnd = Convert-ToSeconds $endRaw
            $segmentDuration = $segmentEnd - $segmentStart
            Assert-True -Condition ($segmentStart -ge 0) -Message "$fileName $($video.Path) YouTube segment start must be >= 0. URL: $url"
            Assert-True -Condition ($segmentEnd -gt $segmentStart) -Message "$fileName $($video.Path) YouTube segment end must be greater than start. URL: $url"
            Assert-True -Condition ($segmentDuration -gt 0) -Message "$fileName $($video.Path) YouTube segment duration must be positive. URL: $url"
        } elseif (Test-UploadedMediaUrl -Url $url) {
            $relativePath = ($url -replace '^https?://[^/]+', '') -replace '^/', ''
            $relativePath = ($relativePath -split '[?#]')[0]
            $assetPath = Join-Path $webRoot "static\$relativePath"
            Assert-True -Condition (Test-Path -LiteralPath $assetPath) -Message "$fileName $($video.Path) uploaded video file must exist: $relativePath"

            $fragmentStart = ''
            $fragmentEnd = ''
            if ($url -match '#t=([^,]+),([^&]+)$') {
                $fragmentStart = $Matches[1]
                $fragmentEnd = $Matches[2]
            }

            $metaStart = Get-MetaValue -Material $material -Names @('segmentStart', 'start', 'clipStart')
            $metaEnd = Get-MetaValue -Material $material -Names @('segmentEnd', 'end', 'clipEnd')
            $startRaw = if (-not [string]::IsNullOrWhiteSpace($fragmentStart)) { $fragmentStart } else { $metaStart }
            $endRaw = if (-not [string]::IsNullOrWhiteSpace($fragmentEnd)) { $fragmentEnd } else { $metaEnd }

            Assert-True -Condition (-not [string]::IsNullOrWhiteSpace($startRaw)) -Message "$fileName $($video.Path) uploaded video must define segment start via #t=start,end or material.meta.segmentStart/start/clipStart. Full uploaded videos must not pass. URL: $url"
            Assert-True -Condition (-not [string]::IsNullOrWhiteSpace($endRaw)) -Message "$fileName $($video.Path) uploaded video must define segment end via #t=start,end or material.meta.segmentEnd/end/clipEnd. Full uploaded videos must not pass. URL: $url"

            $segmentStart = Convert-ToSeconds $startRaw
            $segmentEnd = Convert-ToSeconds $endRaw
            Assert-True -Condition (($segmentEnd - $segmentStart) -gt 0) -Message "$fileName $($video.Path) uploaded video segment duration must be positive and shorter than the unconstrained full video playback. URL: $url"
        }
    }
}

Write-TestStep 'API upload route supports byte ranges for browser video playback'
$routesSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\routes\registerRoutes.ts') -Raw
foreach ($pattern in @(
    'createReadStream',
    'parseRangeHeader',
    '/api/media/video-transcript',
    'fetchYouTubeTranscript',
    'fetchTimedTextTranscript',
    'fetchInnertubePlayerResponse',
    'youtubei/v1/player',
    'ytInitialPlayerResponse',
    'captionTracks',
    'transcriptUrl\.searchParams\.set\(''fmt'', ''json3''\)',
    'unavailableYouTubeTranscript',
    'material Transcript field in admin',
    'request\.headers\.range',
    '\.code\(206\)',
    'Accept-Ranges',
    'Content-Range',
    'Content-Length',
    'createReadStream\(absolutePath, \{ start: range\.start, end: range\.end \}\)'
)) {
    Assert-Match -Actual $routesSource -Pattern $pattern
}

Write-TestStep 'Segmented YouTube transcript route mirrors youtube-transcript segment semantics'
$segmentTranscriptSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\routes\registerVideoTranscriptSegmentRoutes.ts') -Raw
foreach ($pattern in @(
    '/api/media/youtube-transcript-segment',
    'parsed\.searchParams\.get\(''end''\)',
    "const transcriptLanguages = \['ru', 'ru-RU', 'en', 'en-US', 'en-GB'\]",
    'type TranscriptSegment = \{',
    'start: number',
    'pickTranscriptSegmentText\(segments: TranscriptSegment\[\], start: number, end: number\)',
    'const segmentStart = Math\.max\(0, start \|\| 0\)',
    'const segmentEnd = end > segmentStart \? end : segmentStart \+ 45',
    'segments\.filter\(\(item\) => item\.start >= segmentStart && item\.start < segmentEnd\)',
    'selected\.map\(\(item\) => item\.text\)\.join\('' ''\)',
    'Transcript for the selected YouTube segment was not found'
)) {
    Assert-Match -Actual $segmentTranscriptSource -Pattern $pattern
}
Assert-True -Condition ($segmentTranscriptSource -cnotmatch 'pickTranscriptSegmentText\(segments, info\.start\)') -Message 'Transcript selection must pass both start and end; start-only selection hides end-boundary bugs.'
Assert-True -Condition ($segmentTranscriptSource -cnotmatch "for \(const language of \['en', 'en-US', 'en-GB'\]\)") -Message 'Transcript lookup must try Russian before English, matching the admin-provided YouTube transcript workflow.'

Write-TestStep 'API registers the segmented YouTube transcript route'
$apiIndexSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\index.ts') -Raw
foreach ($pattern in @(
    'registerVideoTranscriptSegmentRoutes',
    'await registerVideoTranscriptSegmentRoutes\(app\)'
)) {
    Assert-Match -Actual $apiIndexSource -Pattern $pattern
}

Write-TestStep 'Admin exposes editable video transcript metadata'
$adminSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\app\admin.tsx') -Raw
foreach ($pattern in @(
    "material\.type === 'video'",
    'fieldLabels\.transcript',
    "readMaterialMetaString\(material, 'transcript'\)",
    'meta\.transcript = value'
)) {
    Assert-Match -Actual $adminSource -Pattern $pattern
}

foreach ($fileName in @('content.json', 'content.template.json')) {
    $content = Get-Content -LiteralPath (Join-Path $webRoot "data\$fileName") -Raw | ConvertFrom-Json
    Assert-Equal -Expected 'Transcript' -Actual ([string]$content.meta.ui.admin.fieldLabels.transcript) -Message "$fileName should expose the video transcript field label."
}

Write-Host 'Platform media tests passed.'
