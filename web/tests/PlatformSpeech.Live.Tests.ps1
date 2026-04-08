Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $PSScriptRoot 'Assertions.ps1')

function Test-ValidHfTokenShape {
    param(
        [string]$Token
    )

    if ([string]::IsNullOrWhiteSpace($Token)) {
        return $false
    }

    $trimmed = $Token.Trim()
    if ($trimmed -in @('your_token_here', 'hf_your_token_here', 'YOUR_HF_TOKEN')) {
        return $false
    }

    return $trimmed -match '^hf_[A-Za-z0-9]+'
}

function Get-HfToken {
    $processToken = $env:HF_TOKEN
    if (Test-ValidHfTokenShape -Token $processToken) {
        return $processToken.Trim()
    }

    $userToken = [Environment]::GetEnvironmentVariable('HF_TOKEN', 'User')
    if (Test-ValidHfTokenShape -Token $userToken) {
        return $userToken.Trim()
    }

    if (-not [string]::IsNullOrWhiteSpace($processToken)) {
        throw 'HF_TOKEN is set in this shell, but it looks like a placeholder or has an invalid format. Use a real Hugging Face token that starts with hf_.'
    }

    if (-not [string]::IsNullOrWhiteSpace($userToken)) {
        throw 'Saved HF_TOKEN exists, but it looks invalid. Save a real Hugging Face token that starts with hf_.'
    }

    return ''
}

function Get-NodeExePath {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $defaultPath = 'C:\Program Files\nodejs\node.exe'
    if (Test-Path -LiteralPath $defaultPath) {
        return $defaultPath
    }

    throw 'node.exe was not found. Install Node.js before running PlatformSpeech.Live.Tests.ps1.'
}

function Get-JsonPropertyValue {
    param(
        $Object,
        [string]$Name,
        $Default = $null
    )

    if ($null -eq $Object) {
        return $Default
    }

    $property = $Object.PSObject.Properties[$Name]
    if ($property) {
        return $property.Value
    }

    return $Default
}

Write-TestStep 'Hugging Face STT accepts raw audio bytes payloads produced by the app'
$hfToken = Get-HfToken
if (-not $hfToken) {
    Write-Host 'Platform speech live tests skipped: HF_TOKEN is not configured in this shell.'
    exit 0
}

$nodeExe = Get-NodeExePath
$tempScriptPath = Join-Path ([System.IO.Path]::GetTempPath()) ('softskills-hf-stt-live-' + [Guid]::NewGuid().ToString('N') + '.mjs')
$nodeScriptLines = @(
    "const token = process.env.HF_TOKEN;",
    "const model = 'openai/whisper-large-v3';",
    "const sampleRate = 16000;",
    "const durationMs = 500;",
    "const sampleCount = Math.max(1, Math.round(sampleRate * (durationMs / 1000)));",
    "const bitsPerSample = 16;",
    "const channels = 1;",
    "const blockAlign = (channels * bitsPerSample) / 8;",
    "const byteRate = sampleRate * blockAlign;",
    "const dataSize = sampleCount * blockAlign;",
    "const riffSize = 36 + dataSize;",
    "const buffer = Buffer.alloc(44 + dataSize);",
    "let offset = 0;",
    "buffer.write('RIFF', offset); offset += 4;",
    "buffer.writeUInt32LE(riffSize, offset); offset += 4;",
    "buffer.write('WAVE', offset); offset += 4;",
    "buffer.write('fmt ', offset); offset += 4;",
    "buffer.writeUInt32LE(16, offset); offset += 4;",
    "buffer.writeUInt16LE(1, offset); offset += 2;",
    "buffer.writeUInt16LE(channels, offset); offset += 2;",
    "buffer.writeUInt32LE(sampleRate, offset); offset += 4;",
    "buffer.writeUInt32LE(byteRate, offset); offset += 4;",
    "buffer.writeUInt16LE(blockAlign, offset); offset += 2;",
    "buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;",
    "buffer.write('data', offset); offset += 4;",
    "buffer.writeUInt32LE(dataSize, offset); offset += 4;",
    "for (let i = 0; i < sampleCount; i += 1) {",
    "  buffer.writeInt16LE(0, offset);",
    "  offset += 2;",
    "}",
    "try {",
    "  const response = await fetch('https://router.huggingface.co/hf-inference/models/' + model, {",
    "    method: 'POST',",
    "    headers: {",
    "      Authorization: 'Bearer ' + token,",
    "      'Content-Type': 'audio/wav',",
    "    },",
    "    body: buffer,",
    "  });",
    "  const text = await response.text();",
    "  console.log(JSON.stringify({ ok: response.ok, status: response.status, body: text.slice(0, 1200) }));",
    "} catch (error) {",
    "  console.log(JSON.stringify({",
    "    ok: false,",
    "    status: 0,",
    "    transportError: error instanceof Error ? error.message : String(error),",
    "    transportCode: error && error.cause && error.cause.code ? String(error.cause.code) : '',",
    "    transportCauseMessage: error && error.cause && error.cause.message ? String(error.cause.message) : '',",
    "    transportCauseHost: error && error.cause && error.cause.host ? String(error.cause.host) : '',",
    "    transportCausePort: error && error.cause && error.cause.port ? String(error.cause.port) : '',",
    "  }));",
    "}"
)
$nodeScript = $nodeScriptLines -join "`n"
Set-Content -LiteralPath $tempScriptPath -Value $nodeScript -Encoding utf8

try {
    $previousToken = $env:HF_TOKEN
    $env:HF_TOKEN = $hfToken
    $raw = & $nodeExe $tempScriptPath
    if ($LASTEXITCODE -ne 0) {
        throw 'Node live STT probe failed to execute.'
    }

    $rawJson = ($raw | Select-Object -Last 1)
    $result = $rawJson | ConvertFrom-Json
    $transportError = [string](Get-JsonPropertyValue -Object $result -Name 'transportError' -Default '')
    $transportCode = [string](Get-JsonPropertyValue -Object $result -Name 'transportCode' -Default '')
    $transportCauseMessage = [string](Get-JsonPropertyValue -Object $result -Name 'transportCauseMessage' -Default '')
    $transportCauseHost = [string](Get-JsonPropertyValue -Object $result -Name 'transportCauseHost' -Default '')
    $transportCausePort = [string](Get-JsonPropertyValue -Object $result -Name 'transportCausePort' -Default '')
    if ($transportError) {
        $details = @($transportError)
        if ($transportCode) {
            $details += "code=$transportCode"
        }
        if ($transportCauseMessage) {
            $details += "cause=$transportCauseMessage"
        }
        if ($transportCauseHost) {
            $details += "host=$transportCauseHost"
        }
        if ($transportCausePort) {
            $details += "port=$transportCausePort"
        }

        if ($transportCode -eq 'EACCES') {
            Write-Host "Platform speech live tests skipped: outbound HTTPS access to Hugging Face is blocked in this environment. $($details -join '; ')"
            exit 0
        }

        throw "Hugging Face live STT check failed before the API responded: $($details -join '; ')"
    }

    $ok = [bool](Get-JsonPropertyValue -Object $result -Name 'ok' -Default $false)
    $status = [int](Get-JsonPropertyValue -Object $result -Name 'status' -Default 0)
    $body = [string](Get-JsonPropertyValue -Object $result -Name 'body' -Default '')

    if (-not $ok) {
        if ($body -match 'Invalid username or password') {
            throw 'Hugging Face live STT check failed: HF_TOKEN was rejected by Hugging Face. Use a real, active token from your Hugging Face account.'
        }

        throw "Hugging Face live STT check failed: HTTP $status - $body"
    }

    Assert-Match -Actual $body -Pattern '"text"\s*:' -Message 'Expected Hugging Face STT response to include a text field.'
    Write-Host 'Platform speech live tests passed.'
}
finally {
    if ($null -ne $previousToken) {
        $env:HF_TOKEN = $previousToken
    }
    else {
        Remove-Item Env:HF_TOKEN -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $tempScriptPath -Force -ErrorAction SilentlyContinue
}
