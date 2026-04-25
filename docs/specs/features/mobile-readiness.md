# Mobile Readiness

## Goal

The learner product should be portable to iOS and Android with minimal rewrite by keeping domain logic shared and isolating web-only behavior.

## Scope

- Expo learner app.
- Shared components and API contracts.
- Audio recording and STT upload.
- Media playback.
- Navigation and route parity.

## Non-goals

- Native mobile admin unless explicitly required.
- Offline-first course downloads.
- App Store submission details.

## User-visible behavior

- Core learner flows should work on web and mobile: sections, media, typed answers, STT-enabled exercises, feedback, and chat.
- Mobile users must see permission prompts and errors that match native platform expectations.
- Audio recording must support iOS and Android formats and upload them to the same STT API contract.
- Layouts must remain readable on narrow screens.

## Invariants

- Shared domain and API contracts must not contain browser-only assumptions.
- Web-only APIs must be behind platform adapters.
- Learner-visible behavior should be consistent even when implementation differs by platform.

## Edge cases and failure policy

- Microphone permission denied: keep typed input and show a clear message.
- Unsupported audio format: normalize where possible or show a recoverable error.
- Slow STT: show progress and allow the learner to continue typing.

## Route / state / data implications

- Keep Expo Router for learner routes.
- Consider splitting admin into a web-only app before native packaging.
- Add native audio adapter around recording, file handling, MIME type, and upload.

## Verification mapping

- Existing web tests remain required.
- Add Expo/iOS/Android smoke tests for recording, playback, section navigation, and API base URL configuration.
- Add unit tests for platform audio adapter behavior.

## Unknowns requiring confirmation

- Whether the first mobile release is Expo Go/internal test build or App Store/Google Play.
- Whether mobile must support login/subscription in-app purchase immediately.

