# Web analytics (GA4)

## Goal
Measure learner acquisition, page navigation and exercise interactions without sending learner content to analytics.

## Behavior
- Web production hosts clearn.me and www.clearn.me use GA4 stream G-5EJ2691BS9. Localhost, previews and native apps send no GA4 traffic.
- Default/public mode: do not load Google scripts or send any Google events before explicit analytics consent. Accept and decline are equally accessible; a persistent Analytics settings control allows withdrawal. Consent expires after 180 days. A declined choice must not block exercises.
- Closed-test mode: only an explicit build setting EXPO_PUBLIC_ANALYTICS_CONSENT_MODE=preconsented enables collection without a new consent prompt, based on the owner-confirmed prior consent of the restricted test participants. This is not a consent exemption or an access-control mechanism. The operator must restrict access and retain valid prior-consent records before deployment. Unset, misspelled or other values keep public opt-in mode.
- In closed-test mode a missing/expired browser choice falls back to prior consent, without saving an automatic grant to localStorage. An existing valid refusal still blocks collection; Analytics settings remain available for withdrawal or an explicit change. Returning to public mode does not inherit an automatic closed-test grant.
- Consent copy and its font sizes are editable with Home interface text in admin, using bundled defaults when the API is down.
- Send one manual page_view per learner pathname transition, including back/forward; ignore repeated renders. Exclude admin routes. Disable automatic initial pageviews with send_page_view:false. The owner must disable Enhanced measurement (including history/form tracking) in the GA4 web stream to prevent duplicates and automatic form collection.
- Preserve only allowlisted UTM source/medium/campaign identifiers for acquisition (short alphanumeric campaign codes); strip other query parameters, hash, URL credentials and external referrer path/query. Never send answers, prompts, transcripts, audio, error messages, user IDs or admin content.
- Events: exercise_start on a successfully loaded practice round (or first clarification check), answer_check with exercise_type and correct boolean, hint_view on explicit hint/expected-answer reveal. Types are clarification, ask_after_talk, question_formation. Events while consent is absent or denied are discarded, not replayed. Closed-test prior consent permits initial pageviews and exercise events without a banner click.
- No automatic completion metric: a single accepted answer does not imply completion of a multi-question exercise.
- Google advertising storage/user-data/personalization remain denied; Google Signals and ad personalization are disabled.
- Blockers, script failure or unavailable storage must never break navigation or checking answers. Withdrawal stops collection immediately, removes GA cookies on known current/parent domains, and clears pending commands; already sent events cannot be recalled.

## Verification
- Node runtime tests cover public opt-in and explicit closed-test prior consent, refusal preservation, mode rollback, expiry, denied storage, host/admin exclusion, safe payloads, SPA deduplication, withdrawal and native no-op behavior.
- Chromium checks verify no Google requests before public-mode consent and automatic initial tracking without a prompt in closed-test mode, one script after consent, SPA views, action events, decline/revoke, and API-unavailable behavior. Test collection is intercepted and not sent to real GA.
- Client typecheck, production web export and default repository suite must pass.

## Operations
See docs/qa/google-analytics-setup.md for stream settings and Realtime/DebugView verification. Analytics does not depend on Render.
