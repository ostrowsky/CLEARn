Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$platformRoot = Join-Path $workspaceRoot 'platform'
$webRoot = Join-Path $workspaceRoot 'web'
. (Join-Path $PSScriptRoot 'Assertions.ps1')

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
