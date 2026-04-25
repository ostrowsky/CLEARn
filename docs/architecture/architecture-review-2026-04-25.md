# Architecture Review - 2026-04-25

## Executive Summary

SOFTskills has a strong MVP foundation for rapid product discovery: a TypeScript monorepo, Expo client, Fastify API, shared domain/contracts, content-driven runtime, provider abstraction for AI, and broad regression tests. This is a good direction for future web/mobile reuse.

The main architectural risk is that the project is still halfway between prototype and production. The new `platform/` stack coexists with the legacy `web/` stack, production services are declared but not fully used, persistence is mostly filesystem-based, admin access is public in previews, and deployment is based on local processes plus Cloudflare quick tunnels. That is acceptable for customer validation, but not for a commercial subscription product.

## Current Strengths

- Shared TypeScript domain and contract packages reduce drift between API, web, and future mobile clients.
- Expo + React Native Web is a sensible choice for eventual iOS/Android reuse.
- Fastify API is lightweight and can scale horizontally once persistence moves out of local files.
- Content-driven admin and learner rendering reduce hardcoded product copy and exercise structure.
- AI provider abstraction already supports self-hosted, Hugging Face, and OpenAI-compatible paths.
- Local STT gives a free fallback when hosted inference credits are depleted.
- Existing PowerShell tests cover many API, content, admin, speech, and practice regressions.
- Backup/restore scripts exist, which is valuable during fast prototype iteration.

## Critical Gaps

- `web/` and `platform/` both remain active sources of truth. This increases regression risk and makes specs/tests harder to reason about.
- Content and media storage use local JSON/filesystem paths under `web/`, while `platform/infra` declares Postgres, Redis, and MinIO that are not yet the production persistence layer.
- Admin routes are not protected by authentication, authorization, CSRF protection, or audit logging.
- Commercial concepts are missing: accounts, roles, subscriptions, entitlements, trials, quota, billing webhooks, and plan-based feature access.
- AI calls lack production-grade cost controls: per-user quota, request budgets, retry policy, caching, provider observability, and paid-provider routing.
- Cloudflare quick tunnels are useful for customer previews but are not a deployment model.
- Local STT startup and model warmup can delay preview startup and should become an optional service with readiness checks and background loading.
- Tests are extensive but mostly script-based; package-level `test` scripts are placeholders and there is no clear CI gate.
- Debug logs can contain user content and provider errors; they need retention limits, redaction, and role-based access before production.
- CORS currently allows broad origins with credentials, which is risky outside local preview.

## Performance

- The client fetches full content from `/api/content`; this is simple but will become inefficient as lessons/media grow.
- JSON file writes are fine for MVP but unsafe for concurrent admin edits and horizontal API scaling.
- Local STT warmup can dominate preview startup. Keep it optional, cache model downloads, and avoid blocking non-STT previews.
- AI generation should use short prompts, structured outputs, provider timeouts, and cached deterministic fallbacks for common exercises.

## Scalability

- Move content to Postgres with versioned content snapshots and optimistic locking.
- Move uploads to S3-compatible storage, starting with MinIO locally and a managed bucket later.
- Keep Redis for session state, but add TTL policy by feature and environment.
- Add a job queue for slow STT/TTS/media processing if recordings become longer or mobile traffic grows.
- Introduce tenant/account IDs in all durable entities before the paid product, even if the first release is single-tenant.

## Reliability

- Add `/api/ready` that checks content store, Redis, object storage, and optional AI providers separately.
- Add provider circuit breakers and clear fallback policy: built-in deterministic fallback, self-hosted, free hosted, paid hosted.
- Separate live-provider tests from normal regression tests so depleted credits do not block local startup.
- Add content version rollback independent from full app restore.
- Replace quick-tunnel preview smoke tests with reusable health checks that also run in CI.

## Security

- Add admin authentication before any broader customer testing.
- Add roles: owner, admin/editor, learner, anonymous preview.
- Add entitlement checks to protected lesson and AI endpoints.
- Restrict CORS per environment.
- Add upload validation: size, extension, MIME sniffing, malware scan hook, object-store path isolation.
- Redact secrets and sensitive learner content from logs.
- Never store raw provider tokens in content or client-visible config.

## Deployment

- Keep `start-cloudflare-preview.bat` only as a demo/preview tool.
- Add production Dockerfiles for API and local AI services.
- Deploy web client to a static host/CDN and API to a managed service or container host.
- Use managed Postgres, Redis, object storage, and secrets manager for paid production.
- Add CI stages: install, typecheck, unit/API tests, content schema tests, build, smoke tests.

## Mobile Readiness

- Expo is the right foundation, but web-only assumptions must be isolated.
- Move browser APIs such as `MediaRecorder`, web file pickers, and admin-specific behaviors behind platform adapters.
- Treat admin as web-only unless there is a clear mobile admin requirement.
- Use native audio permissions and file APIs for iOS/Android STT upload flows.
- Keep all learner practice logic in shared components, with platform-specific wrappers only where needed.

## Recommended Roadmap

### Stabilize MVP

- Adopt `docs/specs/` as the behavior source of truth.
- Keep fast preview startup by default and run live-provider tests only on demand.
- Remove or archive stale `tmp-platform-*` directories outside the repo path.
- Add admin auth for shared previews.
- Add production-like smoke checks for `/api/health`, `/api/content`, `/sections`, and `/admin`.

### Production Foundation

- Implement Postgres content store, S3/MinIO media store, and content versioning.
- Add identity, roles, entitlement middleware, and audit logs.
- Add AI gateway quotas, provider routing, timeouts, request metrics, and fallback reporting.
- Add CI and environment-specific deployment configs.

### Commercial Version

- Add free preview course/section gating.
- Add subscription plans and Stripe webhook handling.
- Add learner account state: progress, attempts, scores, saved transcripts, and subscription entitlement.
- Add admin publishing workflow: draft, preview, publish, rollback.
- Add provider plan routing: free users use cached/local/low-cost paths; paid users can use higher-quality paid providers.

