# SOFTskills Workflow Rules

This file defines the cheapest practical workflow for future sessions.

Read this after `D:\Projects\SOFTskills\TOKEN_CONTEXT.md`.

## Main Goal

- Spend tokens only on the smallest useful unit of context.
- Avoid broad repo re-discovery.
- Prefer deterministic checks before speculative analysis.

## Default Operating Sequence

Use this order unless there is a very strong reason not to:

1. Read `D:\Projects\SOFTskills\TOKEN_CONTEXT.md`
2. Identify the exact screen, service, or content file involved
3. Read only those exact files
4. Check the nearest existing targeted test
5. Run the smallest relevant test
6. Edit only after the failure mode is concrete
7. Run the next-smallest verification step
8. Run the full suite only when the change crosses multiple layers

## What To Read First

### If the issue is visible in UI

Read:

- the exact screen file
- the nearest shared component used by that screen
- the nearest targeted test

Do not start with:

- broad repo search
- full `content.json`
- API code
- full test suite

### If the issue looks content-driven

Read first:

- `D:\Projects\SOFTskills\web\data\content.json`
- `D:\Projects\SOFTskills\web\data\content.template.json`
- the nearest screen file that renders the content

Do not start with:

- provider code
- route handlers
- full architecture scans

### If the issue is API behavior

Read first:

- the exact service file
- the exact route file
- the matching API test

Do not start with:

- all client files
- all provider files
- unrelated tests

## MCP Usage Rules For Token Saving

Use MCP when it replaces broad text reasoning with precise metadata retrieval.

### Prefer MCP for

- GitHub repository, PR, issue, and review metadata
- official documentation lookups
- connector-backed inspection where the source is already structured

### Avoid MCP when

- the answer is already in local project files
- the issue is a local runtime bug
- a targeted local test gives the answer more cheaply

### MCP Best Practices

- ask one narrow question at a time
- request exact entities, not broad overviews
- use MCP before web search when the source is already connected
- prefer primary-source docs only

## Test Discipline

### Run targeted tests first

Use the smallest relevant test from `D:\Projects\SOFTskills\TOKEN_CONTEXT.md`.

Examples:

```powershell
powershell -ExecutionPolicy Bypass -File D:\Projects\SOFTskills\web\tests\PlatformAnswering.Tests.ps1
powershell -ExecutionPolicy Bypass -File D:\Projects\SOFTskills\web\tests\PlatformClarify.Tests.ps1
powershell -ExecutionPolicy Bypass -File D:\Projects\SOFTskills\web\tests\PlatformCoach.Tests.ps1
powershell -ExecutionPolicy Bypass -File D:\Projects\SOFTskills\web\tests\PlatformAdmin.Tests.ps1
```

### Run full suites only if one of these is true

- shared contracts changed
- content schema changed in a cross-cutting way
- provider wiring changed
- admin save/load behavior changed
- public preview startup behavior changed

Full suites:

```powershell
powershell -ExecutionPolicy Bypass -File D:\Projects\SOFTskills\web\tests\run-admin-tests.ps1
powershell -ExecutionPolicy Bypass -File D:\Projects\SOFTskills\web\tests\run-tests.ps1
```

## Search Discipline

### Preferred

- exact file open
- exact test open
- narrow pattern search in a specific folder

### Avoid by default

- recursive scans over the whole repo
- scanning `node_modules`
- scanning `.git`, `.expo`, `dist`, `build`, `coverage`
- wide searches when the screen/service is already known

## Preview Discipline

Public preview is useful but expensive in time and attention.

Use it only when:

- the user explicitly wants a customer-facing link
- the issue depends on mobile/browser behavior
- the bug cannot be verified by tests alone

Do not restart preview for every code change.

Restart preview after:

- runtime UI change that needs browser confirmation
- API route change used by the preview
- provider config change
- share/tunnel startup change

Launcher:

```powershell
cd D:\Projects\SOFTskills
.\start-cloudflare-preview.bat
```

## LLM Usage Rules

Use LLM reasoning only where deterministic logic is not enough.

### Good uses

- prompt design
- fallback conversation quality
- evaluation copy quality
- role-aware scenario logic

### Avoid unnecessary LLM usage for

- file path discovery
- schema lookup
- test selection
- syntax checking
- route existence checks

## Logging And Diagnostics

Before deep reasoning:

- read the exact error
- inspect the exact stack file
- check the nearest debug log or test

Do not begin with long speculative analysis when:

- the stack trace already names the file
- the failing route is already known
- the failing test already exists

## What To Store In Context Files

Keep only durable, reusable, high-signal information:

- repo map
- active AI stack
- key invariants
- exact commands
- test map
- recent high-impact fixes

Do not store:

- long narratives
- temporary thoughts
- full logs
- repeated explanations already obvious from code

## Update Rule

After a meaningful fix, update one of:

- `D:\Projects\SOFTskills\TOKEN_CONTEXT.md`
- `D:\Projects\SOFTskills\WORKFLOW_RULES.md`

Only if the new information will save future tokens.

## Quick Decision Rules

If unsure, use these:

- known screen bug -> read screen + nearest test
- content bug -> read `content.json`
- runtime stack trace -> open named file first
- API error -> read route + service + matching API test
- admin save bug -> read admin screen + admin tests
- prompt quality bug -> read content prompts + service fallback logic
- preview bug -> verify locally first, preview second
