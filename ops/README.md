# Production operations

## Firestore backups

Create the daily backup schedule once for each production database:

```sh
CONFIRM_PROJECT=your-project-id \
  ./ops/configure-firestore-backups.sh your-project-id '(default)'
```

The command is confirmation-gated and refuses to create a second schedule
when one already exists. Backups run daily and are retained for 14 days.

Before launch, perform and record a restore drill into a temporary Firebase
project. Repeat that drill at least quarterly and after material schema or
security-rule changes. Never test a restore over the production database.

## Automated payment alerts

Stripe reconciliation failures are written to
`paymentReconciliationFailures` and mirrored into an urgent platform
notification for the finance role. The original failure record stays open
until an operator investigates it; client applications cannot read or write
the server-only failure ledger.

## Explicit access migration

Before deploying the fail-closed rules, inspect legacy/test accounts:

```sh
cd my_flutter_app/functions
npm run migrate:explicit-access -- --project PROJECT_ID
```

The dry run lists affected user IDs. Because the current dataset is pre-launch
test data, applying the migration defaults legacy admins to `supportAdmin` and
staff to profile-only access. Apply only after review:

```sh
npm run migrate:explicit-access -- \
  --project PROJECT_ID --apply --confirm PROJECT_ID
```

Then bootstrap one verified super admin with the separate secure command and
assign intentional roles/permissions in the console.

## App Check and Crashlytics

Register production Android, Apple, Flutter web, and admin/business web apps in
Firebase App Check. Supply the public web site key through
`NEXT_PUBLIC_FIREBASE_APP_CHECK_RECAPTCHA_SITE_KEY` for the admin build and
`FIREBASE_APP_CHECK_RECAPTCHA_SITE_KEY` as a Flutter `--dart-define`. Production
preflight rejects missing site keys and debug tokens. Register development
debug tokens only in non-production Firebase projects.

Enable Crashlytics for the native Firebase apps and configure symbol uploads
for Android and Apple release builds before distributing a candidate.

## Dependency watch

The app is on the newest mutually resolvable direct dependency set. The one
material exception is `file_picker` 3.0.4: newer releases currently conflict
with the `win32` version required by `package_info_plus`. This keeps the Flutter
web build on the JavaScript renderer because the old picker imports
`dart:html`; release JavaScript builds are verified in CI and remain supported.
Re-run `flutter pub outdated --no-dev-dependencies` during monthly maintenance
and upgrade `file_picker` as soon as that resolver conflict clears, then add a
WebAssembly release build to CI.
