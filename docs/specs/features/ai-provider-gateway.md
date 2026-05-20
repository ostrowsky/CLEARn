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

- Current env variables configure `LLM_TEXT_PROVIDER`, `LLM_STT_PROVIDER`, `LLM_TTS_PROVIDER`, provider models, fallback chains, and self-hosted base URLs.
- Chat/text generation uses `LLM_FALLBACK_CHAIN`.
- STT/TTS uses a separate `LLM_SPEECH_FALLBACK_CHAIN`, which must default to `selfhosted,openai,huggingface` so Hugging Face credit exhaustion does not block speech when a self-hosted or paid speech provider is available.
- STT model names are provider-specific: `SELF_HOSTED_STT_MODEL` for faster-whisper models such as `tiny.en` or `base.en`, `OPENAI_STT_MODEL` for OpenAI models such as `whisper-1`, and `HF_STT_MODEL` for Hugging Face model ids such as `openai/whisper-large-v3`.
- Production STT should set `LLM_STT_PROVIDER=selfhosted`, `LLM_SPEECH_FALLBACK_CHAIN=selfhosted,openai,huggingface`, and `SELF_HOSTED_SPEECH_BASE_URL=https://<speech-service>/v1`; `localhost` is valid only when the API and local STT service run on the same machine.
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

