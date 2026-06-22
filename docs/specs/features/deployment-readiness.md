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
- Vercel may host the static Expo web client when `EXPO_PUBLIC_API_BASE_URL` points to the production API host.
- The static Expo web client must load Vercel Analytics on every route so production page views can be counted after deployment.
- If a static Vercel preview has no reachable API, the public learner home must still render from the bundled read-only content snapshot instead of showing a raw fetch failure.
- The canonical public learner entry point is `/`; legacy `/sections` links may redirect to `/`.
- Static Vercel builds must include the uploaded learner media referenced by bundled content so read-only videos and audio can play without the API upload server.
- Production Vercel builds for interactive practice must fail before deployment when `EXPO_PUBLIC_API_BASE_URL` is missing or points back to the static learner domain.
- The production API must have a Git-tracked hosting blueprint with health checks, persistent storage, and Redis session storage configured through environment variables.
- Admin routes must not be publicly editable without authentication.
- Learner routes remain public unless commercial gating is explicitly enabled.
- Failed pre-deploy checks stop the release and do not replace the currently running version.
- Production API startup must fail fast when required security configuration is missing.
- Production debug endpoints must not expose runtime logs publicly.
- Production content, uploaded media, and admin authentication data must use durable storage outside the Git checkout.

## Invariants

- Deployment must be reproducible from Git plus environment variables plus persisted content/media storage.
- Secrets must come from hosting environment variables, not committed files.
- Runtime folders, caches, local model downloads, and temporary preview folders are not release artifacts.
- Public health checks must be cheap and must not call paid AI providers.
- Browser credentialed requests must be accepted only from configured origins in production.
- Dependency audit failures at high severity or above block production release candidates.
- `APP_STORAGE_ROOT` may point at a persistent volume and becomes the base for `content.json`, `admin-auth.json`, and uploaded media unless the three paths are explicitly overridden.
- The repository root must keep Vercel-discoverable build metadata for the frontend: root `package.json`, root `vercel.json`, build command, and output directory.
- Vercel Analytics must be wired through the Expo/React client shell, not through a Next.js-only layout, because the frontend is an Expo Router static export.
- Pull requests must include the `pr-description` skill sections: `What`, `Why`, and `Changes`.
- Static hosting must not assume an API is available on `:4000` for non-local web domains.
- Public Cloudflare preview builds must honor `EXPO_PUBLIC_API_BASE_URL` so the preview admin talks to the matching public API tunnel rather than production API or browser-local `localhost`.
- Public Cloudflare preview admin sessions must use cross-site secure cookies because the web preview and API tunnel are different public origins.
- Interactive AI, STT, TTS, admin save, backup, and upload flows require a separately hosted API; they must not silently fall through to the static SPA route.
- Development admin sessions must remain usable on local HTTP preview origins even if the developer shell contains production HTTPS URL values.

## Edge cases and failure policy

- If a required env var is absent in production, deployment should fail during preflight or startup instead of failing at first customer request.
- If production CORS origins are not configured, the API must refuse startup instead of reflecting arbitrary origins.
- If production storage still points at repository-local default files, the API must refuse startup instead of losing edits on redeploy.
- If production Redis still points at the local development default, the API must refuse startup instead of accepting chat/answering sessions that cannot persist.
- If local development inherits production URL variables, admin cookies must still be issued as local HTTP-compatible cookies so authenticated admin actions remain available after login.
- Live paid-provider tests may be opt-in to avoid spending credits in every CI run, but non-live provider contract tests remain mandatory.
- Backup export must complete within hosting/proxy timeout budgets or move to an asynchronous job before production traffic.
- Backup/restore helpers must not hardcode Windows-only executables when the API can be hosted on Linux.

## Route / state / data implications

- `/api/health` remains public and safe for uptime checks.
- `/api/debug/logs` and debug write endpoints are development/staging tools and require admin authentication or are disabled in production.
- `/api/admin/*` requires an admin session except setup/login/status.
- Content and admin auth are local files in the MVP and should be moved to durable storage before paid traffic.
- The Fastify API, local STT, backups, and mutable media are stateful runtime concerns and should not be deployed as a plain static Vercel frontend.

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
