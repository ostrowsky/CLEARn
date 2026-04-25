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
- Question formation practice must check whether the learner's WH question is grammatical and targets the intended hidden detail.
- Generated exercises must remain workplace/IT-oriented and must not echo the learner context unnaturally.

## Invariants

- The user must never be forced to submit raw STT output without editing.
- The app must not accept obviously broken grammar as correct.
- The app must not turn an answering-practice reply into a question.
- Content timing and exercise parameters must be editable through admin metadata where they affect learner behavior.

## Edge cases and failure policy

- If live AI generation fails, deterministic fallback content may be used but must stay natural and context-aware.
- If STT fails, the learner must keep typed input as a fallback.
- If validation cannot confidently accept an answer, it should explain what to improve instead of marking it correct.

## Route / state / data implications

- Existing learner routes include `/practice/asking/after-talk`, `/practice/asking/clarify`, `/practice/answering/mixed`, and section-driven exercise rendering.
- Existing API routes include `/api/practice/*`, `/api/answering/session/*`, `/api/coach/session/*`, and `/api/speech/stt`.
- Exercise configuration belongs in `content.meta.practice` or section/block/material metadata.

## Verification mapping

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

