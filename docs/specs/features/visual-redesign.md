# Visual Redesign

## Goal

The learner web experience should match the approved CLEARn redesign mockups on desktop and mobile while keeping all curriculum text, routing, and editable content data-driven.

## Scope

- Global learner visual system: color, typography scale, spacing, cards, buttons, and page shell.
- Desktop and mobile responsiveness for home, section hubs, content sections, and practice screens.
- Rollback safety for the pre-redesign visual state.

## Non-goals

- Rewriting exercise business logic.
- Replacing admin content models.
- Native iOS/Android visual polish beyond preserving responsive parity in the shared Expo UI.

## User-visible behavior

- The site uses the dark CLEARn visual direction from the new mockups: black/deep charcoal background, warm off-white text, orange highlight, serif accent display copy, and high-contrast cards.
- Desktop screens use wide artboard proportions with large hero typography, two-column layouts where space allows, and readable media/practice panels.
- Mobile screens collapse into single-column layouts with large readable headings, tappable controls, and no horizontal overflow.
- Existing editable content, section routes, labels, watermark text, and practice behavior remain unchanged.
- A git rollback reference must exist for the pre-redesign visual state before the redesign branch is implemented.
- The CLEARn logo uses the approved `<CLEARn />` mark with orange code brackets/slash and the italic orange `n`; it links to the home page on every learner screen.
- The visual source of truth is the `CLEARn.zip` pixel-perfect handoff: fixed mockup screenshots define the 1440px and 375px visual targets, while production uses the same colors, typography, spacing, hover states, and responsive `clamp()` behavior from the handoff CSS.
- The home screen and the menu overlay are separate visual states. The default home screen follows the `01-desktop-home` / mobile home layout with `ASK / ANSWER / chat`, CTA buttons, and module cards. The menu overlay follows the `02-desktop-menu` layout and must not introduce a separate hardcoded top-right `x`; the same compact hamburger-style pill toggle opens and closes the overlay.
- Learner pages below the home screen use the same compact hamburger-style pill menu trigger instead of repeating the large home hero words or rendering a text-only menu button. Pressing that trigger opens the same editable SKILLS / ABOUT menu overlay used by the home screen.
- The large `ASK`, `ANSWER`, and `CHAT` words in the open menu are navigation links: `ASK` opens the asking hub, `ANSWER` opens the answering hub, and `CHAT` opens the learning chat.
- Hover behavior follows the handoff: ASK / ANSWER / CHAT brighten to off-white, menu index labels move to accent, primary links and buttons use the documented accent/text hover states, and unrelated content must not change color on hover.
- Learner practice screens must not expose raw network errors such as `Failed to fetch` when the separate API is unavailable. They must keep the learner flow usable with deterministic built-in fallback content and validation until the API recovers.
- Uploaded media bundled into the web app must play from the static `/uploads/...` path in deployed/static previews instead of requiring the API host.

## Invariants

- Content remains the source of truth for learner text and routes.
- Visual components must not introduce hardcoded lesson copy.
- Navigation must continue using content routes rather than technical `/section/{id}` links.
- Admin "Open learner app" navigation must go directly to the canonical `/` home route and must not rely on a `/sections` redirect that can create navigation loops.
- Media must keep original aspect ratios and remain playable where supported.
- Admin functionality must remain available after the visual token update.
- The question preview in Ask After the Talk is always composed from all three learner-controlled parts: selected context lead-in, typed/dictated detail, and selected follow-up phrase.

## Edge cases and failure policy

- If content fails to load, fallback/error cards must stay visible on the dark background.
- If a screen is narrower than the desktop layout, cards must wrap or stack instead of clipping text.
- If a browser does not support a web-only media element, the existing open-media fallback remains available.

## Route / state / data implications

- No new learner routes are required.
- Existing mutable content must safely migrate known stale visual defaults, such as the old home title, without overwriting admin-authored custom values.
- The rollback reference is a git branch or tag pointing to the pre-redesign commit.

## Verification mapping

- `web/tests/PlatformDesign.Tests.ps1`
- `web/tests/PlatformVisualRegression.Tests.ps1` with `RUN_VISUAL_REGRESSION_TESTS=1` for Playwright screenshot comparison against `CLEARn.zip`
- `web/tests/PlatformPracticeFallback.Tests.ps1`
- `web/tests/ContentDriven.Tests.ps1`
- `web/tests/PlatformAdmin.Tests.ps1`
- Expo web build or syntax checks for learner screens.

## Unknowns requiring confirmation

- Whether admin should later receive a separate dashboard-specific redesign rather than inheriting the learner visual tokens.
