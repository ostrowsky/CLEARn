Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$platformRoot = Join-Path $workspaceRoot 'platform'
. (Join-Path $PSScriptRoot 'Assertions.ps1')

Write-TestStep 'Critical platform TypeScript files parse successfully'
$typescriptCompiler = Join-Path $platformRoot 'node_modules\typescript\lib\typescript.js'
Assert-True -Condition (Test-Path -LiteralPath $typescriptCompiler) -Message 'TypeScript compiler should exist under platform/node_modules.'

$files = @(
    (Join-Path $platformRoot 'apps\api\src\routes\registerRoutes.ts'),
    (Join-Path $platformRoot 'apps\api\src\providers\chat\jsonResponse.ts'),
    (Join-Path $platformRoot 'apps\api\src\providers\chat\huggingface.ts'),
    (Join-Path $platformRoot 'apps\api\src\providers\chat\selfHosted.ts'),
    (Join-Path $platformRoot 'apps\api\src\modules\practice\practice.service.ts'),
    (Join-Path $platformRoot 'apps\api\src\modules\session\answering.service.ts'),
    (Join-Path $platformRoot 'apps\api\src\modules\session\coach.service.ts'),
    (Join-Path $platformRoot 'apps\client\app\practice\asking\after-talk.tsx'),
    (Join-Path $platformRoot 'apps\client\app\practice\answering\[mode].tsx')
)

foreach ($file in $files) {
    Assert-True -Condition (Test-Path -LiteralPath $file) -Message "Expected source file to exist: $file"
}

$script = @"
const fs = require('fs');
const ts = require(process.argv[2]);
const files = process.argv.slice(3);
const failures = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const scriptKind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, scriptKind);
  const diagnostics = sourceFile.parseDiagnostics || [];
  if (diagnostics.length) {
    failures.push({
      file,
      messages: diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')),
    });
  }
}
if (failures.length) {
  console.error(JSON.stringify(failures));
  process.exit(1);
}
console.log('TS_PARSE_OK');
"@

$output = $script | node - $typescriptCompiler $files 2>&1
Assert-Equal -Expected 0 -Actual $LASTEXITCODE -Message ("TypeScript parse check failed: {0}" -f (($output | Out-String).Trim()))
Assert-True -Condition ((($output | Out-String).Trim()) -match 'TS_PARSE_OK') -Message 'Expected TypeScript parser smoke test to complete successfully.'

Write-Host 'Platform syntax tests passed.'