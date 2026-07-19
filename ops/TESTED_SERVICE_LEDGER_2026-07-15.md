# Service acceptance ledger — 2026-07-15

This ledger records the local acceptance pass for the services currently
offered by Laawol Digital. No production deployment or production data was
used. Firebase ran in emulators and payment completion used the explicit
`SIMULATE_PAYMENTS=true` test path.

## Result by service

| Service | Automated contract | Real UI evidence | Result |
| --- | --- | --- | --- |
| Freight | Discovery, authoritative air/sea pricing, pickup, wallet, cancellation, estimate payment, heavier/equal/lighter settlement, refund ordering, permissions, payout gating, rules, tracking, earnings | Business browser confirmed 10 kg estimate to 12 kg final weight and saw fulfillment locked; iPhone customer paid the $25 balance; browser then showed $150 settled and an enabled status control in English/French | Pass locally |
| Direct barrel | Destination/service gating, authoritative booking price, payment metadata, rules, tracking | Business browser rendered `BR-E2E-001`, paid $225, with fulfillment status controls in French | Pass locally |
| Shared barrels | Create/join/approve/deposit/balance/seal/cancel/rollover/idempotency, public mirror privacy, rules | Business browser rendered `pool-e2e` with 2 accepted and 2 open of 4 total, plus operator controls in French | Pass locally |
| Car sales | Atomic simulated full purchase, purchase/payment metadata, listing ownership/rules, customer models | Business browser rendered the RAV4 listing and reserved purchase; earnings showed the paid car transaction | Pass locally |
| Car parking | Capacity/overlap/pricing, option discovery, simulated paid reservation, rules | Business browser rendered the reserved 2021 Honda Accord parking record and paid parking earnings | Pass locally |
| Car transport | Eligible-business/destination discovery, quote-request creation, permission/rules coverage | Business browser rendered `TR-E2E-001` in the transport queue | Request stage passes; commercial lifecycle incomplete |
| Support/notifications | Customer/business/admin case callables, attachments and access rules, delivery-setting helpers | Browser support navigation rendered; emulator outbound FCM was explicitly blocked after this pass exposed a real-network attempt | Pass locally |

## Freight E2E proof

1. Seeded customer estimate: 10 kg at $12.50/kg, $125 paid.
2. Business confirmed 12 kg in the real web UI.
3. Shipment moved to `awaiting_balance_payment`; fulfillment remained locked.
4. Customer saw and paid a $25 balance in the iPhone 17 Pro simulator.
5. Firestore recorded deterministic settlement `freight-e2e-balance_v1`.
6. Final shipment state was `priceSettlementStatus=settled`,
   `finalTotalCents=15000`, `platformFeeCents=1500`,
   `businessPayoutCents=13500`, and `balanceDueCents=0`.
7. Business dashboard showed $150 gross / $15 platform fee / $135 business
   earnings and unlocked the operational status control.

Reusable device flows:

- `my_flutter_app/maestro/customer_freight_settlement.yaml`
- `my_flutter_app/maestro/customer_services_french.yaml`

Visual evidence is under `my_flutter_app/output/ios-e2e/` and
`output/playwright/`.

## Verification commands and counts

- Functions: `npm run lint` — pass.
- Functions unit: 110 tests — pass.
- Multi-service emulator callables: 16 tests — pass.
- Shared-barrel emulator callables: 15 tests — pass.
- Support emulator callables: 3 tests — pass.
- Firestore/Storage rules: 41 tests — pass.
- Flutter: `flutter analyze` — no issues.
- Flutter: `flutter test` — 82 tests passed.
- Flutter: `flutter build web --release` — pass.
- iOS: debug build installed and ran on iPhone 17 Pro / iOS 26.3 — pass.
- Admin: `npm run typecheck` — pass.
- Admin: `npm test` — 33 tests passed.
- Admin: `npm run build` — production build passed.
- Browser: business console checked at desktop and narrow mobile sizes in
  English and French.
- iPhone: customer freight balance payment and French service hub checked with
  Maestro and screenshots.

## Defects found and fixed during acceptance

- Cloud Functions crashed at runtime because the installed Admin SDK did not
  expose legacy `admin.firestore.FieldValue`; all runtime sentinels now use the
  supported modular Firestore export, with a regression contract.
- The iPhone freight card disappeared because the themed full-width
  `FilledButton` was placed in an unconstrained row. The balance action now has
  bounded responsive width and a real-theme widget regression test.
- Emulator mode was blocked by the app's internet gate even when local Firebase
  was healthy. Explicit emulator builds now bypass only that internet gate.
- The customer service hub/bottom navigation and several business-console
  service labels were hardcoded in English. They now render in English/French;
  both Flutter widget and real iPhone/browser checks passed.
- The E2E shared-barrel seed used obsolete capacity fields and falsely rendered
  0/0. It now uses the production share schema and renders 2 open / 4 total.
- Local shipment notifications attempted a real Google OAuth/FCM request.
  Functions emulator mode now records local delivery work but exits before any
  outbound push call, enforced by a regression test.

## Remaining gaps and release risks

1. **Real money rails were not exercised.** There is no Stripe CLI/test webhook
   environment connected here, so real card authorization, refund, webhook,
   dispute, Connect onboarding, and payout behavior remain release-blocking
   external acceptance work. Simulation proves the app/Firebase state machine,
   not Stripe itself.
2. **Car transport stops at quote request.** The customer cannot yet receive,
   accept/decline, pay, or track a business quote through a complete commercial
   lifecycle. Do not market it as a fully bookable paid service yet.
3. **Scheduled reconciliation was not invoked end to end.** The Pub/Sub
   scheduled refund/reconciliation job has unit coverage, but this acceptance
   environment did not run a Pub/Sub emulator/schedule tick.
4. **Storage rules are near the evaluation ceiling.** An intentionally invalid
   support-attachment request hit Firebase's 1,000-expression limit and was
   denied. Valid cases pass, but the shared authorization helpers need
   simplification before more rule branches are added.
5. **iOS dependency/toolchain debt is approaching a build break:**
   `file_picker` lacks Swift Package Manager support, the Stripe iOS plugin uses
   deprecated app lifecycle hooks, and the current `objective_c` build hook
   needed a local Xcode path workaround. None is a committed product fix.
6. **WebAssembly is blocked by the old `file_picker` web implementation** using
   `dart:html`; the JavaScript web release still builds successfully.
7. **The device/browser E2E flows are not yet CI gates.** They are reusable
   locally, but CI currently cannot catch a future mobile layout or full
   cross-surface lifecycle regression.

## Recommended next acceptance milestone

Create a dedicated Stripe test project and CI-safe webhook endpoint, complete
the car-transport quote/payment lifecycle, then add one CI smoke flow per
service plus a nightly iOS/browser freight settlement run.
