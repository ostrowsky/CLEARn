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
- Ask-after-talk video library materials intended for production demos must store transcript text in content metadata.
- The YouTube transcript fallback uses the same segment logic as a working `youtube_transcript_api` flow: extract the video ID, read the YouTube watch page, handle the YouTube consent page by retrying with a `CONSENT=YES+...` cookie, reuse the page `INNERTUBE_API_KEY` for Android InnerTube caption discovery, fetch Russian or English transcript entries, keep entries where `start <= entry.start < end`, and join only those entries.
- The production API transcript endpoint must try the Python `youtube_transcript_api` integration before lower-level TypeScript fallbacks, because the admin `Fetch transcript` button must work for newly added videos that do not already have transcript metadata.
- Hosted production environments must support configuring a YouTube transcript proxy through environment variables, because YouTube may block datacenter IPs even when the same transcript request works from localhost.
- Hosted production environments may route transcript fetching through a Browserless provider when `TRANSCRIPT_FETCH_PROVIDER=browserless`; this provider must call Browserless server-side only, keep the API key out of the frontend, extract YouTube caption tracks in a browser context, and return only transcript text for the configured `[start,end)` segment.
- On mobile/native clients where inline web embedding is unavailable, the material remains openable through the external media button.

## Invariants

- Every learner video material must define a positive segment duration.
- YouTube materials must define `start`/`t` and `end`, either in the URL or through an equivalent normalized URL before transcript fetching.
- Uploaded/direct video materials must define segment bounds through `#t=start,end` or material metadata such as `segmentStart` and `segmentEnd`.
- Segment end must be greater than segment start.
- Segment start must be greater than or equal to zero.
- Stored `transcriptSegments` must have non-empty text and timed bounds inside the configured video segment.
- Stored video library transcript text must be meaningful enough for practice and must not rely on server-side YouTube availability in production.
- When a production content store has an older matching video material with an empty transcript, the API may backfill the transcript from the bundled Git-tracked content by material ID.
- Uploaded video materials must not rely on YouTube auto transcript fallback.
- YouTube transcript fallback must call `/api/media/youtube-transcript-segment`, not a full-video transcript endpoint.
- YouTube transcript fallback must support modern YouTube timed text XML with `<p t="..." d="...">` entries, because those are returned by the Android InnerTube caption flow.
- YouTube transcript fallback must use the watch-page InnerTube API key when available, because hosted server IPs may not receive caption tracks from unauthenticated keyless InnerTube calls.
- YouTube transcript fallback must retry watch-page parsing with the YouTube consent cookie when a hosting region receives the consent interstitial.
- The `Fetch transcript` API must not use Git-tracked `web/data/content.json` as a transcript source, because that would only return transcripts after they were already fetched and saved.
- When YouTube blocks a hosted server IP, the API response shown by the admin `Fetch transcript` button must surface an actionable diagnostic that tells operators to configure `YOUTUBE_TRANSCRIPT_PROXY_URL` or Webshare credentials rather than silently returning the generic "not found" message.
- Browserless credentials must be read only from API-side environment variables such as `BROWSERLESS_API_KEY`; no `EXPO_PUBLIC_*` frontend variable may contain Browserless credentials.

## Edge cases and failure policy

- If a YouTube URL cannot be parsed into a valid video ID, it must not be embedded as a YouTube iframe.
- If segment end is missing or not greater than start, playback must not pretend to be segment-limited.
- If a transcript segment lies outside the configured video bounds, regression tests must fail.
- If a live YouTube transcript request is unavailable, non-live tests still verify the client endpoint contract and stored transcript coverage.
- If a native platform cannot render the inline web embed, the media button must remain available.
- If a direct video file has no segment fragment or metadata, tests must fail because the full uploaded video could be shown.

## Route / state / data implications

- `GET /api/media/youtube-transcript-segment?url=...` returns transcript text and normalized segment bounds for a YouTube clip URL.
- `TRANSCRIPT_FETCH_PROVIDER` controls provider order: `browserless` tries Browserless first then direct fallbacks, `direct` disables Browserless, and `auto` uses Browserless first only when `BROWSERLESS_API_KEY` is configured.
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
