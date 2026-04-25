# AI Provider Gateway

## Goal

The product can use free AI resources during prototype and early validation, while remaining ready to switch to paid or self-hosted providers for quality, reliability, scale, and commercial traffic.

## Scope

- Chat/LLM generation and feedback.
- Speech-to-text.
- Text-to-speech.
- Provider fallback chains and error reporting.
- Cost and quota controls.

## Non-goals

- Training custom models.
- Enterprise data residency guarantees in the MVP.
- Replacing all deterministic validation with AI.

## User-visible behavior

- If the preferred provider fails, the learner receives either a usable fallback response or a clear recoverable error.
- STT must support browser/mobile audio formats through normalization or provider-compatible uploads.
- Paid-quality providers can be enabled without changing learner UI behavior.
- Provider errors should be visible to operators but not overwhelm learners.

## Invariants

- No provider token may be exposed to the client.
- Provider failures must not crash learner screens.
- Free provider credit exhaustion must not block local development or non-STT flows.
- Deterministic checks should protect critical exercise correctness where possible.

## Edge cases and failure policy

- Hosted provider returns 402/429: switch to configured fallback or show a clear quota/provider message.
- Self-hosted STT is unavailable: typed input remains available.
- LLM returns malformed JSON: sanitize, retry once if safe, or use deterministic fallback.
- Long-running STT/TTS should use timeout and progress messaging.

## Route / state / data implications

- Current env variables configure `LLM_TEXT_PROVIDER`, `LLM_STT_PROVIDER`, `LLM_TTS_PROVIDER`, provider models, fallback chain, and self-hosted base URLs.
- Production should add per-user quota tables, provider request logs, and plan-based routing.
- Live provider tests should be opt-in and excluded from default preview startup.

## Verification mapping

- `web/tests/PlatformAiStack.Tests.ps1`
- `web/tests/PlatformSpeech.Tests.ps1`
- `web/tests/PlatformFallbacks.Tests.ps1`
- `web/tests/PlatformSpeech.Live.Tests.ps1` when live credentials/credits are intentionally available.

## Unknowns requiring confirmation

- Target paid provider mix for launch.
- Whether paid users should get higher-quality models than free users.
- Whether TTS is required for the first commercial release.

