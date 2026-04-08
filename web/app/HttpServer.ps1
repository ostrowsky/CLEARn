Set-StrictMode -Version Latest

$script:SoftSkillsSessions = @{}

function Read-JsonBody {
    param(
        [System.Net.HttpListenerRequest]$Request
    )

    if (-not $Request.HasEntityBody) {
        return $null
    }

    $reader = New-Object System.IO.StreamReader($Request.InputStream, $Request.ContentEncoding)
    try {
        $body = $reader.ReadToEnd()
        if ([string]::IsNullOrWhiteSpace($body)) {
            return $null
        }

        return ($body | ConvertFrom-Json)
    }
    finally {
        $reader.Dispose()
    }
}

function Get-RequestPropertyValue {
    param(
        $Body,
        [string]$Name,
        $Default = $null
    )

    if ($null -eq $Body) {
        return $Default
    }

    $property = $Body.PSObject.Properties[$Name]
    if ($property) {
        return $property.Value
    }

    return $Default
}

function Write-JsonResponse {
    param(
        [System.Net.HttpListenerResponse]$Response,
        $Payload,
        [int]$StatusCode = 200
    )

    $json = $Payload | ConvertTo-Json -Depth 8
    $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)

    $Response.StatusCode = $StatusCode
    $Response.ContentType = "application/json; charset=utf-8"
    $Response.ContentEncoding = [System.Text.Encoding]::UTF8
    $Response.ContentLength64 = $buffer.Length
    $Response.OutputStream.Write($buffer, 0, $buffer.Length)
    $Response.OutputStream.Close()
}

function Get-ContentType {
    param(
        [string]$Extension
    )

    switch ($Extension.ToLowerInvariant()) {
        ".html" { return "text/html; charset=utf-8" }
        ".css" { return "text/css; charset=utf-8" }
        ".js" { return "application/javascript; charset=utf-8" }
        ".json" { return "application/json; charset=utf-8" }
        ".svg" { return "image/svg+xml" }
        ".png" { return "image/png" }
        ".jpg" { return "image/jpeg" }
        ".jpeg" { return "image/jpeg" }
        default { return "application/octet-stream" }
    }
}

function Write-FileResponse {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [string]$FilePath
    )

    if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
        Write-JsonResponse -Response $Response -Payload @{ error = "File not found." } -StatusCode 404
        return
    }

    $bytes = [System.IO.File]::ReadAllBytes($FilePath)
    $Response.StatusCode = 200
    $Response.ContentType = Get-ContentType -Extension ([System.IO.Path]::GetExtension($FilePath))
    $Response.ContentLength64 = $bytes.Length
    $Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Response.OutputStream.Close()
}

function Resolve-StaticPath {
    param(
        [string]$StaticRoot,
        [string]$RequestPath
    )

    $cleanPath = $RequestPath.TrimStart("/")
    if ([string]::IsNullOrWhiteSpace($cleanPath)) {
        $cleanPath = "index.html"
    }

    $candidate = [System.IO.Path]::GetFullPath((Join-Path $StaticRoot $cleanPath))
    $staticRootFull = [System.IO.Path]::GetFullPath($StaticRoot)

    if (-not $candidate.StartsWith($staticRootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $null
    }

    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        return $candidate
    }

    return $null
}

function Handle-ApiRequest {
    param(
        [System.Net.HttpListenerContext]$Context
    )

    $request = $Context.Request
    $response = $Context.Response
    $path = $request.Url.AbsolutePath
    $method = $request.HttpMethod.ToUpperInvariant()

    if ($method -eq "GET" -and $path -eq "/api/health") {
        Write-JsonResponse -Response $response -Payload @{ status = "ok"; generatorMode = Get-GeneratorMode }
        return
    }

    $body = Read-JsonBody -Request $request

    switch ($path) {
        "/api/asking/clarify" {
            if ($method -ne "POST") { break }
            $exercise = Get-ClarifyExercise -Context ([string](Get-RequestPropertyValue -Body $body -Name "context" -Default "")) -Offset ([int](Get-RequestPropertyValue -Body $body -Name "offset" -Default 0))
            Write-JsonResponse -Response $response -Payload $exercise
            return
        }
        "/api/asking/clarify/check" {
            if ($method -ne "POST") { break }
            $feedback = Test-ClarifyingQuestion `
                -UserQuestion ([string](Get-RequestPropertyValue -Body $body -Name "userQuestion" -Default "")) `
                -ExpectedQuestion ([string](Get-RequestPropertyValue -Body $body -Name "expectedQuestion" -Default "")) `
                -Target ([string](Get-RequestPropertyValue -Body $body -Name "target" -Default "")) `
                -Focus ([string](Get-RequestPropertyValue -Body $body -Name "focus" -Default ""))
            Write-JsonResponse -Response $response -Payload $feedback
            return
        }
        "/api/asking/without-context" {
            if ($method -ne "POST") { break }
            $exercise = Get-AskWithoutContextExercise -Offset ([int](Get-RequestPropertyValue -Body $body -Name "offset" -Default 0))
            Write-JsonResponse -Response $response -Payload $exercise
            return
        }
        "/api/asking/after-talk" {
            if ($method -ne "POST") { break }
            $brief = Get-AskAfterTalkBrief -Context ([string](Get-RequestPropertyValue -Body $body -Name "context" -Default "")) -Offset ([int](Get-RequestPropertyValue -Body $body -Name "offset" -Default 0))
            Write-JsonResponse -Response $response -Payload $brief
            return
        }
        "/api/asking/after-talk/check" {
            if ($method -ne "POST") { break }
            $feedback = Test-AskAfterQuestion -Question ([string](Get-RequestPropertyValue -Body $body -Name "question" -Default ""))
            Write-JsonResponse -Response $response -Payload $feedback
            return
        }
        "/api/answering/session/start" {
            if ($method -ne "POST") { break }
            $session = New-AnsweringSession `
                -Context ([string](Get-RequestPropertyValue -Body $body -Name "context" -Default "")) `
                -Mode ([string](Get-RequestPropertyValue -Body $body -Name "mode" -Default "good"))
            $script:SoftSkillsSessions[$session.sessionId] = $session
            Write-JsonResponse -Response $response -Payload $session
            return
        }
        "/api/answering/session/respond" {
            if ($method -ne "POST") { break }
            $updated = Submit-AnsweringReply `
                -SessionStore $script:SoftSkillsSessions `
                -SessionId ([string](Get-RequestPropertyValue -Body $body -Name "sessionId" -Default "")) `
                -UserReply ([string](Get-RequestPropertyValue -Body $body -Name "userReply" -Default ""))
            Write-JsonResponse -Response $response -Payload $updated
            return
        }
    }

    Write-JsonResponse -Response $response -Payload @{ error = "Unknown API route." } -StatusCode 404
}

function Start-SoftSkillsServer {
    param(
        [string]$ProjectRoot,
        [int]$Port = 8080
    )

    $staticRoot = Join-Path $ProjectRoot "static"
    $listener = New-Object System.Net.HttpListener
    $prefix = "http://localhost:$Port/"
    $listener.Prefixes.Add($prefix)
    $listener.Start()

    Write-Host "SOFTskills web server is running on $prefix"

    try {
        while ($listener.IsListening) {
            $context = $listener.GetContext()

            try {
                $path = $context.Request.Url.AbsolutePath

                if ($path.StartsWith("/api/")) {
                    Handle-ApiRequest -Context $context
                    continue
                }

                $resolvedPath = Resolve-StaticPath -StaticRoot $staticRoot -RequestPath $path
                if ($resolvedPath) {
                    Write-FileResponse -Response $context.Response -FilePath $resolvedPath
                    continue
                }

                Write-FileResponse -Response $context.Response -FilePath (Join-Path $staticRoot "index.html")
            }
            catch {
                Write-JsonResponse -Response $context.Response -Payload @{ error = $_.Exception.Message } -StatusCode 500
            }
        }
    }
    finally {
        if ($listener.IsListening) {
            $listener.Stop()
        }

        $listener.Close()
    }
}
