# Spec Backlog

## Product Map

- Learner app: section list, lesson sections, practice exercises, AI learning chat, STT-enabled text entry, media playback.
- Admin app: editable content tree, sections, blocks, materials, schema/runtime metadata, media uploads, backup/restore.
- API: content, admin save/upload/backup, practice generation/checking, answering sessions, coach chat, STT/TTS, debug logs.
- AI layer: provider chain for chat, STT, and TTS across self-hosted, Hugging Face, and OpenAI-compatible providers.
- Operations: local and Cloudflare preview scripts, local STT server, backup/restore scripts, PowerShell regression tests.
- Future commercial product: account identity, free preview, subscription entitlement, paid AI quota, mobile app distribution.

## First-Pass Specs Created

- `features/content-admin.md`
- `features/practice-exercises.md`
- `features/ai-provider-gateway.md`
- `features/commercial-subscriptions.md`
- `features/mobile-readiness.md`

## Next Specs To Create

- `deployment-and-operations.md`: production hosting, environments, preview links, smoke checks, observability, rollback.
- `security-and-privacy.md`: admin auth, learner accounts, rate limits, upload safety, secret handling, audit logs.
- `data-model-and-persistence.md`: Postgres schema, content versions, media object storage, session persistence, migrations.
- `testing-strategy.md`: unit/API/component/E2E/mobile smoke tests, live-provider test policy, CI gates.
- `backup-restore-and-content-versioning.md`: full app backup, content restore, media restore, rollback points.

## Unknowns Requiring Confirmation

- Preferred identity provider for commercial launch: Clerk, Supabase Auth, Auth.js, Cognito, or custom.
- Preferred billing provider: Stripe is the default recommendation unless there is a regional constraint.
- Whether admin must be available on mobile or should remain web-only.
- Whether customer content must be multi-tenant from the first paid release or can stay single-tenant during private beta.
- Data retention requirements for learner recordings, transcripts, AI feedback, and debug logs.
- Target first production host: managed PaaS, VPS, or cloud-native split hosting.

