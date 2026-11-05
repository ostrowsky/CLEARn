# GA4 setup and verification

Stream: G-5EJ2691BS9, clearn.me. The public ID is tracked in Git; no secret or API/Render service is required. No new npm dependency.

## Required stream settings
- Enhanced measurement OFF (owner provided a screenshot confirming the toggle is off). Keep it off: manual SPA pageviews plus automatic history measurement would duplicate views and automatic form measurement is outside our payload allowlist.
- No second GA snippet in Vercel, Google Tag Manager or HTML. Existing Vercel Analytics is independent and unchanged.
- For event breakdowns, register event-scoped custom dimensions exercise_type and correct in GA4 Admin > Custom definitions. Historical data is not backfilled into a newly registered custom dimension.

## Closed test with previously obtained consent (2026-11-05)
The owner confirmed that this is a closed test and participants already gave valid analytics consent. Vercel build configuration sets EXPO_PUBLIC_ANALYTICS_CONSENT_MODE=preconsented. This is a public build flag, not a secret and not an authentication gate. Restrict the deployment to those participants and retain consent records separately before enabling the mode. The flag must not be used to collect from an unrestricted public audience on the assumption that a prototype is exempt.

On a fresh participant browser, the initial learner view loads one Google tag and sends one sanitized page_view without a consent banner. Analytics settings stay available for withdrawal. An existing valid declined choice is NOT overwritten: a participant must explicitly allow collection again via settings. No automatic grant is persisted; blocking storage does not prevent use of already obtained prior consent for that session.

Rollback: remove EXPO_PUBLIC_ANALYTICS_CONSENT_MODE from vercel.json and any Vercel project environment override, then rebuild/redeploy with the tracked build command (expo export --platform web --clear). The clear flag prevents a cached preconsented bundle from surviving the mode switch. Public opt-in becomes the default again. No GA tag may load without a valid explicit browser grant in that mode. Native, localhost, previews, admin exclusion, payload restrictions and advertising-denied settings are unchanged. Enhanced measurement must remain OFF.

## Production check after deployment (default/public mode)
1. Open https://clearn.me in a fresh normal browser, with blockers disabled for the test. No Google tag should load before consent.
2. Select Allow analytics. Network must show one gtag/js?id=G-5EJ2691BS9 and collection requests to Google Analytics with tid=G-5EJ2691BS9.
3. Navigate to ASK and its three exercises. Each pathname transition must create one page_view; checking an answer creates answer_check with exercise_type and correct, revealing a hint creates hint_view.
4. In analytics.google.com > Reports > Realtime, check the visit/events. Detailed reports take longer. For DebugView use Google's Analytics Debugger/Tag Assistant; raw response status alone does not prove report ingestion.
5. Analytics settings > Decline analytics stops further collection and clears GA cookies; exercises still work. Verify admin routes produce no manual GA events.

## Privacy and limits
Public mode uses basic consent; no Google script before opt-in. Explicit closed-test mode uses the separately obtained prior consent described above. Advertising consent stays denied. No learner answer, transcript, recording, raw error, admin data or user ID is sent. URL query/hash is removed except safe utm_source/utm_medium/utm_campaign codes. External referrers keep only their origin. Events that occurred before opt-in are not replayed. Choices expire in 180 days and can be changed via Analytics settings. Browser storage failure means the choice lasts only for the session. Localhost, preview domains and native applications do not load GA.

No promise of legal compliance is implied: the site owner must keep its privacy notice accurate. Consent Mode is not a substitute for a privacy notice.

## Automated evidence
- Full default repository suite, client TypeScript check and production web export passed on Node 22.
- Runtime tests passed for consent/expiry, denied storage/tag, SPA deduplication, safe URLs/payloads, withdrawal, admin/host exclusion and native no-op.
- Chromium passed opt-in/decline/reload, one tag, SPA and back views, correct/incorrect answer events, hint/start, admin/preview exclusion and mobile layout while the API returned HTTP 503.
- A second browser run used the real Google tag and intercepted outgoing collection requests with the expected stream ID. Test events were not delivered to Google; this proves transport generation, not dashboard ingestion.
- Mobile consent layout visually inspected at 390px. No new dependency or lockfile change.


## Closed-test verification evidence (2026-11-05)
- Default repository suite passed, including GA4 runtime tests and API-outage regressions. Paid live STT and the opt-in visual baseline suite remained skipped by their existing environment gates. Client TypeScript check passed.
- Chromium checked the closed-test export on desktop/mobile with an unavailable API: automatic initial view without a banner, one tag, SPA/back navigation, exercise_start, both answer_check outcomes, hint_view, safe payloads, persistent refusal/withdrawal and admin/preview exclusion passed. A run using the real Google tag generated page and exercise collection requests; collectors were intercepted before delivery to Google. This verifies request generation, not report ingestion.
- A mode-switch experiment without clearing Metro reproduced a stale closed-test bundle in a nominally public export (the public-mode banner assertion failed). Production builds now include --clear, with a matching build-contract regression test. A clean public export then passed the browser opt-in/decline/SPA/action suite. The normal closed-test build uses the same cache-clearing command.
- After the build-command change, VercelAnalytics.Tests.ps1, google-analytics.test.mjs, PlatformBuildPipeline.Tests.ps1 and Architecture.Tests.ps1 passed again. No deployment or production dashboard ingestion is claimed by these local checks.

Reproduce on Node 22 with installed platform dependencies: build the client with EXPO_PUBLIC_ANALYTICS_CONSENT_MODE=preconsented, then run node web/tests/google-analytics.browser.cjs with GA4_PRECONSENTED=1. Optionally set GA4_REAL_TAG=1; collection remains intercepted. For public-mode verification, remove the build flag, export with --clear and run the same browser test without GA4_PRECONSENTED. GA4_TEST_DIST selects an alternate export directory relative to the repository root, allowing public and closed-test exports to be tested without overwriting each other.
