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
- The current release is intentionally light-only. Do not add or expose dark
  mode until every customer, business, admin, native launch, and payment surface
  has passed a dedicated cross-platform visual QA cycle.
- Make bilingual UI work naturally for English and French. Leave enough room for longer French labels.

## UI Review Checklist

- Does the screen use shared theme colors, spacing, typography, and widgets?
- Is the primary action visually obvious without making secondary actions noisy?
- Are forms scannable, with labels, helper/error states, and predictable validation?
- Does text fit at mobile widths and in both supported locales?
- Are tap targets comfortable and stable?
- Does the layout avoid overlap when content grows?
- If dark mode is being reintroduced, has every surface passed contrast and
  hierarchy review before the preference is exposed?
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
- Freight tracking cards should lead with a plain-language "what happens now /
  what do I owe" summary, especially for estimate-paid pending states, instead
  of relying on settlement/status labels alone.
- Vehicle listings must require an explicit rebuilt-title Yes/No disclosure.
  Show it in seller edit/review, customer cards/details, and admin review in
  English and French. Missing legacy values must say Not provided/Unknown and
  must never be presented as No or “clean title.”
- Public marketing visuals that present the product UI must use genuine captures
  from the running app, not recreated HTML mockups. Capture a privacy-safe,
  fully rendered state in both English and French whenever the image contains
  text, and never ship debug ribbons or test/customer identifiers.
- Keep the app light-only for the current release. A future dark-mode return is
  a full product-quality project, not a settings-toggle change; it must include
  Stripe sheets, iOS/Android native shells, all roles, and English/French QA.
- Phone verification uses three explicit profile states: matching verified,
  matching unverified, and edited. An edited visible number must never retain a
  green verified treatment. Present a nearby full-width `Save and verify`
  action, keep the one-field OTP and Verify action together above the keyboard,
  and give resend, error, synchronization recovery, and success their own
  visible states in English and French.
- Expected authentication conflicts such as duplicate phone numbers or emails
  are recoverable account states, not crashes. Show concise localized guidance
  near the form with a direct sign-in action, retain entered values, and never
  expose backend exception text or stack traces in customer UI.
- Web signup controls must preserve the mobile app’s interaction model and
  completeness, especially the flag/calling-code phone picker and locale-aware
  country names. Treat a simplified or partial web substitute as a parity bug,
  and visually verify the control at narrow phone widths.
- Public customer journeys must be service-specific for every implemented
  marketplace service. Let signed-out visitors browse, fill, and review a
  request; require authentication only when an action saves, submits, reserves,
  or pays. Keep the draft mounted through sign-in/signup/verification and return
  to the exact service and review state instead of a generic dashboard.
- Public headers should use a plain `Log in` / `Se connecter` account action,
  never the internal-sounding “Customer workspace.” Service cards must look
  actionable before hover: keep the full card clickable and give each one a
  persistent bottom action row with a service-specific verb and arrow.
- Customer provider cards must expose each business's own barrel or freight
  rate before selection. Keep the selected provider and live estimate visually
  prominent, with a one-column layout and the full action content visible at
  narrow phone widths.
- Customer marketplace forms use progressive disclosure: select the destination
  first, show only eligible businesses and their rates second, and ask for
  sender/receiver details only after a provider is chosen. Do not flatten
  destination and provider into one card catalog when one filters the other.
- Never show a complete estimated total using an assumed pickup borough. Keep
  pickup geography pending until a valid address determines it, and distinguish
  the shipping subtotal from the final pickup-inclusive estimate.
- Search within a staged marketplace selector must preserve the committed
  destination, provider, and draft until the user selects a replacement.
  Typing, blurring, Escape, and Tab must not discard prepared form state.
