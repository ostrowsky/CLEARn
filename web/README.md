# SOFTskills Web Prototype

This folder contains the learner-facing prototype and a separate web admin panel for managing structured content.

## What is implemented

- learner web prototype for asking and answering questions
- separate admin page for section, block, material and media management
- backend proxy for a real LLM provider
- local fallback generators when the provider is not configured
- PowerShell-based automated tests

## Main files

- `app/Services.ps1` - practice generators, LLM integration, scoring logic, and short dialogue flows
- `app/ContentStore.ps1` - JSON content store and upload helpers
- `server.ps1` - local TCP-based web server and API routes
- `open-local.ps1` - starts the local server and opens the learner app
- `open-admin.ps1` - starts the local server and opens the admin panel
- `open-admin-share.ps1` - creates a public tunnel for the admin panel
- `static/` - learner SPA and admin page assets
- `data/content.json` - editable structured content
- `static/uploads/` - uploaded media files
- `tests/` - automated tests

## Run locally

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\web\open-local.ps1
```

The learner app opens at [http://localhost:8080/](http://localhost:8080/).
The admin panel opens at [http://localhost:8080/admin](http://localhost:8080/admin).

To open only the admin panel directly:

```powershell
powershell -ExecutionPolicy Bypass -File .\web\open-admin.ps1
```

## Run with the real LLM

```powershell
$env:SOFTSKILLS_LLM_API_KEY = 'sk-your-key-here'
$env:SOFTSKILLS_LLM_MODEL = 'gpt-4o-mini'
powershell -ExecutionPolicy Bypass -File .\web\open-local.ps1
```

Optional for OpenAI-compatible gateways:

```powershell
$env:SOFTSKILLS_LLM_ENDPOINT = 'https://api.openai.com/v1/chat/completions'
```

## Run tests

```powershell
powershell -ExecutionPolicy Bypass -File .\web\tests\run-tests.ps1
```
## Share the admin panel publicly

Requirements:
- `cloudflared` must be installed
- keep the admin server window and tunnel process running while the reviewer is using the link

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\web\open-admin-share.ps1
```

The public admin link is saved to [share-admin-link.txt](D:/Projects/SOFTskills/web/share-admin-link.txt).`r`n`r`nThe share script now prints a friendly `/admin` URL.
