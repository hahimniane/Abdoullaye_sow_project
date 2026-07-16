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
- Local iPhone E2E uses the Xcode beta toolchain explicitly:
  `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer`. Maestro also
  needs Java 21 and should clear the simulator keychain before auth tests,
  because Firebase credentials survive an app-data reset in the iOS Keychain.
  With limited disk/RAM, run emulator suites sequentially and keep one seeded
  project (`car-selling-flutter-app`) for the browser/iPhone acceptance pass.
- The current iOS toolchain may require the `objective_c` package hook to derive
  `DEVELOPER_DIR` from Xcode's compiler path. Treat that as a local cache
  workaround, not a product fix; retest after Flutter or `objective_c` upgrades.
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
