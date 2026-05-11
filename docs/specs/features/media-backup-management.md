# Media Backup Management

## Goal

Admins can export and restore mutable uploaded media independently from editable content data, without exhausting production memory or exposing backup controls to unauthenticated users.

## Scope

- Admin-only media backup export.
- Admin-only media backup import/restore.
- Browser client controls for media backup operations.
- API routes and backup service methods for uploaded media.
- Streaming ZIP export behavior for production hosting limits.
- Regression coverage for authenticated and unauthenticated access.

## User-visible behavior

- Authenticated admins can download a media backup archive from the admin interface.
- Authenticated admins can upload a media backup archive for restore.
- Media backup controls are hidden before admin authentication succeeds.
- Media backup export returns a ZIP archive rather than a JSON payload or in-memory base64 blob.
- The browser download flow sends admin credentials/session cookies so protected backup endpoints work from the admin UI.
- A successful restore reports that media was restored and may require restart/reload if runtime state needs to be refreshed.
- Public learners never see backup controls.
- Unauthenticated users cannot export or restore media backups.

## Invariants

- Media backup endpoints are under the admin API surface and require an admin session.
- Media backup export must stream archive bytes where possible, instead of building a full archive in memory.
- The export archive must preserve relative upload paths needed by content media URLs.
- Restore must not write outside the configured media upload root.
- Backup behavior must work with durable production media storage paths, not only repository-local development folders.
- UI controls must not be mounted in public learner screens unless the current session is authenticated as admin.
- Backup export/import must remain separate from editable content backup/export.

## Edge cases and failure policy

- If the media folder is empty, export should return a valid empty archive or a clear admin-facing message, not a server crash.
- If a restore archive is invalid, the API must reject it without deleting current uploaded media.
- If an archive contains path traversal entries, restore must reject or sanitize them before writing files.
- If production memory is limited, export must avoid buffering the complete ZIP in memory.
- If credentials expire during a browser download, the admin should receive an authentication failure rather than a partial public file.
- If restore fails midway, existing media should not be left in an unrecoverable mixed state without an explicit error.

## Route / state / data implications

- `GET /api/admin/backup/media/export` is an admin-only archive download endpoint.
- `POST /api/admin/backup/media/import` is an admin-only archive restore endpoint.
- Client API helpers expose a media backup export URL and a media backup restore method.
- Admin UI mounts media backup controls only after auth status confirms admin access.
- Uploaded media remains mutable runtime state and must be backed by persistent production storage.

## Verification mapping

- `web/tests/Backup.Tests.ps1`
- `web/tests/PlatformAdmin.Api.Tests.ps1`
- `web/tests/PlatformAdmin.Tests.ps1`
- `platform/apps/client/src/lib/api.ts`
- `platform/apps/client/src/components/AdminMediaBackupControls.tsx`
- `platform/apps/api/src/services/backup.ts`
- `platform/apps/api/src/routes/adminBackup.ts`

## Unknowns requiring confirmation

- Maximum expected uploaded media volume per customer.
- Whether media restore should replace, merge, or version existing media in production.
- Whether large backup/restore jobs should move to asynchronous background processing before paid traffic.
