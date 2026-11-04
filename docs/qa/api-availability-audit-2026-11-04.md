# API availability audit — 2026-11-04

> Historical audit at commit edd50e5. Follow-up fixes and current test evidence: api-remediation-2026-11-04.md. The original failures below are retained for provenance.

## Verdict
The Vercel frontend is available, but the separately hosted Render API is NOT healthy. Successful local CI and ready ASK validation did not prove speech/AI/admin availability. No runtime behavior, provider configuration, billing or production content was changed by this audit.

## Evidence and limits
- Base commit: edd50e5e4dbd0316d154cc5d0e26c85a47c4e7f0 (GA4 production release).
- Real production smoke at 2026-11-04T11:59:54.400Z: health, content and unauthenticated auth-status returned HTTP 503 with HTML rather than JSON and no credentialed CORS headers. Protected/admin/debug and speech OPTIONS probes returned HTTP 429/HTML at the edge during this check. This is NOT evidence that application authorization or provider code ran.
- Browser fetch can report a network/CORS TypeError rather than exposing the underlying HTTP 503. Adding CORS headers to app code cannot revive a suspended host whose response is generated outside the application.
- No production POST, learner audio, credentials, authenticated mutations, backup restore, YouTube fetch or paid model request was sent. Provider execution, Redis continuity and authorized admin persistence remain unverified on production.

## Why existing tests stayed green
1. CI Smoke API runtime starts a new API on 127.0.0.1:4099. It does not contact the Render production origin.
2. Many speech checks are static source-pattern tests; the paid live HF test is opt-in (RUN_HF_LIVE_STT_TESTS=1).
3. Previous ASK browser tests covered deterministic checking with all API calls deliberately failed, not Start recording -> Stop and transcribe.
4. The deployment preflight checks the configured URL, not its live health. Static fallback repairs intentionally must still be deployable during an API outage.
5. /api/health reports configured provider names. Even status=ok is not proof that speech/LLM providers, credentials, credits or Redis work.

## Findings, ranked

### P0 — All API-dependent production features are blocked by hosting outage
STT, TTS, server generation, authentication, saves, uploads, backups and transcript fetches depend on the API. The same browser message in the screenshot is reproducible as an STT failure. Ready local ASK checks and bundled media do not restore those capabilities. Host restoration/replacement is an operational decision, not a test fix.

### P1 — Invalid successful HTTP responses are accepted by 22 methods
platform/apps/client/src/lib/api.ts: request catches JSON parse failure as {}, then returns it as T for HTTP 200. A static-host SPA HTML page or empty JSON can be treated as successful auth/save/upload/restore/speech/generation. Content loading alone validates its payload. The strict malformed-response diagnostic FAILED with 44 observations across 2 response modes / 22 methods. These are 44 reproductions, not 44 independent root causes. No failure was reclassified as passing.

### P1 — Media backup buttons leak unhandled promise rejections
platform/apps/client/src/components/AdminMediaBackupControls.tsx has 3 direct fetch calls, bypassing request timeout/error handling. Browser fault injection into export and import produced two unhandled Failed to fetch errors. Auth polling repeats every 1500 ms and can overlap when requests hang. HTTP errors with a response use an alert, but network/CORS exceptions escape the click handlers. Full backup export opens a URL rather than reporting failure inline.

### P1 — STT has no API-outage fallback after recording
useSpeechDraft.ts prefers MediaRecorder when supported. Browser SpeechRecognition is chosen for codec/capture issues, not for a subsequent failed /api/speech/stt request. There are separate recording implementations in legacy Clarification and ANSWER; fixing only the shared hook would leave them inconsistent. Admin uploaded-file transcription also requires the API. Browser recognition cannot automatically transcribe an already-recorded file using this API.
Six learner screens were exercised with a fake microphone and injected STT 503: the draft was preserved and controls recovered, but transcription did not recover. This is graceful failure coverage, not speech readiness.

### P1 — Online-to-offline sessions silently lose context
respondAnsweringFallback and continueCoachFallback create a new blank local session if a server session ID is not in their in-memory fallback map. Both transition diagnostics FAILED: server-only session IDs and Project Zephyr context were lost. Starting offline and staying offline passes, so older fallback tests missed this transition. Also, the fallback uses generic coaching/heuristics and must not be presented as equivalent LLM evaluation.

### P2 — Debug transport is unbounded and production authorization is incompatible
sendDebugLog uses fetch without AbortSignal, credentials or response.ok handling. Production debug endpoints require an admin cookie, but ordinary learner logging cannot supply an authorized session. Every request adds start/end/exception/fallback debug calls; during an outage these create extra silent traffic. Calls from hooks/components add more. Healthy main operations do not prove debug delivery.

### P2 — Provider/server calls are not uniformly bounded
OpenAI/HF/self-hosted chat and OpenAI/HF speech fetches lack explicit operation AbortSignal timeouts. The registry tries providers sequentially only after rejection; a hung first provider prevents prompt fallback. Aborting the browser request does not cancel those backend model requests. Self-hosted speech and Browserless have fetch timeouts, while several direct YouTube calls are unbounded. This is source-reviewed evidence, not a live provider outage assertion.
The client STT timeout is 90000 ms, TTS 15000 ms, ordinary requests 5000 ms, transcript 30000 ms, admin auth/content 30000 ms, media/backup 120000 ms. The existing AI spec contains conflicting short-interactive versus cold-start timing requirements; choose one coherent policy before changing speech behavior.

### P2 — Admin media deletion suppresses backend failure
app/admin.tsx deleteUploadedAsset catches and discards every deletion error. A failed network deletion can be hidden from the operator. Reviewed statically; no real media was deleted during audit.

## Added verification (local, not yet pushed)
- web/tests/api-call-inventory.json: all 29 apiClient methods, each endpoint/policy/usage, direct client fetch bypasses, legacy network wrappers and all backend fetch files.
- web/tests/api-outage.test.mjs: 203 cases = 29 methods x 7 outage modes (503 HTML, fetch rejection, real AbortSignal path via accelerated clocks, 400, 401, 429, 500). Checks local/URL/no-op/fallback/reject policy, endpoint/method, credentials and signal; AST inventory guards new methods/routes/fetch boundaries. These passing cases validate current degradation, not live reachability.
- --probe-malformed: 58 strict cases, exit 1, 44 invalid-response observations (unfixed).
- --probe-sessions: exit 1, 2 online-to-offline continuity failures (unfixed).
- web/tests/api-outage.browser.cjs: 6 recording UI flows under synthetic 503, no real audio leaves browser. Drafts preserved; STT remains unavailable.
- --probe-admin-backup: exit 1, 2 unhandled network exceptions (unfixed).
- platform/scripts/check-production-api.mjs: real read-only health/content/auth/auth-protection/CORS smoke, exit 1 on current production state; JSON and Markdown evidence. No provider-readiness claim.
- web/tests/production-api-smoke.test.mjs: the probe itself rejects suspended/SPA/redirect/malformed/invalid-schema/missing-CORS/bad-preflight/headers-and-body-timeout hosts and passes a healthy local server.
- ApiAvailability.Tests.ps1 is in the default suite. Strict known-gap diagnostics are explicit failing commands, not expected-failure assertions or disabled assertions; they should become mandatory gates after the corresponding runtime fixes.
- .github/workflows/production-api-smoke.yml is prepared: manual and successful Production deployment triggers; separate from local CI, no schedule, no continue-on-error, uploads evidence. It has NOT been installed on GitHub yet.

## Reproduce
~~~sh
node web/tests/api-outage.test.mjs
node web/tests/production-api-smoke.test.mjs
node platform/scripts/check-production-api.mjs
node web/tests/api-outage.test.mjs --probe-malformed
node web/tests/api-outage.test.mjs --probe-sessions
node web/tests/api-outage.browser.cjs
node web/tests/api-outage.browser.cjs --probe-admin-backup
~~~
Browser commands require an exported web build and Playwright Chromium. The last four diagnostics are not a claim that live API/provider functionality works; the explicitly broken contracts should fail until fixed.

## Recommended next change (requires alignment)
1. Fix shared response validation and bounded errors; route all backup calls through it; stop silently swallowing admin failures and gate debug logging. Promote strict malformed/backup diagnostics to regression gates.
2. Choose session-outage semantics: keep a coherent local mirror or explicitly stop/restart rather than silently replace server context. Promote the transition diagnostic.
3. Decide voice policy: restore/replace the API, or offer explicit browser recognition where supported with typed input elsewhere. Do not switch speech providers silently or pretend browser recognition works offline/everywhere.
4. Publish the separate availability workflow; keep frontend-deploy success, API health, provider execution and fallback functionality as distinct statuses.

## Complete method inventory
| Method | Endpoint | Outage policy | Consumer |
|---|---|---|---|
| logDebug | POST /api/debug/log | best-effort | Internal debug logging |
| getDebugLogs | GET /api/debug/logs | reject | Developer diagnostics |
| getContent | GET /api/content | fallback | All learner pages / consent copy |
| getAdminContent | GET /api/admin/content | reject | Admin editor |
| getAdminAuthStatus | GET /api/admin/auth/status | reject | Admin login/status |
| setupAdminAuth | POST /api/admin/auth/setup | reject | Admin initial setup |
| loginAdmin | POST /api/admin/auth/login | reject | Admin sign in |
| resetAdminPassword | POST /api/admin/auth/reset-password | reject | Admin password reset |
| logoutAdmin | POST /api/admin/auth/logout | reject | Admin logout |
| saveAdminContent | POST /api/admin/content | reject | Admin save |
| uploadAdminMedia | POST /api/admin/media/upload | reject | Admin media upload |
| deleteAdminMedia | POST /api/admin/media/delete | reject | Admin delete (caller currently swallows error) |
| getVideoTranscript | GET /api/media/youtube-transcript-segment | fallback | Video transcript / admin transcript |
| getAdminBackupExportUrl | GET /api/admin/backup/export | url | Admin full backup (opens a new location) |
| restoreAdminBackup | POST /api/admin/backup/import | reject | Admin full restore |
| getAdminMediaBackupExportUrl | GET /api/admin/backup/media/export | url | Media backup URL helper (no direct callers) |
| restoreAdminMediaBackup | POST /api/admin/backup/media/import | reject | Media restore helper (current UI uses direct fetch) |
| generateClarify | POST /api/practice/clarify | reject | Generation helper (no current screen caller) |
| checkClarify | LOCAL (no network) | local | Clarification Check answer |
| askAfter | POST /api/practice/after-talk | fallback | Ask after the talk generation |
| checkAskAfter | LOCAL (no network) | local | Review question |
| generateQuestionFormation | POST /api/practice/question-formation | fallback | Question formation generation |
| checkQuestionFormation | LOCAL (no network) | local | Question formation Check correctness |
| startAnswering | POST /api/answering/session/start | fallback | ANSWER start |
| respondAnswering | POST /api/answering/session/respond | fallback | ANSWER submit |
| startCoachChat | POST /api/coach/session/start | fallback | Learning chat start |
| continueCoachChat | POST /api/coach/session/respond | fallback | Learning chat send |
| speechToText | POST /api/speech/stt | reject | Shared speech hook, legacy Clarification, ANSWER, admin upload STT |
| textToSpeech | POST /api/speech/tts | reject | TTS helper (no current screen caller) |

## Other network boundaries
- Client: 3 direct fetch calls in AdminMediaBackupControls (auth polling/export/import), in addition to the common API request/debug transports.
- Legacy web/static/app.js and admin.js wrappers were source-reviewed; they are not the deployed Expo runtime. They also have no uniform timeout and can coerce failed JSON parsing into {}.
- Backend: 3 chat provider files, 3 speech provider files, main routes and segmented-transcript routes contain fetch calls. Redis uses its own network client rather than fetch.
- Google/Vercel analytics, browser-native recognition, media/video elements and third-party embeds are separate network dependencies, not calls to the Fastify API. They were inventoried conceptually but no third-party uptime guarantee is inferred from this API audit.
