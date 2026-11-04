# Practice Exercises

## Goal

Learners practise workplace English through structured exercises with text input, speech-to-text input, immediate validation, and clear coaching feedback.

## Scope

- Clarification audio exercises.
- Ask-after-talk follow-up question practice.
- Question formation practice.
- Answering mixed question sessions.
- Learning chat practice.
- Shared user input validation.

## Non-goals

- Full curriculum sequencing.
- Long-term learner progress analytics.
- Native app offline mode.

## User-visible behavior

- Every text-practice area allows typed input and, where supported, speech-to-text input.
- STT output must be editable before submission.
- Validation must reject meaningless text, answer leaks, malformed questions, and role-inappropriate output.
- Answering practice must keep the user's selected reaction phrase and improve only the answer body.
- Ask-after-talk practice can use either a generated short talk or a video material transcript as the source text.
- Ask-after-talk video materials must be selectable from a right-side video library and must use the same question builder pattern: selected Context phrase, learner-entered or dictated detail, and selected Could you phrase.
- Ask-after-talk validation must treat editable admin phrase-bank Context and Could you phrases as valid structure. It may reject the composed question only when the learner-entered middle detail is meaningless, off-topic, or makes the final sentence incoherent.
- Embedded practice videos must stop playing when the learner leaves the screen.
- Timestamped YouTube links with `start` and `end` query parameters must open at the start time and stop at the end time where the provider allows it.
- Question formation practice must check whether the learner's WH question is grammatical and targets the intended hidden detail.
- Question formation practice must always display a declarative workplace statement as the source sentence. It must never display a question as the sentence to ask questions about.
- Question formation practice must show exactly three meaningful target words or phrases for exactly three learner question rows. If generated content has fewer than three usable targets, it must be rejected and replaced by a valid fallback.
- Question formation practice must accept natural pronoun references to already visible details, for example `What will they review?` when the visible subject is `Stakeholders`.
- Question formation practice must reject malformed WH questions such as object questions without an auxiliary verb, for example `What they review?`.
- Generated exercises must remain workplace/IT-oriented and must not echo the learner context unnaturally.

## Invariants

- The user must never be forced to submit raw STT output without editing.
- The app must not accept obviously broken grammar as correct.
- The app must not turn an answering-practice reply into a question.
- Content timing and exercise parameters must be editable through admin metadata where they affect learner behavior.

## Edge cases and failure policy

- Ready ASK exercise checks (Clarification, Ask after the talk, and Question formation) run immediately in the browser without sending validation or debug requests to the API. Checking must not wait for a failed request or timeout.
- The browser and API use the same deterministic validators, including configured alternatives, contraction/punctuation normalization, rejection of meaningless input, phrase-bank handling, grammar checks, and hidden-answer leak checks. API validation endpoints remain available for other clients.
- Browser ASK feedback uses the latest loaded content configuration with bundled defaults. Infrastructure failure never causes an answer to be accepted automatically. Content or exercise generation may use the API independently; AI generation, STT, admin saves and server persistence are not replaced by local answer validation.

- If live AI generation fails, deterministic fallback content may be used but must stay natural and context-aware.
- If STT fails, the learner must keep typed input as a fallback.
- If validation cannot confidently accept an answer, it should explain what to improve instead of marking it correct.

## Route / state / data implications

- Existing learner routes include `/practice/asking/after-talk`, `/practice/asking/clarify`, `/practice/answering/mixed`, and section-driven exercise rendering.
- Existing API routes include `/api/practice/*`, `/api/answering/session/*`, `/api/coach/session/*`, and `/api/speech/stt`.
- Exercise configuration belongs in `content.meta.practice` or section/block/material metadata.
- Video-library sources for ask-after-talk are regular `video` materials on `practice-ask-after` blocks, with transcript text in material metadata where available.

## Verification mapping

- `web/tests/PlatformAskValidation.Tests.ps1` (zero validation network requests, online/offline invariance, negative cases, configured feedback, and server/browser parity).
- `node web/tests/ask-validation.browser.cjs` after web export (three ASK screens, desktop/mobile, API HTTP 503, zero validation requests).

- `web/tests/PlatformQuestionFormation.Tests.ps1`
- `web/tests/PlatformQuestionFormation.Api.Tests.ps1`
- `web/tests/PlatformClarify.Tests.ps1`
- `web/tests/PlatformClarify.Api.Tests.ps1`
- `web/tests/PlatformAnswering.Tests.ps1`
- `web/tests/PlatformCoach.Tests.ps1`
- `web/tests/PlatformInputValidation.Tests.ps1`
- `web/tests/PlatformInputValidation.Api.Tests.ps1`

## Unknowns requiring confirmation

- Whether learner attempts and scores must be persisted for paid users.
- Whether teacher/admin review of learner transcripts is required.
