$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$admin = Get-Content (Join-Path $root 'platform/apps/client/app/admin.tsx') -Raw
$helper = Get-Content (Join-Path $root 'platform/apps/client/src/lib/contentTypography.ts') -Raw
$renderer = Get-Content -LiteralPath (Join-Path $root 'platform/apps/client/app/section/[id].tsx') -Raw
$askAfter = Get-Content (Join-Path $root 'platform/apps/client/src/components/practice/AskAfterComposer.tsx') -Raw

foreach ($field in @('eyebrow', 'title', 'summary', 'description', 'body', 'transcript', 'statement')) {
  $pattern = "FontSizeControl.*'$field'"
  if ($admin -notmatch $pattern) { throw "Admin font-size control missing for $field" }
}
if ($helper -notmatch 'fontSizes' -or $helper -notmatch 'Math\.min\(200, Math\.max\(8') { throw 'Per-text font-size storage or clamping is missing.' }
if ($renderer -notmatch "textStyle\(styles\.materialBody, material, 'body'\)") { throw 'Material body font size is not rendered.' }
if ($renderer -notmatch "textStyle\(styles\.blockTitle, block, 'title'\)") { throw 'Block title font size is not rendered.' }
if ($admin -match 'All UI text') { throw 'Unstructured All UI text editor must not be rendered.' }
if ($admin -notmatch 'Interface text for this section' -or $admin -notmatch 'Interface text for this block' -or $admin -notmatch 'listBlockUiCopy') { throw 'Section/block-structured UI copy editor is missing.' }
if ($admin -notmatch 'Font size: \{currentValue\} px') { throw 'Font-size control must show the current pixel value.' }
if ($admin -notmatch 'Developer mode' -or $admin -notmatch 'developerMode \?') { throw 'Technical JSON editors must be gated by Developer mode.' }
if ($admin -notmatch 'Section display' -or $admin -notmatch 'Collapsible blocks') { throw 'Section display controls are missing.' }
if ($askAfter -notmatch "uiTextStyle\(ui, \['feedback', 'videoPracticeLibraryDescription'\]") { throw 'Video library description font size is not rendered.' }

Write-Output 'Per-text typography checks passed.'
