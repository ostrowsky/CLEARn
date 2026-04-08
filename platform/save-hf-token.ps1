param(
    [string]$Token
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-PlainTextFromSecureString {
    param([securestring]$Value)

    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    }
    finally {
        if ($bstr -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
    }
}

if ([string]::IsNullOrWhiteSpace($Token)) {
    $secureToken = Read-Host 'Enter HF_TOKEN to save for future runs' -AsSecureString
    $Token = Get-PlainTextFromSecureString -Value $secureToken
}

$Token = [string]$Token
$Token = $Token.Trim()
if ([string]::IsNullOrWhiteSpace($Token)) {
    throw 'HF_TOKEN is empty. Nothing was saved.'
}

[Environment]::SetEnvironmentVariable('HF_TOKEN', $Token, 'User')
$env:HF_TOKEN = $Token

Write-Host 'HF_TOKEN was saved to the Windows user environment.'
Write-Host 'Future preview scripts will load it automatically.'
Write-Host 'You can now run .\platform\open-share-preview.ps1 without re-entering the token.'
