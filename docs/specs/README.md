# SOFTskills Feature Specs

This directory is the product behavior layer for SOFTskills.

Specs describe what the product must do from the learner, admin, customer, or operator point of view. They should stay short, explicit, and product-level. Implementation notes are allowed only when they preserve an important contract.

## Structure

- `features/` - first-pass feature specs and product contracts.
- `templates/feature-spec.md` - reusable template for new specs.
- `backlog.md` - spec backlog, unknowns, and next specs to create.

## Workflow

1. Check whether a relevant spec already exists.
2. Update the spec before or alongside behavior changes.
3. Implement against the spec, not chat memory.
4. Add or update verification for the changed behavior.

## Priority Areas

- Content-driven admin and learner rendering.
- Practice exercises and validation behavior.
- AI provider gateway, STT/TTS, cost controls, and fallbacks.
- Commercial access, free preview, subscription gating, and roles.
- Mobile readiness for iOS and Android.
- Deployment, backup, reliability, and security.

