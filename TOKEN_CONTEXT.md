# CLEARn Token-Saving Context

This file is the first place to read before scanning the repo or asking the model to reconstruct project context.

Then read:

- `D:\Projects\CLEARn\WORKFLOW_RULES.md`
- `D:\Projects\CLEARn\SESSION_BOOTSTRAP.md`

## Purpose

- Reduce repeated token spend on repo re-discovery.
- Keep high-signal project state in one place.
- Let future sessions start from precise file paths and rules instead of broad codebase scans.

## Current Product Shape

- Root workspace: `D:\Projects\CLEARn`
- Main active product: `platform`
- Legacy support layer and tests: `web`
- Customer preview launcher: `D:\Projects\CLEARn\start-cloudflare-preview.bat`

## Repo Map

- `D:\Projects\CLEARn\platform`
  Shared Expo web/mobile client plus Fastify API.
- `D:\Projects\CLEARn\platform\apps\client`
  Learner UI, admin UI, practice screens.
- `D:\Projects\CLEARn\platform\apps\api`
  Session logic, practice logic, provider integration.
- `D:\Projects\CLEARn\platform\packages\domain`
  Shared domain types.
- `D:\Projects\CLEARn\platform\packages\contracts`
  Shared API contracts.
- `D:\Projects\CLEARn\web`
  Legacy content store, PowerShell server, regression suite, live content files.
- `D:\Projects\CLEARn\web\data\content.json`
  Live editable product content.
- `D:\Projects\CLEARn\web\data\content.template.json`
  Template content and schema defaults.
- `D:\Projects\CLEARn\web\tests`
  Main regression suite used before public preview.

## Current AI Stack

- Chat default: self-hosted OpenAI-compatible endpoint
- Preferred chat model: `gemma3:12b`
- Hugging Face chat fallback is still supported when self-hosted is unavailable
- STT default: Hugging Face `openai/whisper-large-v3`
- TTS default: Hugging Face `hexgrad/Kokoro-82M`

Key config:

- `D:\Projects\CLEARn\platform\apps\api\src\config\env.ts`
- `D:\Projects\CLEARn\platform\apps\api\src\providers\providerRegistry.ts`

## Most Important Screens And Logic

- Clarify practice:
  - `D:\Projects\CLEARn\platform\apps\client\app\practice\asking\clarify.tsx`
  - `D:\Projects\CLEARn\platform\apps\client\src\components\practice\ClarifyPracticeInlineList.tsx`
- Ask after the talk:
  - `D:\Projects\CLEARn\platform\apps\client\app\practice\asking\after-talk.tsx`
  - `D:\Projects\CLEARn\platform\apps\client\src\components\practice\AskAfterComposer.tsx`
  - `D:\Projects\CLEARn\platform\apps\api\src\modules\practice\practice.service.ts`
- Answering mixed session:
  - `D:\Projects\CLEARn\platform\apps\client\app\practice\answering\[mode].tsx`
  - `D:\Projects\CLEARn\platform\apps\api\src\modules\session\answering.service.ts`
- AI learning chat:
  - `D:\Projects\CLEARn\platform\apps\client\app\practice\chat.tsx`
  - `D:\Projects\CLEARn\platform\apps\api\src\modules\session\coach.service.ts`
- Unified admin:
  - `D:\Projects\CLEARn\platform\apps\client\app\admin.tsx`

## Current UX / Product Rules Worth Remembering

- `1.1.3` clarify now has inline live practice under each audio example.
- `Ask after the talk` uses a short generated text, not a dialogue transcript.
- `Ask after the talk` generated speech should be a likely professional yet friendly speech about the learner-written topic, no more than 100 words, not a fact list that repeats the input.
- `Review this question` must evaluate the currently composed follow-up question, not a cached first result.
- `1.3` is now question formation practice: show a short IT sentence for 3 seconds, hide three answer spans, and validate WH questions by text or STT.
- `answering-mixed-practice` improved answer must preserve the user-selected reaction phrase and only improve the answer body.
- `answering-mixed-practice` improved answer must remain an answer statement. It must never rewrite the learner reply as a question or end with a question mark.
- Admin supports ordering blocks and materials.
- Admin also supports editing answering reaction categories and phrase options.

## Cheap-First Debugging Order

Before broad analysis, check in this order:

1. Read this file.
2. Read the exact screen or service file named above.
3. Read `content.json` if the issue looks content-driven.
4. Read the closest targeted PowerShell test in `D:\Projects\CLEARn\web\tests`.
5. Run one targeted test.
6. Run full suites only if the change crosses multiple areas.

## Cheapest Useful Commands

Targeted tests:

```powershell
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformAnswering.Tests.ps1
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformClarify.Tests.ps1
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformCoach.Tests.ps1
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformSpeech.Tests.ps1
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformAdmin.Tests.ps1
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformSyntax.Tests.ps1
```

Full suites:

```powershell
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\run-admin-tests.ps1
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\run-tests.ps1
```

Public preview:

```powershell
cd D:\Projects\CLEARn
.\start-cloudflare-preview.bat
```

## MCP / Tool Token-Saving Rules

- Prefer exact file reads over repo-wide search.
- Prefer MCP metadata and targeted connector calls over pasting long logs or broad web searches.
- Use official or primary-source docs only when current information may have changed.
- Reuse existing test names and known entrypoints from this file instead of rediscovering them.
- Use targeted tests first, not full suites by default.
- Do not scan `node_modules`, `.git`, `.expo`, temp folders, or generated test sandboxes.
- Prefer existing debug endpoints and runtime logs over speculative reasoning.
- If a problem is content-driven, inspect `content.json` before changing TypeScript.
- If a problem is UI-only, inspect the client screen and the nearest test before touching API code.

## Background Token Sources

As of 2026-04-18:

- No project-specific Codex cron/heartbeat automations were found for `CLEARn`.
- All automations found under `C:\Users\Lenovo\.codex\automations` belong to other projects and were already `PAUSED`.
- Local preview or API `node.exe` processes may remain running after manual testing; these are not Codex automations, but they should still be stopped when not needed.

## What To Update After Each Meaningful Change

Keep this section short. Add only high-signal facts:

- Date
- Feature or bug fixed
- Key files changed
- Any new invariant or rule
- Exact test command that proved the change

### Change Entry Template

Use this compact template for each meaningful change:

```md
- YYYY-MM-DD: <short feature or fix>
  - Files: <1-4 most important absolute or repo-root paths>
  - Rule: <new invariant / behavior / warning>
  - Verified by: <exact test command>
```

Example:

```md
- 2026-04-18: Answering improved answer now keeps learner reaction
  - Files: D:\Projects\CLEARn\platform\apps\api\src\modules\session\answering.service.ts
  - Rule: Improved answer must start with the user-selected reaction phrase and only improve the answer body
  - Verified by: powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformAnswering.Tests.ps1
```

- 2026-04-22: Section 1.3 changed to WH question formation practice
  - Files: D:\Projects\CLEARn\platform\apps\client\src\components\practice\QuestionFormationPractice.tsx; D:\Projects\CLEARn\platform\apps\api\src\modules\practice\practice.service.ts; D:\Projects\CLEARn\web\data\content.template.json
  - Rule: The learner sees the full IT sentence for 3 seconds, then asks WH questions for three blanks; correct answers reveal green, hints reveal red
  - Verified by: powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformQuestionFormation.Tests.ps1

## Screen To Test Map

Use this table before running broad suites.

### Clarify details

Screen and logic:

- `D:\Projects\CLEARn\platform\apps\client\app\practice\asking\clarify.tsx`
- `D:\Projects\CLEARn\platform\apps\client\src\components\practice\ClarifyPracticeInlineList.tsx`

Run first:

```powershell
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformClarify.Tests.ps1
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformSpeech.Tests.ps1
```

Run if API behavior changed:

```powershell
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformClarify.Api.Tests.ps1
```

### Ask after the talk

Screen and logic:

- `D:\Projects\CLEARn\platform\apps\client\app\practice\asking\after-talk.tsx`
- `D:\Projects\CLEARn\platform\apps\client\src\components\practice\AskAfterComposer.tsx`
- `D:\Projects\CLEARn\platform\apps\api\src\modules\practice\practice.service.ts`

Run first:

```powershell
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\Service.Tests.ps1
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformExerciseTemplates.Tests.ps1
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformSpeech.Tests.ps1
```

Run if fallback/generation changed:

```powershell
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformFallbacks.Tests.ps1
```

### Answering mixed session

Screen and logic:

- `D:\Projects\CLEARn\platform\apps\client\app\practice\answering\[mode].tsx`
- `D:\Projects\CLEARn\platform\apps\api\src\modules\session\answering.service.ts`

Run first:

```powershell
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformAnswering.Tests.ps1
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformSyntax.Tests.ps1
```

Run if prompt/fallback or provider behavior changed:

```powershell
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformAiStack.Tests.ps1
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformFallbacks.Tests.ps1
```

### AI learning chat

Screen and logic:

- `D:\Projects\CLEARn\platform\apps\client\app\practice\chat.tsx`
- `D:\Projects\CLEARn\platform\apps\api\src\modules\session\coach.service.ts`

Run first:

```powershell
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformCoach.Tests.ps1
```

Run if API/session behavior changed:

```powershell
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformCoach.Api.Tests.ps1
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformAiStack.Tests.ps1
```

### Unified admin

Screen and logic:

- `D:\Projects\CLEARn\platform\apps\client\app\admin.tsx`
- `D:\Projects\CLEARn\web\data\content.json`
- `D:\Projects\CLEARn\web\data\content.template.json`

Run first:

```powershell
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformAdmin.Tests.ps1
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\Admin.Tests.ps1
```

Run if uploads or save API changed:

```powershell
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformAdmin.Api.Tests.ps1
```

### Content schema / shared runtime contract

Files:

- `D:\Projects\CLEARn\web\data\content.json`
- `D:\Projects\CLEARn\web\data\content.template.json`
- `D:\Projects\CLEARn\platform\packages\domain\src\*.ts`
- `D:\Projects\CLEARn\platform\packages\contracts\src\*.ts`

Run first:

```powershell
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\ContentDriven.Tests.ps1
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\Architecture.Tests.ps1
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\PlatformSyntax.Tests.ps1
```

### Backup / restore

Files:

- `D:\Projects\CLEARn\platform\backup-app.ps1`
- `D:\Projects\CLEARn\platform\restore-app.ps1`

Run first:

```powershell
powershell -ExecutionPolicy Bypass -File D:\Projects\CLEARn\web\tests\Backup.Tests.ps1
```

### Session Notes

- 2026-04-18: Added token-saving context file. Confirmed no active `CLEARn` Codex automations. Found several local preview/API processes that are operational only, not token automations.
- 2026-04-18: Added compact change-entry template and screen-to-test map for cheaper future sessions.
- 2026-04-19: Answering improved answers now strip question-like rewrites and fall back to statement answers. Rule: answering practice user replies must remain answers, not questions. Verified by `PlatformAnswering.Tests.ps1`, `PlatformAiStack.Tests.ps1`, and `ContentDriven.Tests.ps1`.
- 2026-04-21: Ask-after generated talk now treats user input as a speech topic and creates one likely professional friendly speech paragraph up to 100 words. Verified by `PlatformSyntax.Tests.ps1`, `PlatformFallbacks.Tests.ps1`, `PlatformExerciseTemplates.Tests.ps1`, and `Service.Tests.ps1`.
- 2026-04-22: STT defaults moved away from paid Hugging Face Inference Providers to local self-hosted Whisper. Use `D:\Projects\CLEARn\start-local-stt.bat` to run the free OpenAI-compatible STT server on `http://localhost:8010/v1`; preview auto-starts it. HF live STT tests are opt-in with `RUN_HF_LIVE_STT_TESTS=1` to avoid spending credits.
- 2026-04-22: Root cause of browser STT `failed to fetch`: first local Whisper request downloaded/loaded the model and exceeded the browser/API timeout; later the API may also be down while local STT is alive. Fixed by adding local STT startup warmup and `/v1/warmup`, then making `open-share-preview.ps1` wait for `modelLoaded=true` before exposing public links. Verified API-to-local-STT with a WAV payload returning `provider=selfhosted`.
