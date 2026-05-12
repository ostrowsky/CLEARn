# Content Admin

## Goal

Admins can create, edit, reorder, delete, backup, and restore all learner-visible content without code changes. Learner screens render from the same content contract used by the admin.

## Scope

- Sections, blocks, materials, routes, titles, copy, media, and runtime metadata.
- Admin save, upload, delete, reorder, backup, and restore flows.
- Learner rendering driven by saved content.

## Non-goals

- Billing and entitlement rules.
- Full production publishing workflow.
- Rich multi-user conflict resolution.

## User-visible behavior

- Admins can edit visible labels, instructional text, section/block/material order, material fields, and media.
- Admin access is protected by an initial setup flow. Before the first admin can use `/admin`, the app asks for login, password, password confirmation, and recovery email.
- After setup, admins must log in before reading or changing `/api/admin/*` content, media, backup, and restore endpoints.
- Admin sessions use server-issued signed cookies and can be cleared with logout.
- Admin sessions must survive API process restarts and multi-instance routing as long as `ADMIN_SESSION_SECRET` stays stable.
- Admin setup must reject mismatched passwords and incomplete credentials.
- Admins can set block layout width (`auto`, `full`, or `half`) so selected blocks can appear on the same horizontal row on wide screens.
- Saved content appears in learner routes without code changes.
- Uploaded media can be opened, replaced, and deleted.
- Uploaded media referenced by bundled read-only content must be copied into the static web build for Vercel previews so learner videos and audio do not resolve to the SPA fallback.
- Video materials render inside the learner page when the source is an uploaded playable file or a supported streaming URL such as YouTube or Vimeo.
- YouTube links may include a timestamp, and the embedded player must start at the linked segment instead of redirecting to YouTube.
- Video transcript text stored on the material must appear below the embedded player as readable learner content.
- If a YouTube material has no manual transcript, the API should attempt to load the public transcript track from YouTube and show the text around the linked timestamp.
- If YouTube shows a transcript in the browser but does not expose captions to server-side requests, the learner screen must show a clear recoverable message and the admin can paste the segment into the material Transcript field.
- Backup export contains enough app data to restore the prototype to the same functional state.
- Backup export must exclude rebuildable runtime folders such as dependency directories, virtual environments, build outputs, caches, and preview artifacts so it can complete through the public Cloudflare preview.
- Every learner/admin screen displays a small low-contrast watermark from editable content metadata.
- Admin actions should report clear success or failure messages.

## Invariants

- Learner copy must not depend on hidden hardcoded fallback text unless content is missing or invalid.
- Reordering content must preserve IDs and material data.
- Block layout metadata must not change the underlying content order.
- New default materials must persist after save and reload.
- Backup/restore must not silently drop content or uploads.
- Backup/restore may omit generated dependencies and local model caches that can be recreated from scripts.
- Watermark text must come from content metadata, not component constants.
- Admin credentials must never be stored as plain text.
- Admin session authorization must not depend on process-local memory only.

## Edge cases and failure policy

- Invalid content saves must fail with a clear error and must not corrupt the previous content.
- Missing media should show a recoverable broken-asset state, not crash the screen.
- Unsupported video codecs may still fail in the browser, but the API must serve uploaded media with correct content type and range support so compatible MP4/WebM files can play inline.
- YouTube transcript auto-loading is best-effort because some transcripts are gated by YouTube session, geography, age, rate limits, or anti-bot checks.
- Concurrent edits are not guaranteed in the MVP and must be addressed before production.

## Route / state / data implications

- Current routes include `/admin`, `/api/admin/content`, `/api/admin/media/upload`, `/api/admin/media/delete`, `/api/admin/backup/export`, and `/api/admin/backup/import`.
- Admin auth routes include `/api/admin/auth/status`, `/api/admin/auth/setup`, `/api/admin/auth/login`, and `/api/admin/auth/logout`.
- Production content should move from local JSON to a versioned database table.
- Media should move from local uploads to object storage.
- Production admin credentials should move from local JSON to a managed database or identity provider.

## Verification mapping

- `web/tests/Admin.Tests.ps1`
- `web/tests/Admin.Ui.Tests.ps1`
- `web/tests/ContentDriven.Tests.ps1`
- `web/tests/PlatformAdmin.Tests.ps1`
- `web/tests/PlatformAdmin.Api.Tests.ps1`

## Unknowns requiring confirmation

- Whether admin is web-only for the commercial product.
- Whether admin edits require draft/publish approval before learner visibility.
