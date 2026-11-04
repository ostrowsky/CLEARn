# GA4 setup and verification

Stream: G-5EJ2691BS9, clearn.me. The public ID is tracked in Git; no secret or API/Render service is required. No new npm dependency.

## Required stream settings
- Enhanced measurement OFF (owner provided a screenshot confirming the toggle is off). Keep it off: manual SPA pageviews plus automatic history measurement would duplicate views and automatic form measurement is outside our payload allowlist.
- No second GA snippet in Vercel, Google Tag Manager or HTML. Existing Vercel Analytics is independent and unchanged.
- For event breakdowns, register event-scoped custom dimensions exercise_type and correct in GA4 Admin > Custom definitions. Historical data is not backfilled into a newly registered custom dimension.

## Production check after deployment
1. Open https://clearn.me in a fresh normal browser, with blockers disabled for the test. No Google tag should load before consent.
2. Select Allow analytics. Network must show one gtag/js?id=G-5EJ2691BS9 and collection requests to Google Analytics with tid=G-5EJ2691BS9.
3. Navigate to ASK and its three exercises. Each pathname transition must create one page_view; checking an answer creates answer_check with exercise_type and correct, revealing a hint creates hint_view.
4. In analytics.google.com > Reports > Realtime, check the visit/events. Detailed reports take longer. For DebugView use Google's Analytics Debugger/Tag Assistant; raw response status alone does not prove report ingestion.
5. Analytics settings > Decline analytics stops further collection and clears GA cookies; exercises still work. Verify admin routes produce no manual GA events.

## Privacy and limits
Basic consent only; no Google script before opt-in. Advertising consent stays denied. No learner answer, transcript, recording, raw error, admin data or user ID is sent. URL query/hash is removed except safe utm_source/utm_medium/utm_campaign codes. External referrers keep only their origin. Events that occurred before opt-in are not replayed. Choices expire in 180 days and can be changed via Analytics settings. Browser storage failure means the choice lasts only for the session. Localhost, preview domains and native applications do not load GA.

No promise of legal compliance is implied: the site owner must keep its privacy notice accurate. Consent Mode is not a substitute for a privacy notice.

## Automated evidence
- Full default repository suite, client TypeScript check and production web export passed on Node 22.
- Runtime tests passed for consent/expiry, denied storage/tag, SPA deduplication, safe URLs/payloads, withdrawal, admin/host exclusion and native no-op.
- Chromium passed opt-in/decline/reload, one tag, SPA and back views, correct/incorrect answer events, hint/start, admin/preview exclusion and mobile layout while the API returned HTTP 503.
- A second browser run used the real Google tag and intercepted outgoing collection requests with the expected stream ID. Test events were not delivered to Google; this proves transport generation, not dashboard ingestion.
- Mobile consent layout visually inspected at 390px. No new dependency or lockfile change.
