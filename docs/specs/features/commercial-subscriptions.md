# Commercial Subscriptions

## Goal

SOFTskills must support a commercial product with a free preview area and subscription-gated main content while preserving the current fast prototype workflow.

## Scope

- Anonymous preview access.
- Authenticated learner accounts.
- Subscription entitlement.
- Admin/editor roles.
- AI quota by plan.

## Non-goals

- Final pricing.
- Marketplace distribution.
- Corporate procurement features.

## User-visible behavior

- Anonymous users can access selected free preview content.
- Subscription-only sections show a clear locked state and upgrade path.
- Paid learners can access protected lessons and AI practice according to their plan.
- Admin/editor users can manage content but regular learners cannot access admin tools.
- Expired or cancelled subscriptions keep account access but lose protected content access.

## Invariants

- Entitlement checks must happen on the API, not only in the client.
- Admin APIs must require authentication and role authorization.
- Billing webhook state must be idempotent.
- Free preview content must remain usable without payment.

## Edge cases and failure policy

- Payment provider outage: existing paid entitlement should not be revoked until webhook reconciliation completes.
- Unknown subscription state: default to safe locked behavior for paid content.
- Failed upgrade: keep learner in preview mode and show retry guidance.

## Route / state / data implications

- Add users, roles, plans, subscriptions, entitlements, and usage/quota tables.
- Add middleware for protected API routes.
- Add billing webhook route.
- Add content-level visibility fields: free, paid, admin-only, draft.

## Verification mapping

- New API entitlement tests.
- New admin authorization tests.
- New subscription webhook idempotency tests.
- New learner locked/free route smoke tests.

## Unknowns requiring confirmation

- Preferred billing provider. Stripe is the default recommendation.
- Whether the first paid launch is B2C, B2B, or private cohort.
- Whether teams/organizations are needed in the first paid release.

