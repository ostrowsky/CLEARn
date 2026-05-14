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
    'page\.content\(\)',
    'Before you continue to YouTube',
    'page\.setCookie',
    'fetchInnerTubeCaptionTracks',
    'const innerTubeTracks = await fetchInnerTubeCaptionTracks\(apiKey\)',
    'const tracks = innerTubeTracks\.length \? innerTubeTracks : windowTracks\.length \? windowTracks : htmlTracks',
    'fetchTimedTextSegments',
    'method: ''fetch''',
    'htmlHasPlayerResponse',
    'browserless-timedtext',
    'TRANSCRIPT_FETCH_PROVIDER',
    'BROWSERLESS_API_KEY',
    'BROWSERLESS_USE_RESIDENTIAL_PROXY',
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
Assert-True -Condition ($transcriptRouteSource -cnotmatch 'page\.goto\(candidate\.url') -Message 'Browserless caption downloads must not navigate the page to caption URLs because that path times out on hosted production.'
Assert-Match -Actual $transcriptRouteSource -Pattern 'if \(!includeDebug && result\.available\) cache\.set\(url, result\)'
Assert-True -Condition ($transcriptRouteSource -cnotmatch 'if \(!includeDebug\) cache\.set\(url, result\)') -Message 'YouTube transcript route must not cache failed transcript lookups because Browserless/YouTube availability can recover after provider fixes or retries.'

$apiEnvSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\config\env.ts') -Raw
Assert-Match -Actual $apiEnvSource -Pattern 'BROWSERLESS_USE_RESIDENTIAL_PROXY: z\.coerce\.boolean\(\)\.default\(true\)'

$renderBlueprintSource = Get-Content -LiteralPath (Join-Path $workspaceRoot 'render.yaml') -Raw
foreach ($pattern in @(
    'TRANSCRIPT_FETCH_PROVIDER',
    'value: browserless',
    'BROWSERLESS_API_URL',
    'production-sfo\.browserless\.io',
    'BROWSERLESS_API_KEY',
    'sync: false',
    'BROWSERLESS_USE_RESIDENTIAL_PROXY',
    'value: true',
    'BROWSERLESS_PROXY_COUNTRY',
    'value: us'
)) {
    Assert-Match -Actual $renderBlueprintSource -Pattern $pattern
}

Write-Host 'Platform YouTube segment tests passed.'
