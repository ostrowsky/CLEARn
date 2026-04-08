param([int]$Port = 8080,[switch]$OpenBrowser)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'app\Services.ps1')
. (Join-Path $PSScriptRoot 'app\ContentStore.ps1')
$script:ProjectRoot = $PSScriptRoot
$script:SoftSkillsSessions = @{}
$script:StatusTexts = @{200='OK';400='Bad Request';404='Not Found';405='Method Not Allowed';500='Internal Server Error'}
function Read-AsciiLine {
param([System.IO.Stream]$Stream)
$bytes = New-Object System.Collections.Generic.List[byte]
while ($true) {
$value = $Stream.ReadByte()
if ($value -lt 0) {
if ($bytes.Count -eq 0) { return $null }
break
}
if ($value -eq 10) { break }
if ($value -ne 13) { [void]$bytes.Add([byte]$value) }
}
return [System.Text.Encoding]::ASCII.GetString($bytes.ToArray())
}
function Read-ExactBytes {
param([System.IO.Stream]$Stream,[int]$Length)
$buffer = New-Object byte[] $Length
$offset = 0
while ($offset -lt $Length) {
$readCount = $Stream.Read($buffer, $offset, $Length - $offset)
if ($readCount -le 0) { throw 'Client disconnected before the full request body was received.' }
$offset += $readCount
}
return $buffer
}
function Read-ChunkedBytes {
param([System.IO.Stream]$Stream)
$memory = New-Object System.IO.MemoryStream
while ($true) {
$chunkSizeLine = Read-AsciiLine -Stream $Stream
if ($null -eq $chunkSizeLine) { throw 'Chunked request ended before the chunk size was received.' }
$chunkSizeToken = (($chunkSizeLine -split ';')[0]).Trim()
$chunkSize = [Convert]::ToInt32($chunkSizeToken, 16)
if ($chunkSize -eq 0) {
while ($true) {
$trailerLine = Read-AsciiLine -Stream $Stream
if ([string]::IsNullOrEmpty($trailerLine)) { break }
}
break
}
$chunkBytes = Read-ExactBytes -Stream $Stream -Length $chunkSize
$memory.Write($chunkBytes, 0, $chunkBytes.Length)
$chunkTerminator = Read-ExactBytes -Stream $Stream -Length 2
if ($chunkTerminator[0] -ne 13 -or $chunkTerminator[1] -ne 10) { throw 'Chunked request body was missing the CRLF terminator.' }
}
return $memory.ToArray()
}
function Read-TcpHttpRequest {
param([System.Net.Sockets.TcpClient]$Client)
$stream = $Client.GetStream()
$requestLine = Read-AsciiLine -Stream $stream
if ([string]::IsNullOrWhiteSpace($requestLine)) { return $null }
$parts = $requestLine.Split(' ')
$headers = @{}
while ($true) {
$line = Read-AsciiLine -Stream $stream
if ($null -eq $line -or $line -eq '') { break }
$separatorIndex = $line.IndexOf(':')
if ($separatorIndex -gt 0) { $headers[$line.Substring(0, $separatorIndex).Trim().ToLowerInvariant()] = $line.Substring($separatorIndex + 1).Trim() }
}
$bodyBytes = [byte[]]@()
$contentLength = 0
if ($headers.ContainsKey('transfer-encoding') -and $headers['transfer-encoding'].ToLowerInvariant().Contains('chunked')) {
$bodyBytes = Read-ChunkedBytes -Stream $stream
} elseif ($headers.ContainsKey('content-length') -and [int]::TryParse($headers['content-length'], [ref]$contentLength) -and $contentLength -gt 0) {
$bodyBytes = Read-ExactBytes -Stream $stream -Length $contentLength
}
$body = if ($bodyBytes.Length -gt 0) { [System.Text.Encoding]::UTF8.GetString($bodyBytes) } else { '' }
@{ Method = $parts[0].ToUpperInvariant(); RawUrl = $parts[1]; Path = (($parts[1] -split '\?')[0]); Headers = $headers; Body = $body }
}
function ConvertFrom-JsonBody {
param([string]$Body)
if ([string]::IsNullOrWhiteSpace($Body)) { return $null }
if ($Body[0] -eq [char]0xFEFF) { $Body = $Body.Substring(1) }
try { $Body | ConvertFrom-Json } catch { throw 'Invalid JSON body.' }
}

function Get-RequestPropertyValue { param($Body,[string]$Name,$Default=$null) if ($null -eq $Body) { return $Default }; $property = $Body.PSObject.Properties[$Name]; if ($property) { $property.Value } else { $Default } }
function New-JsonResponse { param($Payload,[int]$StatusCode=200) if ($null -eq $Payload) { $json = 'null' } else { $json = $Payload | ConvertTo-Json -Depth 30 }; if ($null -eq $json) { $json = 'null' }; @{ StatusCode = $StatusCode; ContentType = 'application/json; charset=utf-8'; BodyBytes = [System.Text.Encoding]::UTF8.GetBytes([string]$json) } }
function Get-ContentType {
param([string]$Extension)
switch ($Extension.ToLowerInvariant()) {
'.html' { 'text/html; charset=utf-8' }
'.css' { 'text/css; charset=utf-8' }
'.js' { 'application/javascript; charset=utf-8' }
'.json' { 'application/json; charset=utf-8' }
'.svg' { 'image/svg+xml' }
'.png' { 'image/png' }
'.jpg' { 'image/jpeg' }
'.jpeg' { 'image/jpeg' }
'.gif' { 'image/gif' }
'.webp' { 'image/webp' }
'.mp4' { 'video/mp4' }
'.webm' { 'video/webm' }
'.mp3' { 'audio/mpeg' }
'.wav' { 'audio/wav' }
'.ogg' { 'audio/ogg' }
'.oga' { 'audio/ogg' }
'.m4a' { 'audio/mp4' }
'.aac' { 'audio/aac' }
'.flac' { 'audio/flac' }
'.opus' { 'audio/opus' }
default { 'application/octet-stream' }
}
}
function New-FileResponse { param([string]$FilePath) if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) { return (New-JsonResponse -Payload @{ error = 'File not found.' } -StatusCode 404) }; @{ StatusCode = 200; ContentType = Get-ContentType -Extension ([System.IO.Path]::GetExtension($FilePath)); BodyBytes = [System.IO.File]::ReadAllBytes($FilePath) } }
function Resolve-StaticPath {
param([string]$StaticRoot,[string]$RequestPath)
$cleanPath = $RequestPath.TrimStart('/')
if ([string]::IsNullOrWhiteSpace($cleanPath)) { $cleanPath = 'index.html' }
$candidate = [System.IO.Path]::GetFullPath((Join-Path $StaticRoot $cleanPath))
$staticRootFull = [System.IO.Path]::GetFullPath($StaticRoot)
if (-not $candidate.StartsWith($staticRootFull, [System.StringComparison]::OrdinalIgnoreCase)) { return $null }
if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
return $null
}
function Handle-ApiRequest {
param([hashtable]$Request)
$path = $Request.Path
$method = $Request.Method
try { $body = ConvertFrom-JsonBody -Body $Request.Body } catch { return (New-JsonResponse -Payload @{ error = $_.Exception.Message } -StatusCode 400) }
if ($method -eq 'GET' -and $path -eq '/api/health') {
$content = Get-AppContent -ProjectRoot $script:ProjectRoot
return (New-JsonResponse -Payload @{ status = 'ok'; generatorMode = Get-GeneratorMode; model = $env:SOFTSKILLS_LLM_MODEL; contentUpdatedAt = $content.meta.updatedAt })
}
switch ($path) {
'/api/content' { if ($method -ne 'GET') { return (New-JsonResponse -Payload @{ error = 'Method not allowed.' } -StatusCode 405) }; return (New-JsonResponse -Payload (Get-AppContent -ProjectRoot $script:ProjectRoot)) }
'/api/admin/content' {
if ($method -eq 'GET') { return (New-JsonResponse -Payload (Get-AppContent -ProjectRoot $script:ProjectRoot)) }
if ($method -notin @('POST','PUT')) { return (New-JsonResponse -Payload @{ error = 'Method not allowed.' } -StatusCode 405) }
$payload = Get-RequestPropertyValue -Body $body -Name 'content' -Default $body
try { return (New-JsonResponse -Payload (Save-AppContent -ProjectRoot $script:ProjectRoot -ContentObject $payload)) } catch { return (New-JsonResponse -Payload @{ error = $_.Exception.Message } -StatusCode 400) }
}
'/api/admin/media/upload' {
if ($method -ne 'POST') { return (New-JsonResponse -Payload @{ error = 'Method not allowed.' } -StatusCode 405) }
try { return (New-JsonResponse -Payload (Save-UploadedMedia -ProjectRoot $script:ProjectRoot -FileName ([string](Get-RequestPropertyValue -Body $body -Name 'fileName' -Default '')) -Base64Data ([string](Get-RequestPropertyValue -Body $body -Name 'base64' -Default '')))) } catch { return (New-JsonResponse -Payload @{ error = $_.Exception.Message } -StatusCode 400) }
}
'/api/admin/media/delete' {
if ($method -ne 'POST') { return (New-JsonResponse -Payload @{ error = 'Method not allowed.' } -StatusCode 405) }
try { return (New-JsonResponse -Payload (Remove-UploadedMedia -ProjectRoot $script:ProjectRoot -Url ([string](Get-RequestPropertyValue -Body $body -Name 'url' -Default '')))) } catch { return (New-JsonResponse -Payload @{ error = $_.Exception.Message } -StatusCode 400) }
}
'/api/asking/clarify' { if ($method -ne 'POST') { break }; return (New-JsonResponse -Payload (Get-ClarifyExercise -Context ([string](Get-RequestPropertyValue -Body $body -Name 'context' -Default '')) -Offset ([int](Get-RequestPropertyValue -Body $body -Name 'offset' -Default 0)))) }
'/api/asking/clarify/check' { if ($method -ne 'POST') { break }; return (New-JsonResponse -Payload (Test-ClarifyingQuestion -UserQuestion ([string](Get-RequestPropertyValue -Body $body -Name 'userQuestion' -Default '')) -ExpectedQuestion ([string](Get-RequestPropertyValue -Body $body -Name 'expectedQuestion' -Default '')) -Target ([string](Get-RequestPropertyValue -Body $body -Name 'target' -Default '')) -Focus ([string](Get-RequestPropertyValue -Body $body -Name 'focus' -Default '')))) }
'/api/asking/without-context' { if ($method -ne 'POST') { break }; return (New-JsonResponse -Payload (Get-AskWithoutContextExercise -Offset ([int](Get-RequestPropertyValue -Body $body -Name 'offset' -Default 0)))) }
'/api/asking/after-talk' { if ($method -ne 'POST') { break }; return (New-JsonResponse -Payload (Get-AskAfterTalkBrief -Context ([string](Get-RequestPropertyValue -Body $body -Name 'context' -Default '')) -Offset ([int](Get-RequestPropertyValue -Body $body -Name 'offset' -Default 0)))) }
'/api/asking/after-talk/check' { if ($method -ne 'POST') { break }; return (New-JsonResponse -Payload (Test-AskAfterQuestion -Question ([string](Get-RequestPropertyValue -Body $body -Name 'question' -Default '')))) }
'/api/answering/session/start' { if ($method -ne 'POST') { break }; $session = New-AnsweringSession -Context ([string](Get-RequestPropertyValue -Body $body -Name 'context' -Default '')) -Mode ([string](Get-RequestPropertyValue -Body $body -Name 'mode' -Default 'good')); $script:SoftSkillsSessions[$session.sessionId] = $session; return (New-JsonResponse -Payload $session) }
'/api/answering/session/respond' { if ($method -ne 'POST') { break }; return (New-JsonResponse -Payload (Submit-AnsweringReply -SessionStore $script:SoftSkillsSessions -SessionId ([string](Get-RequestPropertyValue -Body $body -Name 'sessionId' -Default '')) -UserReply ([string](Get-RequestPropertyValue -Body $body -Name 'userReply' -Default '')))) }
default { return (New-JsonResponse -Payload @{ error = 'Unknown API route.' } -StatusCode 404) }
}
}
function Get-WebResponse { param([hashtable]$Request,[string]$StaticRoot) if ($Request.Path.StartsWith('/api/')) { return (Handle-ApiRequest -Request $Request) }; if ($Request.Path -in @('/admin','/admin/')) { return (New-FileResponse -FilePath (Join-Path $StaticRoot 'admin.html')) }; $resolvedPath = Resolve-StaticPath -StaticRoot $StaticRoot -RequestPath $Request.Path; if ($resolvedPath) { return (New-FileResponse -FilePath $resolvedPath) }; return (New-FileResponse -FilePath (Join-Path $StaticRoot 'index.html')) }
function Send-TcpResponse {
param([System.Net.Sockets.TcpClient]$Client,[hashtable]$Response)
$stream = $Client.GetStream()
$statusText = $script:StatusTexts[$Response.StatusCode]
if (-not $statusText) { $statusText = 'OK' }
$headers = @("HTTP/1.1 $($Response.StatusCode) $statusText","Content-Type: $($Response.ContentType)","Content-Length: $($Response.BodyBytes.Length)",'Connection: close')
$headerBytes = [System.Text.Encoding]::ASCII.GetBytes(($headers -join "`r`n") + "`r`n`r`n")
$stream.Write($headerBytes, 0, $headerBytes.Length)
if ($Response.BodyBytes.Length -gt 0) { $stream.Write($Response.BodyBytes, 0, $Response.BodyBytes.Length) }
$stream.Flush()
}
function Handle-TcpClient {
param([System.Net.Sockets.TcpClient]$Client,[string]$StaticRoot)
try {
$request = Read-TcpHttpRequest -Client $Client
if ($null -eq $request) { return }
$response = Get-WebResponse -Request $request -StaticRoot $StaticRoot
Send-TcpResponse -Client $Client -Response $response
} catch {
$errorResponse = New-JsonResponse -Payload @{ error = $_.Exception.Message } -StatusCode 500
try { Send-TcpResponse -Client $Client -Response $errorResponse } catch { }
} finally { $Client.Close() }
}
function Start-SoftSkillsServer {
param([string]$ProjectRoot,[int]$Port = 8080)
$staticRoot = Join-Path $ProjectRoot 'static'
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
Write-Host "SOFTskills web server is running on http://localhost:$Port/"
try {
while ($true) {
$client = $listener.AcceptTcpClient()
Handle-TcpClient -Client $client -StaticRoot $staticRoot
}
} finally { $listener.Stop() }
}
Ensure-ContentStore -ProjectRoot $script:ProjectRoot
if ($OpenBrowser) { Start-Job -ScriptBlock { param($Value) Start-Sleep -Milliseconds 600; explorer.exe $Value } -ArgumentList "http://localhost:$Port/" | Out-Null }
Start-SoftSkillsServer -ProjectRoot $PSScriptRoot -Port $Port






