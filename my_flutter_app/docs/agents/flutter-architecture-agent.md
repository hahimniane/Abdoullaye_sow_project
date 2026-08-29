# Flutter Architecture Agent Memory

## Mission

Keep the Flutter codebase coherent as features grow. Protect navigation, state management, localization, Firebase integration, shared widgets, and module boundaries.

## Current App Shape

- Entry point: `lib/main.dart`.
- App shell: `MaterialApp` wrapped in `MultiProvider`.
- Providers currently include `LanguageProvider`, `AuthProvider`, and `ThemeProvider`.
- Themes live in `lib/theme/`.
- Localization lives in `lib/l10n/` with English and French ARB files.
- Screens live in `lib/screens/`.
- Shared widgets live in `lib/widgets/`.
- Services live in `lib/services/`.
- Models live in `lib/models/`.
- Data catalogs live in `lib/data/`.
- Firebase options are in `lib/firebase_options.dart`.

## Current Routing Notes

The app uses named routes in `MaterialApp.routes`, including:

- `/splash`
- `/`
- `/login`
- `/signup`
- `/forgot-password`
- `/customer_home`
- `/park`
- `/barrel`
- `/transport`
- `/sell`
- `/tracking`
- `/my-purchases`
- `/purchase-management`
- `/destination-countries`
- detail routes that expect typed `ModalRoute` arguments
- staff and user-management routes

When adding routes, update route names consistently and verify argument types at navigation call sites.

Route audit command:

```sh
rg -n "pushNamed|pushReplacementNamed|pushNamedAndRemoveUntil|routes:" lib
```

When changing navigation, compare every named route call against `MaterialApp.routes` in `lib/main.dart`. Flag any route string used by screens but missing from the route table. Current route-sensitive areas include account profile, wallet, business management, destination countries, staff management, purchase management, and detail pages.

## High-Risk Domains

- Auth roles and staff/admin/business permissions.
- Stripe purchase, deposit, and full-payment flows.
- Firestore document fields used by models and services.
- Destination country catalogs and fallback behavior.
- Barrel, transport, purchase tracking, and receipt generation.
- Generated localization and bilingual route/screen copy.

## Architecture Preferences

- Follow existing Provider and service patterns unless a change clearly requires a larger migration.
- Keep shared UI in `lib/widgets/` when multiple screens use it.
- Keep business logic out of widget build methods when it can live in services, models, or small helpers.
- Do not duplicate localization strings across screens; add keys to ARB files and regenerate when needed.
- Prefer explicit model methods for serialization/deserialization rather than ad hoc map access in screens.
- Keep Firebase calls behind services where practical.
- Be careful with dirty worktrees. Many files may already contain user or generated changes.

## Review Checklist

- Are imports organized and unused imports removed?
- Does the change respect existing provider ownership?
- Are async calls handled with mounted checks where UI state may update after awaits?
- Do async user actions expose a loading state, disable repeat activation, and
  reset in `finally`?
- Are route arguments typed and validated at both sender and receiver?
- Are localization keys present in English and French, generated files updated,
  and dynamic values represented with ARB placeholders?
- Did the change accidentally create a second source of truth?
- Are shared widgets still reusable and not overloaded with screen-specific logic?

## Output Style

Return file-specific findings or changes, with attention to cross-screen effects. When proposing refactors, separate required fixes from optional cleanup.

## Durable Architecture Lessons

Add future project conventions and repeated architectural decisions here.

- For public marketing business features, audit every existing public business
  surface before claiming business counts are private. Use curated public
  collections or callables for marketing-safe records, and avoid reading the
  private `businesses` collection from public website code.
- Admin website curation has two authorization planes: direct client
  Firestore/Storage writes and Cloud Functions callables. Keep WebsiteView
  manage gating, Firestore/Storage rules, and
  `requireAdminCapability("website")` in sync; prefer callables for privileged
  featured-business publishing and deploy rules from
  `my_flutter_app/firebase.json`, not the admin web hosting config.
- Website and featured-business location entry must use selectable country/city
  controls instead of free text. Derive admin options from registered business
  data plus legacy featured records unless a dedicated catalog is introduced.
- Business dashboard car visibility depends on `cars/{id}.businessId`.
  Business-owner listing queries must stay uncapped and scoped to the owner's
  `businessId`; legacy/default migrations should only fill missing
  `businessId` values and must not overwrite cars already assigned to another
  business.
- Laawol collects customer payments on the platform account, but business-owned
  service revenue should be paid directly to the responsible business through
  Stripe Connect transfers after payment success. Do not design escrow or
  delivery-gated payout flows unless the user explicitly changes this rule.
- Treat Laawol as a marketplace/payment facilitator and each registered
  business as the independent provider responsible for listings, goods,
  fulfillment, delivery timing, and performance. Account creation, business
  applications, and every paid customer flow must use versioned bilingual
  acceptance contracts. Production payment callables must reject missing or
  stale acceptance and store canonical user/action/locale/timestamp evidence.
- Async button/tap actions must use shared loading-state patterns where
  practical, show visible progress on all platforms, prevent double submits,
  and clear the loading flag on success, error, and cancellation.
- New or changed user-facing strings must use `AppLocalizations` and ARB
  placeholders. Do not add hardcoded English UI text or local `copy(en, fr)`
  helpers when an ARB key is the right source of truth.
- Destination availability is service-specific. Freight requires an air or sea
  per-kg rate, barrels/shared barrels require a barrel rate, and quoted car
  transport requires only an approved active destination. Do not reuse the
  barrel-only `isAvailable` predicate for another service.
- Business destination docs now use `destinationCoverageVersion: 2` and a
  `serviceAvailability` map with `barrelShipping`, `freightAir`, `freightSea`,
  and `carTransport`. `isActive` is the aggregate query flag for "at least one
  service is enabled." Explicit `false` entries override legacy rate inference;
  keep old-doc fallbacks only at model/callable boundaries.
- Every `CustomerOrder` marked trackable must have a registered source/parser in
  `CustomerTrackingRepository` and an appropriate tracking card/action before
  Orders routes it to `/tracking`.
- Freight pricing is a two-stage contract: the booking charge is a provisional
  estimate, a business-only weight confirmation creates one deterministic
  versioned settlement, and fulfillment/payout stays locked until that
  settlement is complete — except pay-on-arrival, which is secured by a
  saved card (`card_saved`) and progresses unpaid (`due_on_arrival`) until
  the business marks arrived. Preserve estimated and final amounts separately;
  never overwrite the estimate or treat operational status as payment status.
- Stripe payment-sheet flows must separate three phases: create a pending
  server record, present the sheet, then confirm completion. Cancel the pending
  record only when sheet presentation fails; never cancel after presentation
  succeeds merely because the confirmation request failed. The webhook and
  stale-payment reconciler must be able to finish that charged transaction.
- Car deposits and full purchases must lock the car document in the same
  Firestore transaction that creates the pending purchase. Completion and
  cancellation may update the car only when `reservedPurchaseId` still matches.
- A paid barrel destination increase is its own Stripe payment type with a
  stable request ID and reconciliation route. Compute the new shipping total as
  the per-barrel rate multiplied by shipment quantity; preserve the old
  destination until the adjustment payment succeeds.
- Store rebuilt-title disclosure as nullable `isRebuiltTitle` for legacy
  compatibility, require a real boolean on new vehicle listings, and preserve
  null as an explicit unknown display state. Never default missing values to
  false or infer a clean title.
- The current release is light-only: lock Flutter, Stripe PaymentSheet, iOS
  `UIUserInterfaceStyle`, and Android night resources to light, and do not read
  the legacy `theme_mode` preference. Reintroducing dark mode requires an
  explicitly versioned preference and complete UI/native/payment QA.
- `CustomerHomeScreen` owns nested tab navigators that deliberately absorb
  unknown routes by returning the tab root. Full-screen global flows such as
  business onboarding must navigate with `rootNavigator: true`; a route merely
  existing in `MaterialApp.routes` does not prove a nested call can reach it.
  Cover global navigation helpers with a nested-navigator widget regression.
- Customer attachment flows must follow select → validate → review → commit.
  Images need a local preview plus Cancel, Replace, and explicit Upload;
  videos/documents need filename and size review without buffering the full
  native file. Preserve the draft caption on cancel or upload failure, retain
  the pending attachment for retry, and keep picker/review/upload actions
  guarded against duplicate activation.
- Support thread escalation must be visible where users are actively chatting,
  not only in the scrollback. Keep the ask-admin action or already-escalated
  state persistent near the composer. Normal unresolved escalation obeys the
  response window, but urgent backend-supported reasons can be submitted before
  that window unlocks.
- Optional/domain normalization must preserve absence as absence. Display
  sentinels such as `Unknown` must never enter typed identifiers such as
  currency codes, roles, collection names, or business IDs; apply display copy
  only after typed fallbacks and validation have run.
- Business profile parking location is address-first. Manual latitude/longitude
  entry should stay hidden from business users; nullable coordinate fields are
  backend metadata only. Preserve them when the saved address is unchanged, and
  clear them only through an explicit stale-coordinate path when the address is
  edited.
- Customer web pricing must display the server-projected provider rates already
  returned by the destination callable: barrel per-unit rates and freight
  air/sea per-kilogram rates. Keep checkout payloads price-free so the backend
  remains authoritative. Car transport stays quote-only, and freight pickup
  keeps the final total pending until an authoritative quote exists.
- Hosted Stripe Checkout must have both a same-mode registered webhook and an
  authenticated return-session recovery path. Recovery retrieves the Session
  from Stripe, validates its user/type/record metadata and attached Firestore
  record, binds the Checkout-created PaymentIntent, and reuses the idempotent
  reconciliation path. Redirect only after persisted payment success.
- Shared destination projections can contain prices for more than one service,
  so web eligibility must mirror `BusinessDestinationOption.isAvailableFor`:
  approved/active business, exact enabled service, destination availability,
  and a positive finite service/mode rate. A price alone never proves that the
  business offers that service. When one customer service exposes this class of
  mismatch, audit every service selector rather than waiting for separate user
  reports.
- Car transport `flowVersion: 2` is an unassigned quote marketplace, not a
  first-provider booking. The server derives eligible businesses and creates
  deterministic top-level `transportOpportunities` and `transportQuotes`
  documents. Opportunities expose only tracking, destination, coarse pickup
  area, vehicle, and schedule preferences; exact contact/address/owner/VIN/
  notes remain private until the customer transactionally selects one quote.
  All v2 quote, cancellation, selection, and fulfillment mutations stay behind
  permission-checked callables. Preserve assigned `flowVersion: 1` records.
- Destination coverage v2 uses an exact four-key `serviceAvailability` map
  (`barrelShipping`, `freightAir`, `freightSea`, `carTransport`) gated by the
  parent business services. Legacy active/rate fields may infer barrel or
  freight only; generic activity must never infer car transport. Preserve
  optional delivery min/max days and normalized air/sea departure weekday
  arrays, and snapshot the chosen freight schedule on booking.
- Marketplace personnel administration has one server-owned access model across
  Flutter and web. Platform sections resolve from the configured admin role and
  fail closed; `role == admin` is never blanket authorization. Personnel reads
  use the redacted, paginated `listMarketplacePeople` /
  `getMarketplacePerson` callables instead of direct `users` collection
  listeners. Create access with expiring invitations only—administrators and
  business owners must never choose or share another person's password.
- Invitation acceptance may omit an invitation ID only when the server can
  resolve exactly one unexpired pending invitation for the verified caller UID
  or email. Zero or ambiguous matches fail closed. Preserve last-super-admin and
  last-business-owner protections across suspension, demotion, ownership
  transfer, and account-deletion workflows.
- Guest checkout on the customer web console uses an anonymous Firebase session
  plus a contact block, not a `users/{uid}` profile. The console router must
  not treat that sign-in as account boot (`getIdToken(true)` + profile spinner):
  that races `signInAnonymously` and unmounts the guest panel. After Continue
  as guest, resolve the submit that opened the sheet so Stripe starts; do not
  dump the customer back on Review & pay. A signed-in customer never carries
  the guest block.
- Guest `/pay/return` must confirm from the Stripe Checkout Session id in the
  URL. Do not require a still-alive anonymous Firebase user, and do not
  `location.replace("/")` on success for anyone without a customer workspace
  — that is the sign-in screen. Resume the same `barrelOrder` id; the Session
  id is the capability. Signed-in customers still auto-return to the console.
- Barrel `in_transit` needs a container / booking / BOL number (≥ 4 chars) on
  the merged document. A business may write `containerNumber` from the Barrels
  console without Terminal49. Do not require `trackingProvider: carrier_api`
  for that move; automated tracking stays optional. Freight still cannot
  client-write `containerNumber`. A Terminal49-owned number
  (`trackingProvider == carrier_api`) stays server-owned.
