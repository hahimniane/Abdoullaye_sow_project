# Local iPhone acceptance flows

These flows target the Firebase emulator seed, never production.

1. Start Auth, Firestore, Functions, and Storage emulators for project
   `car-selling-flutter-app` with `SIMULATE_PAYMENTS=true`.
2. Run `cd functions && npm run seed:e2e-emulator`.
3. Launch the Flutter app with:

   ```sh
   DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer \
   flutter run -d DEVICE_ID \
     --dart-define=USE_FIREBASE_EMULATORS=true \
     --dart-define=SIMULATE_PAYMENTS=true
   ```

4. Run `customer_freight_settlement.yaml` first. It resets app/keychain state,
   signs in, pays the seeded $25 freight balance, and verifies settlement.
5. Run `customer_services_french.yaml` while the customer remains signed in to
   verify the localized service hub.

Maestro on this Mac needs Java 21 and the same `DEVELOPER_DIR` value. Reseed
before repeating the freight flow because a successful run intentionally leaves
the shipment settled.
