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
