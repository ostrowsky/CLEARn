# API availability verification

## Goal
Separate code/build correctness from deployed API reachability and feature readiness. Never describe a green local CI or a static frontend deploy as proof that speech, AI or admin services are working.

## Contract
- Default offline regression tests cover every public apiClient method under 503 HTML, network rejection, abort, 400/401/429/500, plus local-only/URL/best-effort policies. An AST inventory must fail on a newly added unclassified API method, backend route mismatch or unlisted direct fetch boundary.
- A separate production smoke runs read-only GET and OPTIONS probes against the tracked API URL with the real learner Origin. It validates status, JSON shape and credentialed CORS, not merely TCP/HTTP success. HTML 200/503, malformed JSON, redirects, timeout, unauthorized public routes, and permissive/missing CORS fail the check.
- Live probes do not submit learner answers, audio, credentials or admin changes and do not invoke paid providers. STT/TTS/model execution and Redis-backed sessions remain explicitly unverified, even when basic API probes pass.
- Production smoke is distinct from the build gate, runs after a successful Production deployment and manually on workflow_dispatch. No recurring schedule is added. A failure must publish an explicit unhealthy summary; no continue-on-error or skipped-as-passed semantics. Static fallback repairs may still ship while the API is suspended.
- A bounded local fake HTTP server verifies the production probe itself against healthy, suspended, SPA HTML, broken JSON, wrong CORS and stalled hosts without calling production.
- A strict malformed-response diagnostic captures known runtime contract gaps separately; no expected-failure baseline should present those gaps as fixed.

## Non-goals
- Resume Render billing or silently change STT/LLM providers.
- Claim AI quality or availability from health/provider configuration strings.
- Change user-visible fallback semantics before agreement on the remedy.

## Verification
web/tests/ApiAvailability.Tests.ps1, web/tests/api-outage.test.mjs, web/tests/production-api-smoke.test.mjs, platform/scripts/check-production-api.mjs, .github/workflows/production-api-smoke.yml.

## Approved remediation
- Successful JSON responses must match endpoint contracts; invalid responses cannot mutate UI state. Availability fallback must not hide 400/401/403/404/422. Deadlines cover headers and body.
- Production debug is off by default; development opt-in is authenticated and bounded.
- All backup transport is shared, ZIP-validated and catches errors. Auth polls cannot overlap. Deletion failures remain visible.
- Server sessions must not be silently replaced with contextless local sessions. Preserve drafts on a recoverable error; offline-created sessions continue locally.
- When API is unavailable, browser speech recognition may be selected on the next explicit recording gesture where supported, with a repeat/type message. Never automatically reopen a mic after failed upload or claim to transcribe an existing file.
- Bound all provider fetches including body reads, with no new providers or changed billing. Promote the strict diagnostics to mandatory regressions.
