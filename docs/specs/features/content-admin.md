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
- Saved content appears in learner routes without code changes.
- Uploaded media can be opened, replaced, and deleted.
- Backup export contains enough app data to restore the prototype to the same functional state.
- Admin actions should report clear success or failure messages.

## Invariants

- Learner copy must not depend on hidden hardcoded fallback text unless content is missing or invalid.
- Reordering content must preserve IDs and material data.
- New default materials must persist after save and reload.
- Backup/restore must not silently drop content or uploads.

## Edge cases and failure policy

- Invalid content saves must fail with a clear error and must not corrupt the previous content.
- Missing media should show a recoverable broken-asset state, not crash the screen.
- Concurrent edits are not guaranteed in the MVP and must be addressed before production.

## Route / state / data implications

- Current routes include `/admin`, `/api/admin/content`, `/api/admin/media/upload`, `/api/admin/media/delete`, `/api/admin/backup/export`, and `/api/admin/backup/import`.
- Production content should move from local JSON to a versioned database table.
- Media should move from local uploads to object storage.

## Verification mapping

- `web/tests/Admin.Tests.ps1`
- `web/tests/Admin.Ui.Tests.ps1`
- `web/tests/ContentDriven.Tests.ps1`
- `web/tests/PlatformAdmin.Tests.ps1`
- `web/tests/PlatformAdmin.Api.Tests.ps1`

## Unknowns requiring confirmation

- Whether admin is web-only for the commercial product.
- Whether admin edits require draft/publish approval before learner visibility.

