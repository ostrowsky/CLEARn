# CLEARn Session Bootstrap

Use this file as the 30-second startup checklist for a new session.

## Read Order

1. `D:\Projects\CLEARn\TOKEN_CONTEXT.md`
2. `D:\Projects\CLEARn\WORKFLOW_RULES.md`
3. This file

## First Questions To Answer

Before doing anything, identify:

- What exact screen or route is affected?
- Is this a UI issue, content issue, API issue, or provider issue?
- Which one file is most likely involved?
- Which one targeted test is cheapest to run first?

## Cheapest Startup Flow

1. Open the exact screen or service file
2. Open the nearest targeted test
3. Read only the relevant content file if the issue is content-driven
4. Run one targeted test
5. Edit only after the failure mode is concrete

## Open These First For Common Areas

### Clarify

- `D:\Projects\CLEARn\platform\apps\client\app\practice\asking\clarify.tsx`
- `D:\Projects\CLEARn\platform\apps\client\src\components\practice\ClarifyPracticeInlineList.tsx`
- `D:\Projects\CLEARn\web\tests\PlatformClarify.Tests.ps1`

### Ask after the talk

- `D:\Projects\CLEARn\platform\apps\client\app\practice\asking\after-talk.tsx`
- `D:\Projects\CLEARn\platform\apps\client\src\components\practice\AskAfterComposer.tsx`
- `D:\Projects\CLEARn\platform\apps\api\src\modules\practice\practice.service.ts`
- `D:\Projects\CLEARn\web\tests\Service.Tests.ps1`

### Answering mixed

- `D:\Projects\CLEARn\platform\apps\client\app\practice\answering\[mode].tsx`
- `D:\Projects\CLEARn\platform\apps\api\src\modules\session\answering.service.ts`
- `D:\Projects\CLEARn\web\tests\PlatformAnswering.Tests.ps1`

### AI learning chat

- `D:\Projects\CLEARn\platform\apps\client\app\practice\chat.tsx`
- `D:\Projects\CLEARn\platform\apps\api\src\modules\session\coach.service.ts`
- `D:\Projects\CLEARn\web\tests\PlatformCoach.Tests.ps1`

### Admin

- `D:\Projects\CLEARn\platform\apps\client\app\admin.tsx`
- `D:\Projects\CLEARn\web\data\content.json`
- `D:\Projects\CLEARn\web\tests\PlatformAdmin.Tests.ps1`
- `D:\Projects\CLEARn\web\tests\Admin.Tests.ps1`

## Cheapest Useful Commands

Targeted tests:

```powershell
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformSyntax.Tests.ps1
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformAnswering.Tests.ps1
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformClarify.Tests.ps1
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformCoach.Tests.ps1
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformAdmin.Tests.ps1
```

Full suites only when necessary:

```powershell
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\run-admin-tests.ps1
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\run-tests.ps1
```

Public preview:

```powershell
cd D:\Projects\CLEARn
.\start-cloudflare-preview.bat
```

## Do Not Waste Tokens On This

- do not rescan the whole repo if the route or screen is already known
- do not inspect `node_modules`, `.git`, `.expo`, `tmp-platform-*`
- do not run full suites before one targeted test
- do not start web search if the answer is inside project files
- do not reason broadly before reading the exact stack trace file

## Update Rule

If a new lesson will help future sessions start faster, add one short note to:

- `D:\Projects\CLEARn\TOKEN_CONTEXT.md`

Do not store long logs or temporary thinking here.
