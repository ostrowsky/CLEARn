Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$platformRoot = Join-Path $workspaceRoot 'platform'
. (Join-Path $PSScriptRoot 'Assertions.ps1')

Write-TestStep 'YouTube embeds keep both segment boundaries and force-stop playback at end'
$sectionSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\app\section\[id].tsx') -Raw
foreach ($pattern in @(
    'function getYouTubeVideoInfo',
    'parsed\.searchParams\.get\(''start''\)',
    'parsed\.searchParams\.get\(''t''\)',
    'parsed\.searchParams\.get\(''end''\)',
    "params\.set\('start', String\(youTubeInfo\.start\)\)",
    "params\.set\('end', String\(youTubeInfo\.end\)\)",
    "params\.set\('enablejsapi', '1'\)",
    "params\.set\('origin'",
    'WebVideoEmbed',
    'useRef',
    'postMessage',
    'getCurrentTime',
    'pauseVideo|stopVideo',
    'currentTime >= youtubeSegmentEnd',
    'youtubeSegmentEnd'
)) {
    Assert-Match -Actual $sectionSource -Pattern $pattern
}

Write-TestStep 'Client requests transcript for the exact YouTube segment endpoint'
$clientApiSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\src\lib\api.ts') -Raw
foreach ($pattern in @(
    'getVideoTranscript\(url: string\)',
    '/api/media/youtube-transcript-segment\?url=',
    'encodeURIComponent\(url\)'
)) {
    Assert-Match -Actual $clientApiSource -Pattern $pattern
}

Write-TestStep 'Backend registers the segmented YouTube transcript route'
$apiIndexSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\index.ts') -Raw
$mediaBackupRoutesSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\routes\registerMediaBackupRoutes.ts') -Raw
Assert-True -Condition (($apiIndexSource -match 'registerVideoTranscriptSegmentRoutes') -or ($mediaBackupRoutesSource -match 'registerVideoTranscriptSegmentRoutes')) -Message 'The segmented YouTube transcript route must be registered in the Fastify app.'

Write-TestStep 'Backend implements YouTube transcript API calls in TypeScript and filters [start,end)'
$transcriptRoutePath = Join-Path $platformRoot 'apps\api\src\routes\registerVideoTranscriptSegmentRoutes.ts'
Assert-True -Condition (Test-Path -LiteralPath $transcriptRoutePath) -Message 'registerVideoTranscriptSegmentRoutes.ts must exist.'
$transcriptRouteSource = Get-Content -LiteralPath $transcriptRoutePath -Raw
foreach ($pattern in @(
    '/api/media/youtube-transcript-segment',
    'function getYouTubeVideoInfo',
    'parseSeconds',
    'transcriptLanguages = \[''ru'', ''ru-RU'', ''en'', ''en-US'', ''en-GB''\]',
    'fetchTimedTextTranscript',
    'https://www\.youtube\.com/api/timedtext',
    "transcriptUrl\.searchParams\.set\('v', videoId\)",
    "transcriptUrl\.searchParams\.set\('lang', language\)",
    "transcriptUrl\.searchParams\.set\('fmt', 'json3'\)",
    'youtubei/v1/player',
    'captionTracks',
    'type TranscriptFetcher',
    'fetchBrowserlessTranscriptSegment',
    'getBrowserlessFunctionCode',
    'TRANSCRIPT_FETCH_PROVIDER',
    'BROWSERLESS_API_KEY',
    'fetchTranscriptSegments',
    'fetchTranscriptWithProviders',
    'pickTranscriptSegmentText',
    'segments\.filter',
    'item\.start >= segmentStart && item\.start < segmentEnd',
    'selected\.map\(\(item\) => item\.text\)\.join'
)) {
    Assert-Match -Actual $transcriptRouteSource -Pattern $pattern
}

Assert-True -Condition ($transcriptRouteSource -cnotmatch 'EXPO_PUBLIC.*BROWSERLESS') -Message 'Browserless credentials must never be exposed through frontend public variables.'

Write-Host 'Platform YouTube segment tests passed.'
