# Deployment Readiness

## Goal

The app can be hosted, tested, upgraded, backed up, and rolled back without discovering fatal errors only after a long deployment.

## Scope

- Git-based release checks.
- API and web build verification.
- Admin security gate.
- Environment configuration.
- Backup/restore and media persistence.

## User-visible behavior

- A release candidate must pass the full repository test suite before deployment starts.
- A release candidate must build the API and web client before deployment starts.
- Admin routes must not be publicly editable without authentication.
- Learner routes remain public unless commercial gating is explicitly enabled.
- Failed pre-deploy checks stop the release and do not replace the currently running version.
- Production API startup must fail fast when required security configuration is missing.
- Production debug endpoints must not expose runtime logs publicly.

## Invariants

- Deployment must be reproducible from Git plus environment variables plus persisted content/media storage.
- Secrets must come from hosting environment variables, not committed files.
- Runtime folders, caches, local model downloads, and temporary preview folders are not release artifacts.
- Public health checks must be cheap and must not call paid AI providers.
- Browser credentialed requests must be accepted only from configured origins in production.
- Dependency audit failures at high severity or above block production release candidates.

## Edge cases and failure policy

- If a required env var is absent in production, deployment should fail during preflight or startup instead of failing at first customer request.
- If production CORS origins are not configured, the API must refuse startup instead of reflecting arbitrary origins.
- Live paid-provider tests may be opt-in to avoid spending credits in every CI run, but non-live provider contract tests remain mandatory.
- Backup export must complete within hosting/proxy timeout budgets or move to an asynchronous job before production traffic.
- Backup/restore helpers must not hardcode Windows-only executables when the API can be hosted on Linux.

## Route / state / data implications

- `/api/health` remains public and safe for uptime checks.
- `/api/debug/logs` and debug write endpoints are development/staging tools and require admin authentication or are disabled in production.
- `/api/admin/*` requires an admin session except setup/login/status.
- Content and admin auth are local files in the MVP and should be moved to durable storage before paid traffic.

## Verification mapping

- `.github/workflows/ci.yml`
- `pnpm audit --prod --audit-level high`
- `web/tests/run-tests.ps1`
- `web/tests/PlatformAdmin.Tests.ps1`
- `web/tests/PlatformAdmin.Api.Tests.ps1`
- `web/tests/Backup.Tests.ps1`

## Unknowns requiring confirmation

- Target hosting provider and whether it supports persistent disk.
- Production database/object storage provider.
- Whether customer admin users need multi-user roles before launch.
