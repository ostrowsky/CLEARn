# Production Build Pipeline

## Goal

Production frontend and API builds run predictably on hosted CI/deploy platforms while preserving workspace dependency correctness.

## Scope

- Root and platform package manager configuration.
- Vercel static frontend build compatibility.
- Render/Fastify API deployment commands.
- Node version pinning for production hosts.
- npm/pnpm workspace compatibility for Vercel.
- Lockfile and workspace dependency alignment.
- Architecture and regression tests that verify deploy commands and environment preflight.

## User-visible behavior

- Vercel can deploy the static Expo web client from repository-tracked build metadata.
- The frontend install/build flow must not fail because hosted npm tooling cannot resolve workspace protocol dependencies directly.
- The API host can build and start the Fastify API from the platform workspace.
- Production API prebuild/environment verification remains active and fails deployment before runtime when required configuration is missing.
- Public previews can render bundled read-only content when the API is unreachable.
- AI generation, admin save, uploads, speech, backup, and provider-backed flows require a separate reachable API base URL. Ready ASK answer checks run locally in the browser.
- Build failures stop deployment instead of replacing a working production version.

## Invariants

- Production build commands must be tracked in Git.
- Hosted builds use Node 22.x consistently across the root manifest, platform manifest, and CI. Node 20 is no longer a supported Vercel build runtime.
- Workspace package dependencies must match lockfile expectations.
- npm (Vercel) and pnpm (CI/API) must apply the same security resolutions. Keep overrides and the lockfile aligned, preserve compatible dependency major versions where possible, and verify any required API changes through the full test suite.
- Temporary Vercel npm compatibility changes must not corrupt pnpm workspace dependency contracts.
- Client package dependencies needed by web export, including Expo linking support and query-string used by Expo Router, must be declared directly in client package metadata and the lockfile. The build must not rely on React Navigation to install an undeclared transitive dependency.
- Architecture tests must encode expected deploy command shape.
- Required production API environment verification must not be bypassed.
- Stateful API runtime concerns must remain separate from the static frontend deployment.

## Edge cases and failure policy

- If Vercel cannot install pnpm workspace dependencies directly, a compatibility script may prepare npm-compatible install state, but that path must be covered by tests.
- If package manager versions diverge between root and platform metadata, package files and lockfiles must be updated together.
- If required production API environment variables are absent, prebuild/startup must fail fast.
- If frontend configuration points interactive API calls at the static learner domain, production deployment should fail or block those interactive flows.
- If hosted Node versions change, tests and package metadata must be updated together.
- If the API deploy command changes, architecture tests must be updated in the same change set.

## Route / state / data implications

- Root `package.json` and `vercel.json` remain the frontend deployment entry points.
- `platform/package.json`, workspace package manifests, and lockfiles define install/build contracts.
- Render API deploy commands build and start the Fastify API from the platform workspace.
- Production environment checks protect stateful API routes, admin auth, backups, uploads, and interactive practice endpoints.
- The static frontend must not silently satisfy API requests through the SPA fallback.

## Verification mapping

- `web/tests/PlatformArchitecture.Tests.ps1`
- `web/tests/Backup.Tests.ps1`
- `platform/package.json`
- `package.json`
- `vercel.json`
- `render.yaml`
- `platform/pnpm-lock.yaml`
- `platform/apps/client/package.json`
- `platform/apps/api/package.json`

## Unknowns requiring confirmation

- Whether Vercel should stay on the npm compatibility path or return to native pnpm install once host support is stable.
- Expo 52 tooling uses tracked, idempotent import adapters for security-fixed image-size and decode-uri-component exports. Installations from npm and pnpm must apply these adapters and verify image decoding and URL parsing.
- Whether deploy preflight should run live smoke checks against both API and static frontend before promotion.
