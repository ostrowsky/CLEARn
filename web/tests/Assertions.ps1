Set-StrictMode -Version Latest

function Write-TestStep {
    param(
        [string]$Message
    )

    Write-Host "[test] $Message"
}

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message = "Expected condition to be true."
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Assert-Equal {
    param(
        $Expected,
        $Actual,
        [string]$Message = ""
    )

    if ($Expected -ne $Actual) {
        if ([string]::IsNullOrWhiteSpace($Message)) {
            $Message = "Expected '$Expected' but got '$Actual'."
        }

        throw $Message
    }
}

function Assert-Match {
    param(
        [string]$Actual,
        [string]$Pattern,
        [string]$Message = ""
    )

    if ($Actual -notmatch $Pattern) {
        if ([string]::IsNullOrWhiteSpace($Message)) {
            $Message = "Expected '$Actual' to match pattern '$Pattern'."
        }

        throw $Message
    }
}
