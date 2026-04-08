Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$platformRoot = Join-Path $workspaceRoot 'platform'
. (Join-Path $PSScriptRoot 'Assertions.ps1')

Write-TestStep 'Hugging Face speech provider strips data URLs, decodes audio bytes, normalizes content types, and preserves provider error details'
$hfSpeechSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\providers\speech\huggingfaceSpeech.ts') -Raw
foreach ($pattern in @(
    'function cleanBase64Audio',
    'function decodeAudioBytes',
    'function normalizeMimeType',
    "Buffer\.from\(cleanBase64Audio\(audioBase64\), 'base64'\)",
    "'Content-Type': normalizeMimeType\(input\.mimeType\)",
    'body: audioBytes',
    'Hugging Face STT error:',
    'readErrorDetails',
    'slice\(0, 240\)'
)) {
    Assert-Match -Actual $hfSpeechSource -Pattern $pattern
}
Assert-True -Condition ($hfSpeechSource -cnotmatch 'JSON\.stringify\(\{ inputs: cleanBase64Audio\(input.audioBase64\) \}\)') -Message 'HF speech provider should no longer send STT as JSON inputs for the live endpoint.'

Write-TestStep 'OpenAI speech provider derives upload file names from the incoming audio format'
$openAiSpeechSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\providers\speech\openaiSpeech.ts') -Raw
foreach ($pattern in @(
    'function getAudioUploadFileName',
    "case 'audio/mp4':",
    "return 'speech.m4a';",
    "case 'audio/flac':",
    "return 'speech.flac';",
    'getAudioUploadFileName\(input\.mimeType\)'
)) {
    Assert-Match -Actual $openAiSpeechSource -Pattern $pattern
}

Write-TestStep 'Speech routes expose debug logs and serve extended audio content types'
$routesSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\api\src\routes\registerRoutes.ts') -Raw
foreach ($pattern in @(
    '/api/debug/logs',
    '/api/debug/log',
    "pushDebugLog\('speech', 'stt:start'",
    "pushDebugLog\('speech', 'stt:success'",
    "pushDebugLog\('speech', 'stt:error'",
    "case '.oga':",
    "case '.m4a':",
    "case '.aac':",
    "case '.flac':",
    "case '.opus':"
)) {
    Assert-Match -Actual $routesSource -Pattern $pattern
}

Write-TestStep 'Client API emits debug logs and surfaces backend message details for STT failures'
$apiClientSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\src\lib\api.ts') -Raw
foreach ($pattern in @(
    'sendDebugLog',
    '/api/debug/log',
    'getDebugLogs\(',
    'json.message as string',
    'response.statusText'
)) {
    Assert-Match -Actual $apiClientSource -Pattern $pattern
}

Write-TestStep 'Content hook logs load lifecycle events'
$useContentSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\src\hooks\useContent.ts') -Raw
foreach ($pattern in @(
    "apiClient\.logDebug\('content', 'load:start'",
    "apiClient\.logDebug\('content', 'load:success'",
    "apiClient\.logDebug\('content', 'load:error'"
)) {
    Assert-Match -Actual $useContentSource -Pattern $pattern
}

Write-TestStep 'Clarify screen converts unsupported recorder formats to WAV before STT and keeps the 10 second recording cap'
$clarifyScreenSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\app\practice\asking\clarify.tsx') -Raw
foreach ($pattern in @(
    'const DIRECT_STT_MIME_TYPES = new Set',
    'const RECORDER_PREFERRED_MIME_TYPES = \[',
    "'audio/mp4'",
    'getAudioContextConstructor',
    'decodeAudioBuffer',
    'encodeAudioBufferToWav',
    'prepareSpeechPayloadForStt',
    "new Blob\(\[wavBuffer\], \{ type: 'audio/wav' \}\)",
    'mediaRecorderSttCompatible',
    'shouldPreferSpeechRecognition',
    "logAction\('recording:prefer-speech-recognition'",
    "logAction\('transcription:audio-converted'",
    'const mediaRecorderSupported = supportsBrowserRecording\(\);',
    'const recordingSupported = mediaRecorderSupported \|\| speechRecognitionSupported;',
    'new MediaRecorder\(mediaStream, \{ mimeType: preferredRecorderMimeType \}\)',
    'const speechPayload = await prepareSpeechPayloadForStt\(blob, mimeType\);',
    'MAX_RECORDING_MS = 10000',
    'scheduleRecordingStop',
    'clearRecordingTimer',
    'recognition\.continuous = true',
    'recording:auto-stop',
    "logAction\('recording:started'",
    "logAction\('transcription:success'",
    'apiClient\.speechToText',
    'blobToDataUrl',
    'transcribingExampleId'
)) {
    Assert-Match -Actual $clarifyScreenSource -Pattern $pattern
}
Assert-True -Condition ($clarifyScreenSource -cnotmatch 'const recordingSupported = speechRecognitionSupported \|\| supportsBrowserRecording\(\);') -Message 'Clarify screen should no longer prefer speech recognition ahead of MediaRecorder support.'
Assert-True -Condition ($clarifyScreenSource -cnotmatch "if \(mediaRecorderSupported\)") -Message 'Clarify screen should gate the MediaRecorder branch through the Safari compatibility check rather than a plain mediaRecorderSupported condition.'

Write-TestStep 'Shared speech draft hook centralizes STT recording and transcription flow'
$useSpeechDraftSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\src\hooks\useSpeechDraft.ts') -Raw
foreach ($pattern in @(
    'MAX_RECORDING_MS',
    'prepareSpeechPayloadForStt',
    'apiClient\.speechToText',
    'supportsBrowserRecording',
    'getSpeechRecognitionConstructor',
    'recognition\.continuous = true',
    'recording:auto-stop',
    'transcription:success'
)) {
    Assert-Match -Actual $useSpeechDraftSource -Pattern $pattern
}

Write-TestStep 'Learner section screen recognizes extended direct audio formats for playback'
$sectionScreenSource = Get-Content -LiteralPath (Join-Path $platformRoot 'apps\client\app\section\[id].tsx') -Raw
Assert-True -Condition ($sectionScreenSource.Contains('const directAudioPattern = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm)(?:[?#].*)?$/i;')) -Message 'Learner section screen should treat extended uploaded audio formats as direct audio assets.'

Write-Host 'Platform speech tests passed.'
