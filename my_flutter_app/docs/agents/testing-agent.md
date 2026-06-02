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
- For emulator-backed testing, document the exact command here once introduced.

## Regression Checklist

- Does the changed code compile under analyzer?
- Are affected tests present and passing?
- Did generated files need regeneration?
- Are async operations awaited and errors surfaced to the UI?
- Are Firebase security rules, storage rules, or function contracts affected?
- Are route arguments and provider dependencies still valid?

## Output Style

Return exact commands run, pass/fail status, relevant failure snippets, and recommended next tests. If tests cannot be run, explain the blocker and the residual risk.

## Durable Testing Lessons

Add recurring failure modes, project-specific fake patterns, and useful commands here.
