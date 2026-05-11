# Segmented Video Materials

## Goal

Learners see and practice only the configured video clip segment, and transcript text matches that same segment.

## Scope

- YouTube video URLs with `start`, `t`, and `end` parameters.
- Uploaded/direct video files with `#t=start,end` fragments or equivalent material metadata.
- Inline web video rendering in learner section screens.
- Segment-aware YouTube transcript fetching.
- Content and template validation for all video materials.
- Optional live transcript checks against a deployed API.

## User-visible behavior

- A learner opening a video material sees the intended clip segment, not the whole source video.
- Embedded YouTube playback starts at the configured start time.
- Embedded YouTube playback pauses and seeks back to the configured end time when the player reaches the segment end.
- Direct uploaded videos use the configured media fragment or metadata-defined segment bounds.
- Transcript text displayed below a video corresponds to the configured segment.
- If transcript text is already stored in material metadata, it is displayed without a network transcript request.
- If a YouTube material has no stored transcript, the client requests a segment transcript endpoint with the video URL, including start and end parameters.
- On mobile/native clients where inline web embedding is unavailable, the material remains openable through the external media button.

## Invariants

- Every learner video material must define a positive segment duration.
- YouTube materials must define `start`/`t` and `end`, either in the URL or through an equivalent normalized URL before transcript fetching.
- Uploaded/direct video materials must define segment bounds through `#t=start,end` or material metadata such as `segmentStart` and `segmentEnd`.
- Segment end must be greater than segment start.
- Segment start must be greater than or equal to zero.
- Stored `transcriptSegments` must have non-empty text and timed bounds inside the configured video segment.
- Uploaded video materials must not rely on YouTube auto transcript fallback.
- YouTube transcript fallback must call `/api/media/youtube-transcript-segment`, not a full-video transcript endpoint.

## Edge cases and failure policy

- If a YouTube URL cannot be parsed into a valid video ID, it must not be embedded as a YouTube iframe.
- If segment end is missing or not greater than start, playback must not pretend to be segment-limited.
- If a transcript segment lies outside the configured video bounds, regression tests must fail.
- If a live YouTube transcript request is unavailable, non-live tests still verify the client endpoint contract and stored transcript coverage.
- If a native platform cannot render the inline web embed, the media button must remain available.
- If a direct video file has no segment fragment or metadata, tests must fail because the full uploaded video could be shown.

## Route / state / data implications

- `GET /api/media/youtube-transcript-segment?url=...` returns transcript text and normalized segment bounds for a YouTube clip URL.
- `ContentMaterial.meta.transcript`, `videoTranscript`, or `caption` may store plain transcript text.
- `ContentMaterial.meta.transcriptSegments` may store timed transcript snippets with `start`, `end`, and `text`.
- `ContentMaterial.meta.segmentStart`, `segmentEnd`, `clipStart`, `clipEnd`, `start`, or `end` may define bounds for uploaded/direct media when the URL has no media fragment.
- `platform/apps/client/app/section/[id].tsx` owns learner material rendering and inline segment playback behavior.
- `platform/apps/client/src/lib/api.ts` owns the client transcript endpoint call.

## Verification mapping

- `web/tests/PlatformMedia.Tests.ps1`
- `platform/apps/client/app/section/[id].tsx`
- `platform/apps/client/src/lib/api.ts`
- `platform/apps/api/src/routes/media.ts`
- `web/data/content.json`
- `web/data/content.template.json`
- Optional live check: `RUN_YOUTUBE_TRANSCRIPT_LIVE_TESTS=1`

## Unknowns requiring confirmation

- Whether all future learning videos should use stored transcript text or allow YouTube transcript fallback.
- Whether non-YouTube hosted videos need automatic transcript generation.
- Whether segment playback constraints must also be enforced in native mobile video components when mobile builds are activated.
