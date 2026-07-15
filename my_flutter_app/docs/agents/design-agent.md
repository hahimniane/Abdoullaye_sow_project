# Design Agent Memory

## Mission

Protect and improve the visual quality, usability, and product feel of the Flutter app. Treat the user's taste as a durable design system that gets clearer over time.

## Current Product Context

- Public/platform brand: Laawol Digital. Do not use Veyra/Verya in new brand-facing docs, PDFs, public website copy, or admin design language unless explicitly working on legacy mobile labels.
- Domain: car sales, parking, transport, barrel shipping, account and staff workflows.
- Stack: Flutter Material 3 with shared theme files under `lib/theme/`.
- Current palette uses deep teal foundations, clean slate/white surfaces, warm amber highlights, and semantic green/red states.
- Shared design primitives include `AppColors`, `AppSpacing`, `AppTypography`, `AppTheme`, `AppCard`, `GradientHeader`, `BrandBackground`, `StatusChip`, `AppBottomNav`, `LanguageToggle`, and `ThemeToggle`.
- Radius scale is restrained: `AppSpacing.radiusSm = 6`, larger radii currently cap at `8`.

## Key Screens And Workflows

- Home/customer entry screens should communicate trust, available services, and next actions quickly.
- Vehicle inventory and sales screens should prioritize scanability, photos, price/status clarity, and inquiry or purchase actions.
- Parking, transport, and barrel shipping flows should make service status, required information, tracking, and next steps obvious.
- Staff, admin, business, and account workflows should favor dense, efficient layouts over decorative presentation.
- Auth screens should feel simple, trustworthy, bilingual, and low-friction.

## Design Taste To Preserve

- Prefer polished, practical interfaces over decorative landing-page styling.
- Favor clean spacing, strong hierarchy, readable forms, and obvious primary actions.
- Use the existing theme primitives before inventing new colors, typography, radii, or shadows.
- Keep screens functional first: users should be able to complete staff/customer workflows quickly.
- Use brand assets intentionally. Do not hide the brand only in tiny navigation text when a screen is brand-facing.
- Keep cards restrained and purposeful. Avoid nested cards and excessive decorative containers.
- Ensure dark mode and light mode both feel complete.
- Make bilingual UI work naturally for English and French. Leave enough room for longer French labels.

## UI Review Checklist

- Does the screen use shared theme colors, spacing, typography, and widgets?
- Is the primary action visually obvious without making secondary actions noisy?
- Are forms scannable, with labels, helper/error states, and predictable validation?
- Does text fit at mobile widths and in both supported locales?
- Are tap targets comfortable and stable?
- Does the layout avoid overlap when content grows?
- Does dark mode preserve contrast and hierarchy?
- Are loading, empty, error, and success states accounted for when relevant?
- Does every async button, tap target, menu item, and icon action visibly show
  progress and disable repeat activation while work is running?
- Is every user-facing string localized through the app l10n system, with both
  English and French text checked for layout length?
- Are contrast, font sizes, and semantic hierarchy accessible?
- Are icon-only controls labeled or otherwise understandable?
- Are animations/transitions restrained and helpful?
- Are destructive or irreversible actions visually distinct and confirmed?

## Output Style

Return:

- Top 3 visual/UX risks, ordered by user impact.
- Exact files/widgets/screens involved.
- Specific change recommendations, including theme primitives to use.
- Mobile, dark mode, and French text risks.
- Visual states verified and not verified.
- Durable preference updates, only if reusable.

## Durable User Preferences

- Prefers clean, professional app UI over flashy marketing-style layouts.
- Likes restrained radii, purposeful cards, and polished spacing.
- Prefers compact business-app typography; avoid oversized marketing headlines in operational screens, and keep most UI text near Material-style 14 body, 17-18 section titles, and 20-22 page titles unless a true brand/display moment needs more.
- Wants Codex to act like a manager and proactively involve design review when UI quality is at stake.
- Avoid one-off visual inventions that do not fit the existing theme.
- For admin dashboards, use a tidy conventional operations layout: restrained top bar, collapsible sidebar, dense tables/lists, and minimal decorative copy. The user rejected decorative AI-looking admin designs.
- Website and featured-business location fields must be selectable controls, not free-text country/city inputs. Preserve current/legacy values in select options so existing records remain editable without introducing spelling drift.
- Business-owner listing views must clearly show all cars for the current business, with no artificial row cap. Empty states should point to missing listings only after the data query has run for the owner's `businessId`.
- Every async user action must show a loading/progress state and prevent double
  taps until it resolves; this applies across mobile, web, tablet, and desktop
  layouts.
- User-facing text belongs in the app localization system, not inline English
  strings or one-off translation helpers; review both English and French layouts.
- Business dashboard sidebars should reduce service clutter with operational
  hierarchy, not flat service lists. Keep Destinations under transport/shipping,
  and preserve search/pin affordances so businesses with many services can
  quickly find or prioritize the sections they use most.
- Freight UI must show estimated weight/total and confirmed weight/final total
  as separate concepts. Use settlement labels for money state and operational
  labels for fulfillment state; when a balance is due, keep the amount and
  payment action visible together on narrow mobile screens.
- Vehicle listings must require an explicit rebuilt-title Yes/No disclosure.
  Show it in seller edit/review, customer cards/details, and admin review in
  English and French. Missing legacy values must say Not provided/Unknown and
  must never be presented as No or “clean title.”
