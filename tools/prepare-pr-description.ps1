Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$skillPath = Join-Path $env:USERPROFILE '.codex\skills\pr-description\SKILL.md'
$outputPath = Join-Path $repoRoot '.git\PULL_REQUEST_DESCRIPTION.md'

$diffStat = git -C $repoRoot diff main...HEAD --stat
$commits = git -C $repoRoot log --oneline main..HEAD

$skillNote = if (Test-Path -LiteralPath $skillPath -PathType Leaf) {
    "Generated with the local pr-description skill format from $skillPath."
} else {
    "Generated with the repository PR description hook format because the local pr-description skill was not found."
}

$body = @"
## What
Describe in one sentence what this PR does.

## Why
Explain why this change is needed.

## Changes
- Replace this bullet list with the concrete grouped changes from the branch.

<!--
$skillNote

Commits:
$commits

Diff stat:
$diffStat
-->
"@

Set-Content -LiteralPath $outputPath -Value $body -Encoding UTF8
Write-Host "PR description draft written to $outputPath"

