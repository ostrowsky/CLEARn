# Production Hosting Plan

## Recommended Target

Use Vercel for the static Expo web frontend and Render for the Fastify API.

This split is intentional:

- Vercel is a good fit for the static web client built from `platform/apps/client`.
- The API is stateful today: content, uploaded media, admin auth, local STT, backup/restore, and Redis-backed sessions need a long-running Node runtime and durable storage.
- Render supports a persistent disk for `APP_STORAGE_ROOT`, background-compatible Node processes, and simple GitHub deploys gated by CI.

## Vercel Frontend

Project settings:

- Framework preset: `Other`.
- Install command: `cd platform && npm install --legacy-peer-deps`.
- Build command: `cd platform && npm run --workspace @softskills/client build`.
- Output directory: `platform/apps/client/dist`.
- Required environment variable: `EXPO_PUBLIC_API_BASE_URL=https://api.clearn.example`.

The Vercel build intentionally fails if `EXPO_PUBLIC_API_BASE_URL` is missing or points back to the static frontend host. Without the API host, admin setup returns `405`, AI generation/STT/TTS cannot run, and upload/backup endpoints are unavailable.

For a deliberately read-only static preview, set `ALLOW_STATIC_ONLY_PREVIEW=1`. Do not use that setting for production because it disables the deployment guard rather than providing the API.

The frontend build copies `web/data/content.json` and `web/static/uploads` into the Expo web export so public learner content and referenced media can load before the production API is connected.

Root files used by Vercel:

- `package.json`
- `vercel.json`

Keep `vercel.json` intentionally simple: no `framework` override and a single SPA fallback rewrite to `index.html`. Complex regex rewrites or a nullable framework override can fail early in Vercel config validation before the build starts.

## Render API

Service type:

- Web Service.
- Runtime: Node 22.
- Root directory: repository root.
- Build command: `cd platform && npm install --legacy-peer-deps && npm run --workspace @softskills/api build`.
- Start command: `cd platform/apps/api && node ../../node_modules/tsx/dist/cli.mjs src/index.ts`.

Persistent disk:

- Mount path: `/var/lib/clearn`.
- Environment: `APP_STORAGE_ROOT=/var/lib/clearn`.

Required production secrets:

- `APP_ENV=production`
- `APP_BASE_URL=https://api.clearn.example`
- `CORS_ALLOWED_ORIGINS=https://clearn.example,https://www.clearn.example`
- `ADMIN_SESSION_SECRET`
- `APP_STORAGE_ROOT=/var/lib/clearn`
- `REDIS_URL`
- `EXPO_PUBLIC_API_BASE_URL=https://api.clearn.example` for frontend builds

See `platform/.env.production.example`.

## Branch Protection

Protect `main` before enabling automatic production deploys.

Required status checks:

- `test-and-build`
- `linux-build-smoke`
- `validate-pr-description`

Recommended settings:

- Require a pull request before merging.
- Require status checks to pass before merging.
- Require branches to be up to date before merging.
- Restrict force pushes.
- Restrict deletions.
- Include administrators if you want maximum safety.

GitHub CLI command, after `gh auth login` with repository administration rights:

```powershell
gh api --method PUT repos/ostrowsky/CLEARn/branches/main/protection `
  -H "Accept: application/vnd.github+json" `
  --input .github/branch-protection-main.json
```

## Deployment Gate

Deploy only after GitHub Actions completes successfully on the branch or PR. Vercel and Render should both be connected to GitHub and configured not to deploy failed commits.
