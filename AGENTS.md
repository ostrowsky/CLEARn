# AGENTS.md

This repository uses a spec-first workflow for non-trivial product work.

## Reading Order

Before changing user-visible behavior:

1. Read this `AGENTS.md`.
2. Read `docs/specs/README.md`.
3. Read the relevant feature spec under `docs/specs/features/`.
4. Update or create the spec before implementation when behavior changes.

## Spec-First Rule

Create or update a spec when a task:

- introduces a new feature
- changes observable learner or admin behavior
- changes routes, API contracts, state, persistence, eligibility, billing, or permissions
- changes AI provider behavior, prompts, fallbacks, STT/TTS flows, or validation rules
- affects mobile/web parity

Specs define product behavior. Tests and QA evidence verify the behavior. Code implements the contract.

## Verification Rule

When behavior changes, update the matching tests or QA checks in the same task. Prefer API-level tests for backend contracts, component/static tests for UI wiring, and smoke checks for preview/deployment scripts.

