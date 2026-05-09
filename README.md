# CLEARn 

Shared web and mobile-oriented prototype for workplace English practice. The app is content-driven: learner copy, admin labels, practice settings, watermark text, blocks, materials, media metadata, and exercise configuration are stored in editable content data and managed through the admin UI.

## Repository Layout

- `platform/apps/client` - Expo Router web client intended to stay portable to iOS and Android.
- `platform/apps/api` - Fastify API for content, admin operations, practice sessions, speech, media, and backups.
- `platform/packages/contracts` - shared API contracts.
- `platform/packages/domain` - shared domain types.
- `web/data` - editable prototype content and template content.
- `web/tests` - PowerShell regression tests used by CI and preview startup.
- `docs/specs` - spec-first product and deployment behavior.

## Requirements

- Node.js 22 for CI parity.
- pnpm `10.8.0`.
- PowerShell 7 or Windows PowerShell for the current regression suite.
- Optional local STT service for speech-to-text testing and development.

## Setup

```powershell
cd platform
pnpm install --frozen-lockfile
```

Copy `platform/.env.example` to your local environment configuration if needed. Production must set:

- `ADMIN_SESSION_SECRET` - strong non-placeholder secret, at least 32 characters.
- `CORS_ALLOWED_ORIGINS` - comma-separated public web origins allowed to send credentialed API requests.
- Persistent paths/storage for content, admin auth, uploads, and backups.

## Development

Run the API:

```powershell
cd platform
pnpm --filter @softskills/api start
```

Run the client:

```powershell
cd platform
pnpm --filter @softskills/client start
```

For public customer previews, use the existing Cloudflare preview script from `platform`.

## Tests And Build

Run the full regression suite:

```powershell
powershell -ExecutionPolicy Bypass -File .\web\tests\run-tests.ps1
```

Run the production build:

```powershell
cd platform
pnpm build
```

GitHub Actions runs install, the full PowerShell test suite, build, and an API runtime smoke check before changes are considered deployable.

Production dependency audit:

```powershell
cd platform
pnpm audit --prod --audit-level high
```

## Admin Access

On first admin entry, the app asks for:

- login
- password
- password confirmation
- recovery email

Admin credentials are stored as a salted PBKDF2 hash, not as plain text. The runtime auth file is ignored by git. In production, move admin credentials and sessions to managed persistent storage or an identity provider.

## Deployment Notes

The current project is ready for staged hosting as a pre-production prototype after CI passes. Before commercial production, migrate local JSON/media/auth storage to managed services:

- database for content, users, subscriptions, and admin identity
- object storage for uploaded media and backups
- secrets manager for provider tokens and session secrets
- HTTPS-only cookies and locked-down CORS
- staging environment with smoke checks for public learner/admin/API URLs

See `docs/specs/features/deployment-readiness.md` for the deployment contract.
