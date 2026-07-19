# Local iPhone acceptance flows

These flows target the Firebase emulator seed, never production.

1. Start Auth, Firestore, Functions, and Storage emulators with one explicit
   demo project ID:

   ```sh
   SIMULATE_PAYMENTS=true firebase emulators:start \
     --config firebase.json \
     --only auth,firestore,functions,storage \
     --project demo-laawol-e2e
   ```

2. Seed the same project from another terminal:

   ```sh
   cd functions
   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
   GCLOUD_PROJECT=demo-laawol-e2e \
   E2E_TEST_PASSWORD='an-at-least-12-character-test-password' \
   npm run seed:e2e-emulator
   ```

3. Launch the Flutter app with stable Xcode selected by `xcode-select`:

   ```sh
   flutter run -d DEVICE_ID \
     --dart-define=USE_FIREBASE_EMULATORS=true \
     --dart-define=FIREBASE_EMULATOR_PROJECT_ID=demo-laawol-e2e \
     --dart-define=SIMULATE_PAYMENTS=true
   ```

4. Pass the seeded password to Maestro with
   `-e E2E_TEST_PASSWORD='the-seeded-password'`. Exporting a shell variable is
   not sufficient; without `-e`, Maestro types the literal placeholder.
5. Run `customer_freight_settlement.yaml` first with Java 21 and the simulator
   UDID. It resets app/keychain state, signs in, pays the seeded $25 freight
   balance, and verifies settlement:

   ```sh
   JAVA_HOME=/opt/homebrew/opt/openjdk@21 \
   ~/.maestro/bin/maestro --udid DEVICE_ID test \
     -e E2E_TEST_PASSWORD='the-seeded-password' \
     maestro/customer_freight_settlement.yaml
   ```

6. Run `customer_services_french.yaml` while the customer remains signed in to
   verify the localized service hub.

Maestro on this Mac needs Java 21. Stable Xcode 26.6 has been verified with a
real Flutter tap and the complete freight-settlement flow; no
`DEVELOPER_DIR` override is required. Reseed before repeating state-mutating
flows because a successful run intentionally changes the fixture.

Flutter often merges a tappable row's title and subtitle into one multiline
accessibility label. Prefer multiline-safe selectors such as
`(?s).*Browse cars.*` instead of exact title matches.

Shared-barrel branches are stateful. Reseed, then run `open`, `join`, and either
`approve` or `reject` in that order. For cancellation, reseed and run `open`
before `cancel`.
