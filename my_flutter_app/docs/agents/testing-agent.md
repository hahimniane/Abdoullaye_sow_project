# Testing Agent Memory

## Mission

Keep the app shippable by choosing the right verification for each change, adding focused regression coverage, and explaining risk clearly.

## Current Project Context

- Flutter app located in `my_flutter_app`.
- Dart SDK constraint: `^3.8.0`.
- Testing package: `flutter_test`.
- Lints: `flutter_lints` via `analysis_options.yaml`.
- Current test files include:
  - `test/widget_test.dart`
  - `test/purchase_country_test.dart`
  - `test/app_feedback_test.dart`
- Important dependencies include Firebase Core/Auth/Firestore/Functions/Storage, Provider, Flutter Bloc, Stripe, PDF/printing, localization, geolocation, image picker, and shared preferences.
- Generated localization is enabled with `flutter: generate: true` and `l10n.yaml`.

## Preferred Verification Commands

Run from `my_flutter_app` unless noted:

```sh
flutter pub get
flutter analyze
flutter test
```

Setup and generated code:

```sh
flutter gen-l10n
```

Use narrower commands during iteration when appropriate:

```sh
flutter test test/app_feedback_test.dart
flutter test test/widget_test.dart
```

Cloud Functions commands from `functions/package.json`:

```sh
cd functions
npm run lint
npm run test:unit
npm run test:rules
npm run serve
```

Also available: `npm run shell`, `npm run deploy`, and `npm run logs`. Do not deploy unless the user explicitly asks.

## Testing Strategy

- Match test depth to risk. Small pure helper changes usually need focused unit tests; shared UI or workflow changes need widget tests or manual runtime checks.
- Prefer tests around business rules, validation, permission-sensitive flows, generated receipt/tracking logic, and service boundaries.
- For UI changes, check both light/dark theme behavior when the change touches shared styling.
- For localization changes, verify English and French keys stay in sync and generated localization files are updated when required.
- For Firebase-dependent code, avoid live production calls in tests. Use fakes, mocks, or pure service boundaries where possible.
- Treat analyzer warnings as real until proven otherwise.

## Firebase Test Policy

- Prefer pure model/service tests when possible.
- If a Firebase boundary is hard-wired, isolate logic behind a service boundary before testing.
- Do not run tests against production Firebase.
- For emulator-backed Firestore rules testing, run
  `cd my_flutter_app/functions && npm run test:rules`.

## Regression Checklist

- Does the changed code compile under analyzer?
- Are affected tests present and passing?
- Did generated files need regeneration?
- Are async operations awaited and errors surfaced to the UI?
- Do async buttons/taps show loading, disable repeat activation, and reset the
  loading state after success, error, or cancellation?
- Did every new or changed user-facing string get English and French ARB values,
  generated localization output, and a hardcoded-string audit?
- Are Firebase security rules, storage rules, or function contracts affected?
- Are route arguments and provider dependencies still valid?

## Output Style

Return exact commands run, pass/fail status, relevant failure snippets, and recommended next tests. If tests cannot be run, explain the blocker and the residual risk.

## Durable Testing Lessons

Add recurring failure modes, project-specific fake patterns, and useful commands here.

- The iOS 26.5 simulator requires `arm64`; do not exclude simulator `arm64` in `ios/Podfile`. The old `google_mlkit_text_recognition` / MLKit `MLImage.framework` pod only provided an `x86_64` simulator slice and an `arm64` device slice, so it could not run on this simulator runtime. After iOS Podfile or plugin dependency changes, run `pod install` from `my_flutter_app/ios`, then verify with `flutter run -d 96729E62-B230-4C2E-A307-2AEFD8DE8F3A`.
- Keep `build/**` excluded in `analysis_options.yaml`. Flutter's Swift Package Manager integration can place plugin source under `build/ios/SourcePackages` and `build/macos/SourcePackages`; without the exclusion, `flutter analyze` may fail on generated third-party package examples/tests instead of app code.
- For production Cloud Functions audits, keep `firebase-admin` on a Firebase Functions-compatible major and use the package-level `uuid` override in `functions/package.json`; `firebase-admin@14` clears the advisory directly but currently conflicts with `firebase-functions@6/7` peer ranges. `firebase-functions-test` was unused and removed because it pulled vulnerable Jest-only dev dependencies.
- For Website featured-business work, regression-test both authorization planes:
  UI manage gating plus Firebase Storage/Firestore/callable rules. Logo uploads
  under `businessLogos/{businessId}/...` should allow super admins and
  website-manage admins, reject non-image or oversized files, and public
  country/city fields should be selectable rather than free text.
- Firestore rules tests for business-scoped collections should cover both point
  reads and query/list reads. Staff `businessPermissions` are section-scoped for
  writes, and missing, empty, or malformed permissions must fail closed. Use the
  explicit-access migration dry run before enabling those rules on legacy data.
- Callable emulator suites that exercise platform-admin behavior must start both
  Auth and Firestore emulators and seed an `emailVerified: true` Auth user. The
  support suite's canonical command is `npm run test:support`; do not bypass the
  production admin email-verification lookup in tests.
- A Gen 2 callable can report `ACTIVE` while Cloud Run still lacks the
  `allUsers` `roles/run.invoker` transport binding. The resulting browser CORS
  `OPTIONS` request returns 403 before App Check or Auth reaches the handler.
  Browser-facing access callables must use the shared options object containing
  `invoker: "public"`, `cors: true`, and App Check enforcement, and backend
  post-deploy smoke must require a 2xx browser-like preflight for each callable.
  This does not relax handler authentication, verified-email, or capability
  checks.
- Business dashboard listing queries must remain uncapped for `cars` while still
  scoped by `businessId`; if a business cannot see older posted cars, first
  check whether those legacy car documents are missing the matching
  `businessId` or were assigned to the wrong/default business. Backfill helper changes should run
  `cd my_flutter_app/functions && npm run test:unit`. The local fallback script
  is `npm run backfill:cars -- ...`; it defaults to dry-run and requires
  explicit `--commit` for writes.
- Car listing image uploads must use `cars/{businessId}/{carId}/...`; keep
  legacy `cars/{carId}/...` image URLs readable but deny legacy writes. Storage
  rules tests should cover owner, listing staff, admin, cross-business,
  unauthenticated, non-image, and oversized upload cases.
- For top-level business-owned documents, add takeover regressions: updates must
  not authorize against a changed `request.resource.data.businessId` without also
  preserving the existing `resource.data.businessId`.
- A controlled `<select>` plus `confirmImportantAction` (async in-page dialog)
  must capture `event.target.value` *before* the await. The select snaps back
  to the Firestore-backed value while the dialog is open; reading the event
  after confirm writes the old status and toasts a false success. Freight
  already passes the value into `updateStatus` immediately — barrels must
  match that. Source-contract the capture (`const nextStatus = event.target.value`).
- Barrel `in_transit` is gated on `containerNumber` (≥ 4 chars) in Firestore
  rules. A rules reject can look like a silent snap-back (local write, then
  revert, no toast). Client-validate before confirm, write the typed number in
  the same merge when needed, and map `permission-denied` to a visible
  `role="alert"` error. Cover both: manual container write then `in_transit`,
  and `in_transit` without a number still denied. Do not require
  `trackingProvider: carrier_api`. Freight must keep failing a self-written
  container number.
- For UI workflows, test or manually verify that async buttons and tap targets
  show progress immediately, cannot be double-clicked/double-tapped, and recover
  after both success and failure.
- For Flutter UI changes, run or report a hardcoded-string audit for touched
  files and verify `flutter gen-l10n` plus `flutter analyze` after ARB edits.
- Every listed transacting service needs an acceptance contract spanning
  configuration, customer discovery/booking, callable lifecycle, Firestore
  rules, payment reconciliation, customer orders/tracking, operator
  fulfillment, earnings, and English/French rendering. A callable accepting a
  payment is not sufficient evidence that the service is operational.
- Local iPhone E2E is verified with stable Xcode 26.6 selected through
  `xcode-select`; do not require an Xcode beta or a `DEVELOPER_DIR` override.
  Maestro needs Java 21 and should clear the simulator keychain before auth
  tests, because Firebase credentials survive an app-data reset in the iOS
  Keychain.
  With limited disk/RAM, run emulator suites sequentially. Emulator app builds
  must pass `--dart-define=USE_FIREBASE_EMULATORS=true` and set
  `--dart-define=FIREBASE_EMULATOR_PROJECT_ID=...` to the same demo project used
  by the seed and Functions emulator; a shell environment variable alone does
  not satisfy `String.fromEnvironment`. Auth can appear to work while Firestore
  silently reads a different empty project namespace. On the animated login
  screen, Maestro must `waitForAnimationToEnd` before focusing Email and tap the
  iOS keyboard's `done` control after entering Password; otherwise text input or
  the submit tap can be silently lost even though Maestro reports success.
- If iOS `pod install` fails because CocoaPods reports stale specs for a locked
  pod such as `GoogleUtilities/UserDefaults` but `pod install --repo-update`
  repeatedly hits `Error in the HTTP2 framing layer`, fetch the missing locked
  podspec with `curl --http1.1` into `~/.cocoapods/repos/trunk/Specs/...`, then
  rerun plain `pod install`. Avoid broad dependency updates unless the locked
  graph itself is incompatible.
- Flutter tappable rows often expose their title and subtitle as one multiline
  accessibility label. Maestro should use multiline-safe selectors such as
  `(?s).*Browse cars.*` unless the node has an explicit standalone semantics
  label.
- Money-moving side effects must be claimed before they run. Stripe event ids
  dedupe an event, not a payment: webhook, `/pay/return` (`evt_return_`) and
  the stale sweep (`evt_reconcile_`) can all settle one payment at once, so
  `reconcileStripePaymentEvent` claims completion in a transaction
  (`paymentCompletionClaim`) and accruals are keyed per PaymentIntent.
  Stripe's Idempotency-Key only lasts 24h, so month-end billing claims its
  invoice (`subscriptionInvoiceAction`) before charging. Regression-test the
  race by replaying serialized transactions through the pure decision, plus
  a source contract that the claim precedes the side effect. Scheduled jobs
  over unbounded collections need an ordered, cursor-paged query, a deadline
  under `timeoutSeconds`, and a resume path - never an unordered `limit(N)`.
- Payment-sheet acceptance tests must distinguish presentation failure from
  post-charge confirmation failure. Only the former may call a cancellation
  endpoint; after the sheet succeeds, server/webhook reconciliation owns
  recovery. Keep a regression test for this ordering.
- Marketplace-responsibility regressions must prove the payment confirmation is
  disabled until the customer explicitly checks acceptance, renders in English
  and French, carries the current version/locale into the callable, and is
  rejected by production parsing when missing, unchecked, stale, or malformed.
- While the release is light-only, regression checks must cover Flutter root
  theme, native iOS/Android shells, every Stripe sheet setup, absence of the
  Settings toggle, and cold launch while the device OS itself is in dark mode.
- Paid vehicle holds need a concurrent two-customer test that proves exactly
  one reservation wins. Destination-change tests must use multi-barrel
  quantities so per-unit rates cannot be mistaken for shipment totals.
- Rebuilt-title regressions must cover required boolean creation, invalid or
  missing rule rejection, legacy-null display as Not provided, edit persistence,
  buyer card/detail visibility, admin review/filtering, and English/French copy.
- Firebase Storage rules have a 1,000-expression evaluation limit. In support
  attachment access, evaluate `hasAdminCapability('support')` once, then use the
  member-only business helper for the fallback; nesting the full admin-or-member
  helper there causes legitimate dynamic-role evaluation to become noisy and
  denied paths to fail by evaluator exhaustion instead of a clean denial.
- Production static preflight must require each public hostname to resolve only
  to the committed Hostinger IPv4 and IPv6. Resolve through both Google and
  Cloudflare DNS-over-HTTPS and require consensus; local UDP DNS may be
  intercepted to `18.204.152.241` / `AAAA ::` by router security even when the
  authoritative records are healthy. Timeouts, DNS errors, and resolver
  disagreements fail closed. Keep post-deploy HTTP smoke checks because DNS can
  change after the preflight snapshot.
- Production web App Check uses a score-based reCAPTCHA Enterprise key for both
  the admin/business Next.js console and Flutter web. Keep both clients on
  `ReCaptchaEnterpriseProvider`, keep debug providers development-only, and run
  release web builds with the registered public site key. The production web
  app uses a one-day App Check token TTL to preserve the no-billing assessment
  quota; provider/config mismatches compile successfully but fail at runtime,
  so retain source-contract tests and a real-browser launch check.
- Production payment release checks must derive the complete Stripe-bound
  function manifest from each export's Cloud Functions endpoint secret metadata.
  Never rely on a hand-maintained function-name subset: source derivation belongs
  in preflight, while deployed presence and `ACTIVE` state are enforced by the
  post-deploy smoke so a corrective deployment is not blocked before it runs.
- Marketing app captures must be normalized into conventional opaque PNG files
  before publication. Verify the final encoded asset in a real browser several
  times and compare render hashes; simulator captures can contain unstable raster
  data that looks correct once and then renders with black bands.
- Treat every route opened from customer-tab authentication as a nested-navigator
  regression risk. Business registration, forgot password, and business/staff
  home are app-wide destinations and must be pushed through the root navigator;
  widget tests must begin inside the nested customer navigator so a root-only
  test cannot produce a false pass.
- Native support-attachment acceptance must cover picker to Firebase Storage to
  callable message creation to participant download. On iOS, upload an `XFile`
  by its file path with `putFile`; do not load full videos into Dart memory.
  Selection must stop at a review step before any upload: assert image preview,
  Cancel with zero backend writes, Replace, explicit Upload, and retained Retry
  state after failure in both English and French.
  Enforce client limits below the backend's strict `<` limits and test the exact
  boundary. Production Storage rules that call `firestore.get` or
  `firestore.exists` also require the Firebase Storage service agent to hold
  `roles/firebaserules.firestoreServiceAgent`; deployment preflight must fail
  closed when that cross-service IAM binding cannot be verified.
- Firestore-backed display formatters must tolerate malformed legacy sentinel
  values without crashing. Preserve explicit bad financial metadata visibly;
  do not silently relabel it as a valid currency. Optional/domain helpers must
  preserve absence as empty so typed fallbacks such as USD can run.
- Keep the durable release matrix in `docs/ios-role-feature-qa.md`. A feature is
  not `PASS` merely because it compiles or its callable succeeds: exercise it in
  the native iOS app, verify the backend record, and verify that the next role
  can see and act on the result.
- Always include a restricted staff account with one permission and a staff
  account with no `businessPermissions`. Verify the Flutter auth state loads
  the permission list, unauthorized tabs and activity listeners are absent,
  and the backend rules independently deny the same reads and writes. Seeded
  owners and full-access staff cannot cover this fail-closed branch.
- Phone verification coverage must include edited-draft status, initial send,
  duplicate activation, asynchronous code callback, wrong/expired code, resend
  cooldown and synchronous resend failure, change-number/cancel, late automatic
  callbacks, success, and Auth-linked/profile-sync recovery. A failed profile
  sync must never require another SMS. Only a Firebase-verified phone may reserve
  a `phoneSignInAliases` document; unverified signup/profile values cannot claim
  login aliases.
- Every new static subdomain must be added atomically to the marketing rsync
  `--delete` exclusions, its own destination sync, the dual-resolver DNS gate,
  page/runtime-asset smoke checks, Firebase Auth authorized domains, and the
  reCAPTCHA Enterprise/App Check allowlist. Browser-test every host even when
  multiple hosts serve the same compiled bundle.
- Resolve and verify each Hostinger website's real document root over SSH before
  publishing. `customer.laawoldigital.com` is a separate Hostinger website at
  `~/domains/customer.laawoldigital.com/public_html`; it is not a sibling
  folder beside the admin and business roots under `laawoldigital.com`.
- Guest marketplace discovery must use App Check-protected, sanitized read
  projections. Regression tests should prove that public parking and
  shared-barrel responses omit private contact details, exact coordinates,
  participant identities, and owner UIDs while authenticated create/pay paths
  remain unchanged.
- Customer pricing parity tests must use at least two providers with distinct
  rates, then switch providers, barrel quantity, freight air/sea mode, and
  weight. Assert the displayed estimate changes accordingly. An unavailable or
  pickup-pending price must remain absent/pending and must never render as zero.
- Time-boxed release exceptions must accept an injected clock and test both one
  millisecond before and the exact cutoff instant. A payment-key exception must
  not downgrade the deployment mode or bypass clean-tree, CI, App Check, IAM,
  test, build, or smoke-check gates.
- A deploy wrapper that verifies a compatible Java runtime must pass that same
  resolved environment to the real Firebase deploy command; otherwise Firebase
  predeploy hooks can fail after a green preflight because macOS cannot locate
  Java from the raw shell environment.
- Firebase Gen 2 can partially deploy a large function catalog and then fail on
  regional Cloud Run CPU or mutation quota. Let the aggregate command settle,
  inspect `firebase functions:list --json`, and retry only `FAILED` or missing
  endpoints one at a time or in pairs with the normal predeploy hooks still
  enabled. Do not retry the full catalog or bypass lint/tests. Disable local
  Firebase CLI usage reporting only when its five-second Analytics timeout is
  converting otherwise successful commands into false failures, then confirm
  every intended endpoint is `ACTIVE` and run `deploy`'s backend smoke suite.
  The full recovery procedure and Java 21 environment are documented in
  `docs/ENGINEERING_GUARDRAILS.md`.
- Hosted Checkout release checks must cover the configured Stripe webhook, not
  only whether the Cloud Function URL responds. Regression coverage should
  prove a paid return Session can self-heal a delayed or missing webhook and
  cannot cross user/type/record boundaries. Signed-in customers redirect to
  the workspace exactly once after persisted payment success. Guests must stay
  on `/pay/return` with the tracking code: success-redirect to `/` is the
  sign-in screen for a logged-out guest. Cover `paymentReturnShouldRedirect`
  plus `confirmCustomerCheckoutSession` without `requireAuth`.
- Customer service discovery tests must join business capabilities to
  destination pricing. Seed misleading cross-service rates (barrel-only with a
  freight price and freight-only with a barrel price) and prove the web exposes
  only options the corresponding create callable will accept. A passing
  pricing-arithmetic test plus a separate backend rejection test is not enough.
- Car transport marketplace coverage must prove server-derived invitations,
  opportunity PII redaction, deterministic one-quote-per-business revision,
  provider permission checks, expiry, withdrawal, customer-only transactional
  one-winner selection, cancellation, selected-provider-only fulfillment
  transitions, and continued `flowVersion: 1` compatibility.
- Deployment tests must prove application secrets are stripped from every
  child process environment; Firebase emulator debug logging can print its
  complete inherited environment.
- Destination coverage tests must cover the exact v2 service map, parent
  capability gates, legacy car fail-closed behavior, positive rates only for
  enabled paid services, quote-only car routes, valid optional delivery
  windows, and ordered weekday-only air/sea departure schedules. Verify those
  logistics fields reach customer comparison UI and the booked freight record
  in both English and French.
- Personnel-management regressions must inventory every admin and business
  entry point and reject legacy create-with-password callables. Cover paginated
  redacted directory reads, exact server search, role/capability fail-closed
  behavior, invitation expiry/resend/cancel/accept (including the safe no-ID
  acceptance path), self-action guards, last-super-admin/last-owner
  protections, ownership transfer, session revocation, and dependency-aware
  deletion/tombstoning. Verify both English and French in a running browser.
- Guest web checkout (customer.laawoldigital.com `?service=barrel`): Continue-as-guest
  must start the anonymous session *and* resume the in-flight submit so Stripe
  opens. Catch-all "Check your connection" copy on `signInAnonymously` masks
  App Check / auth races; map only `network-request-failed` to that line. Do
  not force `getIdToken(true)` or the account-boot spinner for anonymous users
  — that races the guest panel. After Stripe TEST pay, `/pay/return` must show
  the booking/tracking code without sign-in; confirming uses the Checkout
  Session id because the anonymous session often does not survive the
  round-trip. Coverage: `admin_web/src/lib/guest-session.test.ts`,
  `admin_web/src/lib/customer-checkout.test.ts`,
  `my_flutter_app/functions/test/customer-checkout.test.js`, and the
  `ensureGuestOrAccount` / `askHowToContinue` checks in
  `customer-service-intent.test.ts`. Signed-in checkout is
  `ensureGuestOrAccount({ authenticated: true })` and must not open the guest
  sheet.
- Car-hold Checkout (`type=carDeposit`): PaymentIntent metadata stamps
  `buyerUid`, not `customerUid`. Confirm and return verification must treat
  `buyerUid` as the session owner or a paid TEST hold stays pending after
  Stripe redirects. Coverage: `customer-checkout.test.js` (buyerUid-only
  session), `car-purchase.test.js` / `admin_web/src/lib/car-purchase.test.ts`
  (unpaid hold cannot be Mark sold / Completed). Do not switch Stripe mode.
- Pay-on-arrival freight (`payOnArrival` / `paymentTiming: arrival`) is
  secured by `paymentStatus: card_saved`, not a succeeded charge. Weight
  confirm and In transit / Arrived must stay unlocked; the saved card is
  charged when status becomes `ready_for_pickup`. Do not treat `card_saved`
  like unpaid pay-now (that deadlocks fulfillment). Completion still waits
  for `settled`. Customer Pay now is only for abandoned setup or a failed
  arrival charge (`balance_due`). Coverage:
  `admin_web/src/lib/freight-fulfillment.test.ts`,
  `functions/test/freight-settlement.test.js`,
  `functions/test/firestore-rules.test.js` (due_on_arrival writes). Pay-now
  freight (`FR-SNC3FQ` style) still requires succeeded + settled.
- Headquarters street is required for customer drop-off. Coverage:
  `functions/test/business-address.test.js` (compose + empty-street reject),
  `functions/test/service-callables.test.js` (HQ fallback + empty-street
  booking reject), `test/business_profile_validation_test.dart`, and
  `test/drop_off_address_test.dart`. Do not treat a city-only catalog
  `businessAddress` as a configured office.
- Website notification clicks have no URL route. The bell only marks read and
  calls `onSelect`. Routing lives in `admin_web/src/lib/notification-routing.ts`
  and must match the mobile contract in
  `my_flutter_app/lib/services/notification_routing.dart`. Live payloads often
  carry only `shipmentId` / `requestId` / `reservationId` / `purchaseId` /
  `caseId` — infer the collection from `type` and pass focus into the panel
  (Orders inner tab, review composer, support thread, Freight requests,
  Transport jobs vs opportunities). Coverage:
  `admin_web/src/lib/notification-routing.test.ts` plus the functions stamp
  in `notification-triggers.test.js`. Do not treat "opens the sidebar tab"
  as enough: the record or thread must open.
- iOS customer E2E vs web (sandbox, Stripe TEST): Send freight empty,
  missing barrel Pay now, missing inbox bell, and AppGate false-offline.
  Coverage: `test/freight_catalog_filter_test.dart` (Conakry Express
  Senegal 12.50/4 through nested `Map<Object?, Object?>`),
  `test/customer_checkout_resume_test.dart` (resumeRecordId / barrelOrder,
  no duplicate mint), `test/notification_routing_test.dart` (Orders inner
  tab + record; tracking update stays `/tracking`),
  `test/app_gate_boundary_test.dart` (`none` + successful probe = ready;
  `none` + failed probe = offline). Do not switch Stripe mode or pass
  `pk_live`. Maestro `localEmulator()` is not coverage for the real
  AppGate path.
- Cloud Functions scaling contracts live in
  `functions/test/scaling-contract.test.js`: parking availability reads by
  `parkedCars.occupancyEndMs` (never "newest N rows" - that dropped old
  open-ended stays and over-booked), scheduled sweeps filter and order in the
  query and page under a deadline (`scheduled_sweep.js`), and the project-wide
  reserved-CPU budget (sum of maxInstances over every export) stays under
  1,000. Raise maxInstances per hot function, never globally. Any new server
  path that writes parking dates stamps `occupancyEndMs` in the same write;
  the `syncParkedCarOccupancy` trigger covers client writes.
- A test that replaces a broad read with narrow queries should replay those
  queries in memory and require the SAME result as the broad read (see
  `parking-month-scope.test.js`), and query shapes the emulator suite does not
  reach can be checked against an isolated emulator on non-default ports
  when 8080/9099 are taken. The emulator does not enforce composite indexes:
  every new query shape needs its entry in `firestore.indexes.json`.
- Month-end classification ("Who owes" / "Paid" / "Everyone") lives only in
  the three statement modules (`lib/services/parking_month_statement.dart`,
  `admin_web/src/lib/parking-month-statement.ts`,
  `functions/parking_month_statement.js`): paid = billed for the month
  (`monthCents > 0`) and `dueCents == 0`, so prior unpaid carried in keeps a
  customer owing and nothing billed is neither. Screens list
  `customersOwing` / `customersPaid` / `customers` and never re-decide it.
  Any rule change runs the same fixture cases in all three suites
  (`parking_month_statement_test.dart`, `parking-month-statement.test.ts`,
  `parking-month-statement.test.js`); `parking_month_end_parity_test.dart`
  checks each copy still defines it.

- Abuse limits must key on an address the caller cannot forge. On Cloud
  Functions v2 / Cloud Run, Google's front end appends the real client to
  `X-Forwarded-For`, so entry `[0]` is attacker-chosen; use
  `functions/request_guard.js` (`clientAddressFromRequest`, right-most entry,
  `TRUSTED_PROXY_HOPS` if a load balancer is added) and key anonymous sessions
  on that address, never on their throwaway uid. Raw `onRequest` endpoints get
  no automatic App Check: verify `X-Firebase-AppCheck` with
  `admin.appCheck().verifyToken` under `ENFORCE_APP_CHECK` and make sure the
  calling page actually sends it. Coverage:
  `functions/test/security-audit-2026-10.test.js`.
- Rules for records with server-owned money fields use an affected-keys
  allow-list built from what the app and console really write (grep both),
  not a deny-list. Status fields with terminal outcomes stay callable-only for
  business clients (`carPurchases.purchaseStatus`). Storage upload allow-lists
  mirror the callable that later accepts the file, so a type the callable
  refuses is refused at upload too. Rules regressions live at the end of
  `functions/test/firestore-rules.test.js`.
- App-side scaling contracts: business screens read records through
  `lib/services/business_activity_queries.dart` specs (business-scoped,
  bounded by open status / date window / ordered page, never `limit`
  without `orderBy`). `test/firestore_query_scope_test.dart` checks each
  spec's scope, bound and composite index against `firestore.indexes.json`,
  and replays the narrow queries in memory against the whole history (tile
  counts, a month's parking bills) - add every new query shape there.
  `test/scaling_source_contract_test.dart` forbids raw record-collection
  listeners and streams built inside `build` in the audited widgets.
  `test/container_feed_plan_test.dart` replays the containers feed's bounded
  reads over a year of sailings and requires the whole history's chip counts,
  waiting list, box lines and split-package money.
- Label printing (Phomemo M221): raster packing is pinned byte for byte to
  the developer's reference tool via `test/fixtures/m221_pack_fixture.json`
  (regenerate only from `laawol-deploy-logs/m221/m221.py`, never from the
  Dart code). QR codes are verified by reading them back with the
  independent reader `test/fixtures/qr_reader.dart` (format BCH, unmasking,
  Reed-Solomon syndromes), not by comparing to another encoder's matrix:
  valid encoders legitimately pick different masks. The whole print
  sequence (subscribe before write, order, chunk sizes, done-frame waits,
  copies, cancel, reconnect) runs against `FakePrinterTransport`; real
  printing still needs the shop's printer and is not covered by CI.
- Anything that reads `SharedPreferences` with a safety timeout leaves a
  pending timer in widget tests unless the test calls
  `SharedPreferences.setMockInitialValues` first.
- Some tests read source text verbatim, so whole-file `dart format` can fail
  them: `startup_does_not_block_test.dart` greps `lib/main.dart` for
  `_startupStep('push notifications'` and `unawaited(\n` - edit `main.dart` by
  hand, do not reformat it. `inventory_parity_test.dart` treats any backticked
  `` `SomethingInventoryX {` `` / `(` in `docs/INVENTORY.md` as a callable the
  app must call; write Dart class names as `` `InventorySalesArguments` (a, b) ``.
- A screen with a 15 s safety timer cannot have its spinner asserted after
  `pumpAndSettle` (the settle runs the fake clock past the timer). Pump by hand
  (`pumpWidget` + `pump(Duration)`) to see the loading state, then pump past it.
- `app_en.arb` and `app_fr.arb` must have the same keys *including* `@key`
  metadata blocks (`freight_category_test.dart` "catalogs stay key for key
  identical"). Either add the `@key` block to both files or to neither.
- WhatsApp messages: the template name and `{{n}}` order are tested in
  `functions/test/whatsapp-templates.test.js`, which also checks each
  template's variable count against `docs/WHATSAPP_CONTAINER_UPDATES.md`.
  The emulator suite (`npm run test:containers`) fakes Meta at `fetch` and
  asserts the parameters actually sent; check both when a template changes.
- Next's Turbopack build refuses a symlinked `admin_web/node_modules` ("points
  out of the filesystem root"); in a worktree run `npm ci` there instead. A
  production `next build` needs the App Check site key; for a local browser
  check of a public page build with `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true`,
  stub the callable at `window.fetch`, and delete `admin_web/out` afterwards.

- Concurrent Firestore tests in the emulator suites (`functions/test/*-callables`)
  flake unless contention is handled. The emulator locks pessimistically: contending
  transactions wait ~3s and one is given up on, sometimes as INVALID_ARGUMENT
  "Transaction is invalid or closed", which the Admin SDK does not retry (it only
  retries that code when the text says "has expired"). The loser reaches the test
  raw, with no `details.reason` (symptom: outcomes like `['ok', undefined]`, or a
  slow round that times out). It is not a callable defect. In
  `inventory-callables.test.js` wrap each racing call in `untilSettled` /
  `outcomeOf`: they retry only a raw numeric ABORTED / "invalid or closed", never a
  refusal or an HttpsError, give racing sales their own `clientRequestId` so a
  retry is the same sale, and still assert the final state (no overdraw, total =
  sum of the stores). Never serialize the calls to dodge it - that stops proving the
  race. When looping the suite for flake checks start a FRESH emulator per run
  (`npm run test:inventory`): wiping Firestore between runs inside one emulator
  gives constant false failures. If 8080/9099 are held by another session's
  suite, run on a scratch `firebase.json` with other ports instead of killing it.
- Rules mirrored in three languages (server JS, console TS, app Dart) are
  pinned by ONE case file the three suites all run, not by three hand-copied
  test lists: `functions/test/fixtures/line-pieces-cases.json` holds
  `{fn, args, expected}` generated from the JS module and reviewed by hand,
  and `line-pieces.test.js`, `line-pieces.test.ts` and
  `line_pieces_test.dart` each replay every case (JSON null = null or
  absent). A rule change regenerates the file and all three must pass.
  Doubles are part of the contract: include a rounding case (20.555 in).
  An optional field a mirrored writer emits only sometimes (a line's
  `pickupFeeCents`, present only for a collected request) is left OUT of the
  map when absent on all three sides, never written as `null`: the Dart
  replay compares maps key by key, so `{k: null}` and `{}` differ there.
  Money that is a line's own amount beside its pieces (the pickup fee) is
  checked where a total feeds a second call: an edit's
  `setContainerLinePrice` must carry pieces + fee, or the server reads a
  price drop and spreads it over the pieces.
- Calling `pumpWidget` twice in one test with the same screen type keeps the
  first State (`didUpdateWidget`, not `initState`), so `late final` fields built
  from `widget.source` keep the first fake and the second setup is silently
  ignored. Give each setup its own `testWidgets` (or a new `Key`).
- Run `dart format` on the files you wrote, never on a directory: the repo
  is not uniformly formatted, and `dart format lib/services` rewrote 30+
  unrelated files (a merge-conflict magnet for parallel agents). Check
  `git diff --stat` before committing.
- Widget-test traps met on package requests: a `SwitchListTile` inside a
  coloured `Container` asserts ("ink splashes may be invisible") - wrap it in
  a `Material`; a button left spinning while its dialog is open makes
  `pumpAndSettle` time out - clear the busy flag before `showDialog`; a
  validation SnackBar queues ahead of the success one, so a test looking for
  "Saved" finds nothing - show field errors inline instead.
- Timed re-check UIs (the Zelle sheet's 20 s / 3 min countdown) keep the
  schedule in a pure counter (`ZelleRetryCountdown`) and show a static icon,
  not a spinner, while waiting: widget tests drive it with `pump(Duration)`,
  and a spinner running between checks would make `pumpAndSettle` time out.
- Firestore triggers are tested on the emulator by calling
  `exports.<trigger>.run({params, data: {before, after}})` with
  `{exists, data()}` snapshots after writing the document yourself
  (`test/volume-callables.test.js`); the exec'd emulator suites run no
  functions emulator, so nothing fires on its own. Recount-style rollups
  must be asserted idempotent (same event twice, then a rebuild, same
  numbers) and under a concurrent burst.
- `security-contract.test.js` counts `enforceAppCheck: ENFORCE_APP_CHECK`
  occurrences against `= onCall(` exports. A new callable writes its options
  inline (or the test's shared-options offset must be extended); a new
  shared options object breaks the count.
- Parallel worktrees share one machine: another agent's emulator suite may
  hold the default ports (8080/9099/5001/4400/4500). Run emulator suites with
  a private `--config` file (same rules/indexes by absolute path, other
  ports, `ui` off; a `functions.source` must be RELATIVE to the config file's
  directory) and set a short private `TMPDIR` (the Storage emulator keeps its
  blobs under the OS temp dir, so two Storage emulators delete each other's
  files; and the Functions emulator's worker sockets fail with EADDRINUSE
  when the TMPDIR path is longer than ~100 characters). The console reads
  `NEXT_PUBLIC_FIREBASE_{AUTH,FIRESTORE,FUNCTIONS,STORAGE}_EMULATOR_PORT`
  for those ports.
- Browser checks against a full local suite (auth, firestore, functions,
  storage) as a `demo-*` project: the Firebase CLI is the global one
  (`functions/node_modules/.bin` has none, so `npx firebase` fails), Java
  must be on PATH (`/opt/homebrew/opt/openjdk/bin`), and the Functions
  emulator needs a throwaway `functions/.secret.local` naming every
  `defineSecret` (dummy values; delete it afterwards). Run the console with
  `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true NEXT_PUBLIC_FIREBASE_PROJECT_ID=<demo id>`
  via `next dev -p <port>`; `preview_start` by name in a worktree may start
  the main checkout's server instead, so start it from Bash and open the URL.
  Firestore triggers (volume rollups) fire there on their own, unlike the
  exec'd suites. Any dialog fed a stand-in row after a write (labels after
  Received) must get the fields it counts from, not just id and code.
- Flutter web build against the emulators (`--dart-define=USE_FIREBASE_EMULATORS=true`
  plus the private ports): a page RELOAD while an emulator session is persisted
  in IndexedDB sent `signInWithPassword` to production identitytoolkit (seen
  1.0.17; `performance.getEntriesByType('resource')` shows it). Before
  reloading, delete IndexedDB (`indexedDB.databases()` -> deleteDatabase) and
  check the auth requests hit 127.0.0.1. In a hidden browser pane Flutter
  renders late: wait 2-4 s between taps and before typing, or keystrokes land
  in the wrong field. A seeded business user needs `businessServices` on the
  profile for the app's Containers entry (`hasContainersAccess`).
- A list that draws the same card in two branches (the Waiting list with and
  without Expected above it) must pass the same inputs in both: make the
  input `required` so the compiler finds the branch that forgot it
  (`WaitingPackageCard.group`, test/click_through_1_0_17_test.dart).
- Two `tester.tap`s on the same stepper button without a `pump()` between
  them both run the OLD callback (`onQuantity(line.quantity + 1)` with the
  stale quantity), so the count goes up once. Pump between taps. Intl's `jm`
  time puts a narrow no-break space before "PM": match it with
  `RegExp(r'2:40\sPM')`, not a typed space.
- Code-entry screens with a resend countdown (`PhoneSignInScreen`, 30 s
  `ResendCountdown` on a periodic Timer): `pumpAndSettle` after a code is
  sent advances fake time until the countdown ends, so assert
  "Resend code in 30s" with `pump()`, and drive the wait with
  `pump(Duration(seconds: n))`. Fakes two test files share live in
  `test/fixtures/` (`fake_phone_sign_in.dart`) - never import one
  `_test.dart` from another.
- Phone accounts (docs/PHONE_ACCOUNTS.md): refusal copy comes from
  `details.reason` only (web `phone-accounts.ts`, app
  `phoneAccountRefusalText`), never the server's message; a new reason is
  added to the server, both maps and both reason-list tests together. A
  first SMS sign-in writes the profile late (`completePhoneSignIn`): the web
  router waits on `completePhoneSignInOnce` before deciding there is no
  profile, and both clients sign out on `phone_sign_in_unavailable`. The
  merge proof signs in on a SECONDARY Auth instance (web `withSecondaryAuth`:
  in-memory, connects to the emulator, always deleted). New console screens
  get a JSX French-scan test (copy the one in `phone-accounts.test.ts`).
  The server suite is `npm run test:phone-accounts` (auth + firestore); its
  helpers drive Firebase SMS through the Auth emulator's REST
  (`accounts:sendVerificationCode`, `/emulator/v1/projects/<p>/
  verificationCodes`, `accounts:signInWithPhoneNumber`), and
  `accounts:signInWithCustomToken` answers without `localId` (read
  `user_id` from the ID token). A typed number with no account or record is
  deliberately NOT sent a code: seed a record before reading the fake Meta
  message. Browser checks: `whatsapp_unavailable` switching to text, the
  30 s resend countdown, `rate_limited` showing the wait, French on `/t/`
  and My packages, a phone-only profile save.
- Auth's phone-number uniqueness is NOT a lock in production (2026-10: two
  trigger runs at once made two Auth users + two profiles for one number),
  but the Auth emulator enforces it, so an emulator race test with real Auth
  passes even without a lock. Race tests for "one X per key" give
  `createPhoneAccounts` a fake Auth that accepts duplicates and whose phone
  lookup lags (`racyAuth` in `phone-accounts-callables.test.js`), and assert
  one user AND one profile; check it fails on the old code. The lock is a
  Firestore `create()` (`phoneAccountClaims`), not a transaction (emulator
  transactions under contention flake, see above). Trigger cost checks: a
  pure pre-check (`stampIsCurrent`) is unit-tested with a `db`/`auth` that
  throw on any touch.
- A filtered directory page (People "Not signed in yet") must never come
  back empty with "Load more": the server reads Auth pages until full
  (bounded) and the console's `collectPeoplePages` keeps calling until a
  full page or no token.
- Linking a phone number another Auth user holds fails differently per
  SDK: the web SDK (console and Flutter web) throws
  `auth/account-exists-with-different-credential` with the proof in
  `customData`, native SDKs throw `credential-already-in-use`. Check both
  (`phoneHeldByAnotherAccount`); only a real link against the Auth emulator
  shows it - unit tests with a hand-made error code cannot.
- A git worktree that symlinks `admin_web/node_modules` to the main
  checkout to save disk cannot run Turbopack (`next dev` / `next build`
  panic: "Symlink [project]/node_modules is invalid, it points out of the
  filesystem root"). Use `next dev --webpack` / `next build --webpack` for
  local verification there, and say so; a deploy build still runs from a
  real install. `next dev` also rewrites `next-env.d.ts` - restore it
  before committing.
- `flutter gen-l10n` orders a message's parameters ALPHABETICALLY when the
  ARB key has no `@key` placeholders block: `"{who} · {when} · {paid}"`
  generates `(owed, paid, when, who)` and a positional call silently swaps
  the values (a widget test caught "Switched to credit by $40.00 · $20.00").
  Any message with two or more placeholders gets an `@key` block with the
  placeholders in call order, in BOTH ARB files.
- `AppTheme`'s `FilledButton` is full width (`minimumSize: Size(double.infinity, 52)`):
  one placed beside a field in a `Row` throws "BoxConstraints forces an
  infinite width" and blanks the rest of the `ListView` (the bank limit's
  Save did, caught by `bank_check_screens_test.dart`). Give such a button its
  own `FilledButton.styleFrom(minimumSize: ...)`, and render every new screen
  in a widget test, scrolled to its bottom. When copying a test's `_plain`
  helper, write the no-break spaces as `'[  ]'` escapes: pasted
  literally they can arrive as plain spaces and every time match fails.
- Source-reading tests slice files with `indexOf` of the FIRST match:
  `auth_first_login_role_test.dart` takes `} finally {` after the role
  check's catch, so a new `try/finally` placed earlier in
  `auth_provider.dart` broke it (use `whenComplete` there). Widget tests at
  320 px: a long form needs a tall logical viewport (e.g. 640x6000 at dpr 2)
  - `ensureVisible` + tap can miss once a text field holds focus; a route
  under a pushed screen stays built, so find text by the pushed screen's
  key. Adding an Android verified link filter updates the count in
  `inventory_parity_test.dart` (now 5 with `/j/`).
