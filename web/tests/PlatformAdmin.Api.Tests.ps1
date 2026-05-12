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
        $Payload = $null,
        $Session = $null
    )

    $params = @{
        UseBasicParsing = $true
        Uri = $Uri
        Method = $Method
    }

    if ($null -ne $Payload) {
        $params.ContentType = 'application/json; charset=utf-8'
        $params.Body = ($Payload | ConvertTo-Json -Depth 20 -Compress)
    }
    if ($null -ne $Session) {
        $params.WebSession = $Session
    }

    $response = Invoke-WebRequest @params
    if ([string]::IsNullOrWhiteSpace($response.Content)) {
        return $null
    }

    return ($response.Content | ConvertFrom-Json)
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
}
if (-not $nodeCommand -and (Test-Path -LiteralPath 'C:\Program Files\nodejs\node.exe')) {
    $nodeCommand = [PSCustomObject]@{ Source = 'C:\Program Files\nodejs\node.exe' }
}
if (-not $nodeCommand) {
    Write-Host 'Platform admin API tests skipped: Node.js was not found in this environment.'
    return
}

$tsxCli = Join-Path $platformRoot 'node_modules\tsx\dist\cli.mjs'
if (-not (Test-Path -LiteralPath $tsxCli)) {
    Write-Host 'Platform admin API tests skipped: tsx CLI was not found. Run pnpm install in platform first.'
    return
}

$tempRoot = Join-Path $workspaceRoot ('tmp-platform-api-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
$tempContentPath = Join-Path $tempRoot 'content.json'
$tempAuthPath = Join-Path $tempRoot 'admin-auth.json'
Copy-Item -LiteralPath (Join-Path $webRoot 'data\content.json') -Destination $tempContentPath -Force
$seedContent = Get-Content -LiteralPath $tempContentPath -Raw | ConvertFrom-Json
$seedContent.meta.ui.admin.actions.PSObject.Properties.Remove('fetchTranscript')
$seedContent.meta.ui.admin.messages.PSObject.Properties.Remove('videoTranscriptFetched')
$seedVideoLibrary = (($seedContent.sections | Where-Object { $_.id -eq 'asking-after-talk' } | Select-Object -First 1).blocks | Where-Object { $_.id -eq 'block-ayctl2c6' } | Select-Object -First 1)
$seedVideo = @($seedVideoLibrary.materials | Where-Object { $_.type -eq 'video' } | Select-Object -First 1)[0]
if ($seedVideo -and $seedVideo.meta) {
    $seedVideo.meta.transcript = ''
}
$seedContent | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $tempContentPath -Encoding UTF8
$logPath = Join-Path $tempRoot 'platform-api.log'

$port = Get-FreePort
$baseUrl = "http://127.0.0.1:$port"
$serverProcess = $null
$uploadedUrl = ''

try {
    Write-TestStep 'Platform API protects admin routes with setup and login'
    $command = "Set-Location '$platformRoot'; `$env:APP_ENV='development'; `$env:APP_PORT='$port'; `$env:APP_BASE_URL='https://api.clearn.me'; `$env:DEV_CONTENT_PATH='$tempContentPath'; `$env:ADMIN_AUTH_PATH='$tempAuthPath'; `$env:ADMIN_SESSION_SECRET='test-admin-session-secret'; & '$($nodeCommand.Source)' '.\node_modules\tsx\dist\cli.mjs' '.\apps\api\src\index.ts' *> '$logPath'"
    $serverProcess = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $command) -PassThru -WindowStyle Hidden

    if (-not (Wait-ForUrl -Url "$baseUrl/api/health")) {
        $combinedLogs = if (Test-Path -LiteralPath $logPath) { Get-Content -LiteralPath $logPath -Raw -ErrorAction SilentlyContinue } else { '' }
        if ($combinedLogs -match 'spawn EPERM' -or $combinedLogs -match 'esbuild' -or $combinedLogs -match 'windows sandbox') {
            Write-Host 'Platform admin API tests skipped: this environment blocks tsx/esbuild child processes.'
            return
        }

        throw "Platform API did not become ready. Logs:`n$combinedLogs"
    }

    $status = Invoke-JsonRequest -Uri "$baseUrl/api/admin/auth/status" -Method Get
    Assert-True -Condition (-not [bool]$status.configured) -Message 'Admin auth should start unconfigured for a new deployment.'
    Assert-True -Condition (-not [bool]$status.authenticated) -Message 'Admin auth should start unauthenticated.'

    try {
        Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/api/admin/content" -Method Get | Out-Null
        throw 'Expected admin content to require setup before access.'
    }
    catch {
        Assert-Match -Actual $_.Exception.Message -Pattern '401|Unauthorized'
    }

    try {
        Invoke-JsonRequest -Uri "$baseUrl/api/admin/auth/setup" -Method Post -Payload @{
            login = 'admin'
            password = 'secret-123'
            confirmPassword = 'different-123'
            recoveryEmail = 'admin@example.com'
        } | Out-Null
        throw 'Expected setup to reject mismatched passwords.'
    }
    catch {
        Assert-Match -Actual $_.Exception.Message -Pattern '400|Bad Request'
    }

    $adminSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $setup = Invoke-JsonRequest -Uri "$baseUrl/api/admin/auth/setup" -Method Post -Payload @{
        login = 'admin'
        password = 'secret-123'
        confirmPassword = 'secret-123'
        recoveryEmail = 'admin@example.com'
    } -Session $adminSession
    Assert-True -Condition ([bool]$setup.configured)
    Assert-True -Condition ([bool]$setup.authenticated)

    $protectedContent = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/api/admin/content" -Method Get -WebSession $adminSession
    Assert-Equal -Expected 200 -Actual ([int]$protectedContent.StatusCode)
    $protectedJson = $protectedContent.Content | ConvertFrom-Json
    Assert-Equal -Expected 'Fetch transcript' -Actual ([string]$protectedJson.meta.ui.admin.actions.fetchTranscript) -Message 'Admin content should migrate newly bundled admin action labels into old mutable storage.'
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$protectedJson.meta.ui.admin.messages.videoTranscriptFetched)) -Message 'Admin content should migrate newly bundled admin messages into old mutable storage.'
    $migratedVideoLibrary = (($protectedJson.sections | Where-Object { $_.id -eq 'asking-after-talk' } | Select-Object -First 1).blocks | Where-Object { $_.id -eq 'block-ayctl2c6' } | Select-Object -First 1)
    $migratedVideo = @($migratedVideoLibrary.materials | Where-Object { $_.type -eq 'video' } | Select-Object -First 1)[0]
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$migratedVideo.meta.transcript)) -Message 'Admin content should migrate bundled video transcripts into old mutable storage when the material ID matches.'

    $sessionCookie = ($adminSession.Cookies.GetCookies($baseUrl) | Where-Object { $_.Name -eq 'softskills_admin_session' } | Select-Object -First 1)
    Assert-True -Condition ($null -ne $sessionCookie) -Message 'Admin setup should store a signed session cookie.'
    Assert-True -Condition (-not [bool]$sessionCookie.Secure) -Message 'Development admin cookies must not be Secure, otherwise localhost HTTP admin actions lose authentication after login.'
    $browserSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $browserSession.Cookies.Add($sessionCookie)
    $originProtectedContent = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/api/admin/content" -Method Get -Headers @{ Origin = 'http://localhost:8081' } -WebSession $browserSession
    Assert-Equal -Expected 200 -Actual ([int]$originProtectedContent.StatusCode) -Message 'Browser-style admin requests from the web origin should stay authenticated with the signed cookie.'

    Invoke-JsonRequest -Uri "$baseUrl/api/admin/auth/logout" -Method Post -Payload @{} -Session $adminSession | Out-Null
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/api/admin/content" -Method Get -WebSession $adminSession | Out-Null
        throw 'Expected admin content to require login after logout.'
    }
    catch {
        Assert-Match -Actual $_.Exception.Message -Pattern '401|Unauthorized'
    }

    $adminSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    try {
        Invoke-JsonRequest -Uri "$baseUrl/api/admin/auth/login" -Method Post -Payload @{ login = 'admin'; password = 'wrong-password' } -Session $adminSession | Out-Null
        throw 'Expected login to reject invalid credentials.'
    }
    catch {
        Assert-Match -Actual $_.Exception.Message -Pattern '401|Unauthorized'
    }

    Invoke-JsonRequest -Uri "$baseUrl/api/admin/auth/login" -Method Post -Payload @{ login = 'admin'; password = 'secret-123' } -Session $adminSession | Out-Null

    Write-TestStep 'Platform API accepts large admin media uploads'
    $bytes = New-Object byte[] (2MB)
    for ($i = 0; $i -lt $bytes.Length; $i++) {
        $bytes[$i] = 97
    }

    $payload = [PSCustomObject]@{
        fileName = 'large-video.mp4'
        base64 = [Convert]::ToBase64String($bytes)
    }

    $upload = Invoke-JsonRequest -Uri "$baseUrl/api/admin/media/upload" -Method Post -Payload $payload -Session $adminSession
    $uploadedUrl = [string]$upload.url
    Assert-Match -Actual $uploadedUrl -Pattern '^/uploads/'
    Assert-Equal -Expected $bytes.Length -Actual ([int]$upload.size)

    $absoluteUpload = Join-Path $webRoot ('static' + ($uploadedUrl -replace '/', '\'))
    Assert-True -Condition (Test-Path -LiteralPath $absoluteUpload -PathType Leaf) -Message 'Uploaded media file was not created on disk.'

    $rangeRequest = [System.Net.HttpWebRequest][System.Net.WebRequest]::Create("$baseUrl$uploadedUrl")
    $rangeRequest.Method = 'GET'
    $rangeRequest.AddRange(0, 15)
    $rangeResponse = $null
    try {
        $rangeResponse = [System.Net.HttpWebResponse]$rangeRequest.GetResponse()
        Assert-Equal -Expected 206 -Actual ([int]$rangeResponse.StatusCode) -Message 'Uploaded video should support HTTP byte ranges for browser playback.'
        Assert-Equal -Expected 'bytes' -Actual ([string]$rangeResponse.Headers['Accept-Ranges']) -Message 'Uploaded video range response should advertise byte ranges.'
        Assert-Match -Actual ([string]$rangeResponse.Headers['Content-Range']) -Pattern '^bytes 0-15/'
    }
    finally {
        if ($null -ne $rangeResponse) {
            $rangeResponse.Dispose()
        }
    }

    $deleteResult = Invoke-JsonRequest -Uri "$baseUrl/api/admin/media/delete" -Method Post -Payload @{ url = $uploadedUrl } -Session $adminSession
    Assert-True -Condition ([bool]$deleteResult.deleted)
    Assert-True -Condition (-not (Test-Path -LiteralPath $absoluteUpload -PathType Leaf)) -Message 'Uploaded media file was not deleted.'
    $uploadedUrl = ''
}
finally {
    if ($uploadedUrl) {
        $fallbackPath = Join-Path $webRoot ('static' + ($uploadedUrl -replace '/', '\'))
        if (Test-Path -LiteralPath $fallbackPath -PathType Leaf) {
            Remove-Item -LiteralPath $fallbackPath -Force -ErrorAction SilentlyContinue
        }
    }

    if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force
    }

    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host 'Platform admin API tests passed.'
