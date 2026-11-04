# API outage remediation — 2026-11-04

Follow-up to api-availability-audit-2026-11-04.md. The audit and production evidence remain historical observations, not claims about the fixed code.

## Stage 1: JSON transport and debug
Endpoint-specific guards reject HTML200, malformed/empty JSON and invalid DTOs. Request deadlines include response bodies and preserve error status. Auth/input errors no longer silently turn into generated fallback success. Content can still use its snapshot. Production debug is disabled; development opt-in has credentials and a 2s deadline. Malformed-response diagnostic now passes and is mandatory.

## Stage 2: admin/backups
The media control no longer performs direct fetch or polls auth separately from its parent. Both full/media export use the shared bounded binary path, check ZIP signature and sanitize filenames without copying the whole archive to inspect the header. Restore uses checked JSON. All three network failure actions are handled and shown in admin status; no unhandled rejection. Failed deletions are visible and abort the UI removal. Multi-file deletes are not a transactional server operation: previously completed deletions cannot be rolled back by client code.

## Stage 3: sessions
Existing server sessions never become new blank offline sessions. Their request failure is propagated and UI preserves the draft. Local sessions continue without submitting their IDs to the server. The online-to-offline diagnostic now passes and is mandatory. Built-in ANSWER feedback is labelled as illustrative rather than a live AI evaluation.

## Stage 4: speech
Known API unavailability selects browser recognition on the next Start gesture where supported. A failed existing upload shows editable repeat/type guidance, not a promise to recover the file. No automatic re-opening of microphone. All three recording implementations share transcript aggregation and availability policy; UI errors release their controls. Unmount cleanup detaches upload callbacks. A mocked browser recognizer verifies plumbing; real browser/provider recognition quality and uptime are not asserted.

## Stage 5: server/legacy requests
Provider fetches buffer their non-streaming response inside a bounded deadline and cap response size at 32 MiB. Direct transcript requests have bounded fetches and a 25s overall budget. Serialized browser-side transcript code is unchanged. Redis connect/command operations are bounded and offline queuing disabled. Legacy web wrappers use a shared strict JSON/deadline helper; legacy OpenAI PowerShell calls have a timeout. Provider order, keys, models and billing are unchanged. Interactive STT is 20s, TTS 15s; regular AI generation is 15s; cold services exceeding that budget fail rather than hang the learner.

## Stage 6: verification and release
- Full default repository suite passed locally, including 203 outage cases, strict malformed/session tests, positive DTO/binary tests and real header/body/total-deadline tests.
- Client typecheck, API build and production web export passed.
- Browser tests passed: 6 unsupported-recognizer flows preserve drafts on STT503; 6 supported-recognizer flows obtain a mocked transcript with zero STT requests; 6 recognition-error flows recover controls; 3 admin backup actions have no unhandled network exception.
- These browser outage cases are now required in GitHub CI after web export. No paid/live AI calls are part of those tests.
- Production availability is a separate read-only deployment/manual workflow with honest nonzero failure. API health cannot prove provider execution.
- Production Render remains suspended; restoring billing or replacing the host is outside this patch. Admin writes, uploaded-file STT, TTS, server sessions, real models and mutable storage still need a working API.

Hosted CI/deployment and post-deploy evidence are reported in the chat after publication; no success is inferred from local tests alone.
