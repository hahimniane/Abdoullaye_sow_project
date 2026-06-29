# Plan — Multi-Barrel / Multi-Country Orders + Direct Business Payouts

Implementation spec for another AI/engineer. **No production code is written here — this is the design.**
It builds on patterns already in this repo; reuse them, don't reinvent.

## Goals
1. **Multiple barrels per shipment** — a customer can ship more than one barrel in a single line (a `quantity`), priced `barrelShippingPrice × quantity`.
2. **Multiple countries per order** — a customer can ship to several destination countries (and therefore several businesses) in **one checkout / one payment**.
3. **No escrow — businesses are paid immediately** — Laawol does **not** hold barrel funds until delivery. On successful payment, each business's share is transferred to that business's own Stripe account right away, minus a Laawol platform fee.

## Decisions already made (do not re-litigate)
- **Stripe Connect onboarding is in scope** — businesses onboard Express connected accounts as part of this work.
- **Pickup fee is charged per destination line** (per country/business), not once per order and not per barrel.
- **Laawol takes a platform fee as a percentage** of the **shipping fee** (configurable). The **pickup fee stays 100% with Laawol** (it funds Laawol's own NYC pickup logistics, not the business's service) — apply the % only to `shippingFee`.
- **Charge model: separate charges and transfers.** One PaymentIntent on the platform account for the whole order, then one Stripe transfer per business line on payment success. A single PaymentIntent cannot pay multiple connected accounts, so destination charges are not viable for multi-country orders.

---

## Current state (what exists today — read before changing)

- **One barrel per doc.** `barrelShipments/{id}` = one sender, one receiver, **one** `destinationCountryId`, **one** `businessId`. No `quantity` field.
  Model: `my_flutter_app/lib/models/barrel_shipment.dart`.
- **Single-line form.** `my_flutter_app/lib/screens/send_barrel_screen.dart` holds single `_selectedCountry` + `_selectedBusinessOption`; submits via `BarrelShipmentService.payForShipment` (`lib/services/barrel_shipment_service.dart`).
- **Payment fns** in `my_flutter_app/functions/index.js`:
  - `createBarrelShipmentPaymentIntent` (~line 8894) — computes `total = shippingFee + pickupFee`, writes one shipment doc, creates one PaymentIntent (or simulates), supports wallet debit.
  - `completeBarrelShipmentPayment` (~line 9104), `cancelPendingBarrelShipment` (~line 9175), `changeBarrelShipmentDestination`.
  - Helpers: `createStripePaymentIntent` (~1600) — **charges the platform account only**, no Connect. `getApprovedBusinessDestination` (~1266) validates a (businessId, countryId) pair and returns `{business, country, shippingFee, deliveryEstimate}`. `debitWallet`/`creditWallet` (~2320/2282). `generateTrackingCode`. `SIMULATE_PAYMENTS` flag.
- **No Stripe Connect anywhere.** No `stripeAccountId` on businesses, no `transfer_data`/`on_behalf_of`/`stripe.accounts`. The only `destination:` usages are refund destinations, not payouts.
- **Business model** `lib/models/business_profile.dart` has `status` (`pending`/`approved`), `enabledServices`, `ownerUid`. No payout fields.
- **Firestore rules** `my_flutter_app/firestore.rules` — `barrelShipments` at line 212 (business may only update `status/trackingNumber/trackingCode/staffNotes/statusUpdatedAt/updatedAt`; customer may edit limited sender/receiver/pickup fields while `status == 'pending'`); `businesses` at line 374.
- **Business dashboard / admin console** read `barrelShipments` via `where("businessId","==", …)` (e.g. functions ~1975, admin web). **This query must keep working** — see the key constraint below.

---

## Key constraint (do not break existing queries)

Model an **order as N shipment docs (one per destination line), grouped by a shared `orderId`** — **not** as one doc with an array of lines. Reasons:
- Every business-side query (`where("businessId","==")`), the tracking screen, the business dashboard, and the existing per-shipment Firestore rules continue to work unchanged — each business still sees only its own shipment doc.
- A line for country/business A is naturally invisible to business B (privacy/scoping already enforced by `businessId`).
- The "order" is purely a grouping key + a single payment that fans out.

So: **the cart is a client concept; on the backend it becomes one PaymentIntent + N `barrelShipments` docs sharing `orderId`.** Optionally also write a thin `barrelOrders/{orderId}` doc owned by the customer for receipt/history grouping (see data model).

---

## Phasing (each phase is independently shippable)

### Phase 1 — Multiple barrels (no Connect required)

**Model** — `barrel_shipment.dart`: add `int quantity` (default `1`); optional `double? totalWeightKg`, `String? contentsNote`. Parse from Firestore with `(data['quantity'] as num?)?.toInt() ?? 1`. Add to `copyWith`.

**Function** — `createBarrelShipmentPaymentIntent`:
- Accept `quantity` (validate integer ≥ 1, set a sane max e.g. 20).
- `lineShippingFee = country.barrelShippingPrice * quantity`. Store both `quantity` and `shippingFee = lineShippingFee` (keep `shippingFee` meaning "line shipping total" so downstream code/receipts are unchanged).
- `total = lineShippingFee + pickupFee` (pickup unchanged in Phase 1).

**UI** — `send_barrel_screen.dart`: a quantity stepper (−/+ , min 1) in the destination `_FormSection`. `_PriceEstimateCard` shows `unit × qty = lineTotal`. `_canPay`/`_needsPriceReview` math uses the multiplied fee.

**Receipt** — `lib/utils/barrel_receipt_generator.dart`: show quantity and unit price.

**Done when:** a customer can ship N barrels to one country, pays `N × price + pickup`, gets a receipt showing the quantity, and the business sees one shipment doc with `quantity = N`.

---

### Phase 2 — Multiple countries (cart, one payment)

**Client cart model (new)** — a `BarrelOrderLine` value type: `{ DestinationCountry country, BusinessDestinationOption business, String receiverName, String receiverPhone, bool receiverPhoneIsWhatsappOnly, int quantity }`. Sender name + pickup choice/address/borough/datetime are **order-level** (shared across lines).

**UI** — `send_barrel_screen.dart` becomes order-oriented:
- Sender + pickup sections stay order-level (as today).
- A **"Destinations" cart**: "Add destination" opens the country → business → receiver → quantity sub-form (reuse `DestinationCountryField`, `_BusinessOptionSelector`, receiver fields, the WhatsApp-number rule `_ReceiverPhoneRules`, and the Phase-1 stepper). Added lines render as editable/removable cards.
- Price card sums all lines: `orderTotal = Σ(country.barrelShippingPrice × qty) + Σ(pickupFee per line)`. **Pickup fee is per line** (charged once per destination line). Wallet option stays order-level.
- Submit button enabled when ≥ 1 valid line and pricing resolved.

**Service** — add `BarrelShipmentService.payForOrder({ senderName, pickup…, useWalletBalance, List<lineDto> lines })`. `lineDto = { destinationCountryId, businessId, receiverName, receiverPhone, quantity }`. Calls a new callable; then runs the existing Stripe PaymentSheet flow once for the whole order (reuse the simulated-vs-real branch already in `payForShipment`); returns the list of created shipments (or the order) for receipt generation.

**New function `createBarrelOrderPaymentIntent`** (model on `createBarrelShipmentPaymentIntent`):
- `requireAuth`. Validate `lines` is a non-empty array (cap length, e.g. ≤ 10). For each line validate sender/receiver/phone (`requireValidPhoneNumber`), `quantity ≥ 1`.
- For each line, `getApprovedBusinessDestination({businessId, countryId})` → `shippingFee × quantity`; compute `pickupFee` per line from `barrelPickupPricingFromData` (same pickup pricing doc) when `pickupRequested`.
- `orderTotal = Σ lineTotals`; `orderTotalCents = round(orderTotal*100)`.
- Allocate one `orderId` (`barrelOrders.doc().id` or a generated id). In a single transaction: optional `debitWallet` for `orderTotalCents`; create **one `barrelShipments` doc per line**, each carrying: all existing per-shipment fields, plus `orderId`, `quantity`, `shippingFee` (line total), `pickupFee` (line), `platformFeeCents`, `businessPayoutCents` (see Phase 3 — write `0`/full-to-business until Connect live), `payoutStatus: 'pending'`. Split the wallet credit across lines proportionally OR record `walletAppliedCents` at order level on the `barrelOrders` doc (simpler — prefer order-level).
- One PaymentIntent for the **card portion** (`orderTotalCents − walletAppliedCents`) on the platform account, `metadata: { orderId, paymentType: 'barrel_order', customerUid }`. Mirror the existing `SIMULATE_PAYMENTS` + zero-charge (`simulatedPayment: true`) branches.
- Return `{ orderId, shipmentIds[], trackingCodes[], clientSecret?, simulatedPayment, walletAppliedAmount, cardChargeAmount }`.

**New function `completeBarrelOrderPayment({ orderId })`** — verify intent succeeded (mirror `completeBarrelShipmentPayment`), flip every shipment in the order to `paymentStatus: 'succeeded'`, `status: 'pending'`, set `paidAt`. **This is where Phase 3 transfers fire.** Also `cancelPendingBarrelOrder` mirroring `cancelPendingBarrelShipment` (reverse wallet, cancel all lines).

**Receipt** — extend `barrel_receipt_generator.dart` to render a multi-line order (one section per destination, order total), or generate one receipt per shipment grouped under the order — match product preference; default to a single order receipt listing all lines.

**Done when:** one checkout ships barrels to 2+ countries, creating N shipment docs sharing one `orderId`, paid by one card charge; each business sees only its own line; tracking shows each shipment.

---

### Phase 3 — Stripe Connect onboarding + immediate payouts (platform fee %)

**3a. Connect onboarding (one Express account per business)**

- **Business model / Firestore:** add to `businesses/{id}`: `stripeAccountId` (string), `payoutsEnabled` (bool, default false), `chargesEnabled` (bool), `connectOnboardedAt`. Mirror on `business_profile.dart`.
- **New callable `createBusinessStripeAccountLink({ businessId })`** (secret `STRIPE_SECRET_KEY`):
  - `requireBusinessManager(uid, businessId)` (reuse existing helper).
  - If no `stripeAccountId`, `POST /v1/accounts` (`type=express`, `capabilities[transfers][requested]=true`, prefill email/country from business). Save `stripeAccountId`.
  - `POST /v1/account_links` (`type=account_onboarding`, `refresh_url`/`return_url` to the business dashboard). Return the URL. Add `stripeRequest` form-encoded helpers alongside `createStripePaymentIntent`.
- **New callable `refreshBusinessStripeAccountStatus({ businessId })`** — `GET /v1/accounts/{id}`, persist `payoutsEnabled = charges_enabled && payouts_enabled`, `chargesEnabled`. Call on dashboard load / `return_url`.
- **Webhook** — extend the existing Stripe webhook handler to listen for `account.updated` and persist the same flags (keeps status fresh without polling).
- **UI** — a "Payouts" card in the business console/dashboard (`admin_web/src/components/business-console.tsx` and the Flutter business surfaces): "Connect bank account" CTA → opens the account link; show `payoutsEnabled` state; block enabling the barrel listing for payout until `payoutsEnabled` (or allow listing but queue payouts — see 3b).

**3b. Immediate payout on payment success (separate charges + transfers)**

- **Config:** platform fee percent in `shipmentPricing/barrelPickup` (or a new `platformFees` doc / env): `barrelPlatformFeePct` (e.g. `0.10`). Read it in the order functions.
- **On write (Phase 2 fn):** per line, `platformFeeCents = round(lineShippingFeeCents * pct)` (fee applies to **shipping only**, not pickup), `businessPayoutCents = lineShippingFeeCents − platformFeeCents`. Persist both on the shipment doc. **Pickup fee is not transferred** (stays with platform).
- **On payment success (`completeBarrelOrderPayment` + webhook for card flows):** once the order's `paymentStatus === 'succeeded'`, for **each line** create a Stripe transfer:
  `POST /v1/transfers` with `amount=businessPayoutCents`, `currency=usd`, `destination=business.stripeAccountId`, `transfer_group=orderId`, `metadata[shipmentId]`, and `source_transaction` set to the order charge if available (keeps transfer within available balance).
  - Make it **idempotent**: set `Idempotency-Key: transfer_${shipmentId}`; before transferring check the shipment's `payoutStatus !== 'paid'`. On success set `payoutStatus:'paid'`, `payoutTransferId`, `paidOutAt`. On failure set `payoutStatus:'failed'`, log, and surface for retry.
  - **Business not yet onboarded** (`!payoutsEnabled` or no `stripeAccountId`): set `payoutStatus:'pending_account'` and **do not fail the customer's payment**. A reconcile path (the `account.updated` webhook, or a scheduled function) retries the transfer once `payoutsEnabled` becomes true.
- **"Immediately" = on payment success, not on delivery.** Funds touch the platform balance only momentarily, then move — this is the no-escrow behavior. Do not gate transfers on shipment `status`/delivery.

- **Reporting:** business dashboard reads `businessPayoutCents` / `payoutStatus` per shipment to show "you'll receive / you received $X". Admin console shows platform-fee totals.

**Done when:** a business with a connected account, on a paid order, receives a Stripe transfer of `shipping − fee%` per line within seconds of payment; pickup fee and platform fee stay with Laawol; un-onboarded businesses get their transfer auto-retried after they finish onboarding; nothing is held to delivery.

---

## Firestore rules changes (`my_flutter_app/firestore.rules`)
- `barrelShipments`: allow the new fields on **create** (server-written via Functions with admin SDK, so create stays Function-side — no client create of paid shipments; confirm clients never create these directly). Ensure the customer-update allowlist (line ~243) is **not** widened to payout/fee fields. Business-update allowlist (line ~227) stays as-is — businesses must **not** edit `payoutStatus`, `platformFeeCents`, `businessPayoutCents`, `orderId`.
- `businesses`: allow a business manager to read `stripeAccountId`/`payoutsEnabled` on their own doc; these are written by Functions only (do not allow client writes to payout fields).
- New `barrelOrders/{orderId}` (if added): `allow read: customerUid == auth.uid || isAdmin`; writes Function-only.

## New/changed files (checklist)
- `lib/models/barrel_shipment.dart` — `quantity`, payout fields, `orderId`.
- `lib/models/barrel_order.dart` (new, optional) + `BarrelOrderLine`.
- `lib/models/business_profile.dart` — `stripeAccountId`, `payoutsEnabled`.
- `lib/screens/send_barrel_screen.dart` — quantity stepper (P1), cart UI (P2).
- `lib/services/barrel_shipment_service.dart` — `payForOrder`, account-link calls.
- `lib/utils/barrel_receipt_generator.dart` — quantity + multi-line order.
- `functions/index.js` — `createBarrelOrderPaymentIntent`, `completeBarrelOrderPayment`, `cancelPendingBarrelOrder`, `createBusinessStripeAccountLink`, `refreshBusinessStripeAccountStatus`, `account.updated` webhook branch, transfer helper, fee config; extend `createBarrelShipmentPaymentIntent` for `quantity` (P1). Keep old single-shipment fns working for backward compatibility.
- `admin_web/src/components/business-console.tsx` (+ business dashboard) — Payouts/Connect card, payout status columns.
- `firestore.rules` — as above.

## Test / acceptance
- Reuse the `business-dashboard-tester` agent for dashboard regression (payouts card, per-line scoping, admin console unbroken).
- Functions tests: extend `functions/test/firestore-rules.test.js` for the new fields/rules; add order-creation + transfer-idempotency unit coverage with `SIMULATE_PAYMENTS`.
- Manual: P1 quantity pricing; P2 two-country order → 2 docs, one charge; P3 transfer on success, un-onboarded business → `pending_account` → auto-retry after onboarding; verify pickup fee + platform fee retained by Laawol.

## Rollout notes
- Ship P1 → P2 behind the existing simulate flag first; turn on real Connect transfers only after at least one business completes onboarding.
- Backward compatibility: existing single-shipment code path and old `barrelShipments` docs (no `orderId`/`quantity`) must keep rendering — default `quantity` to 1 and treat missing `orderId` as a standalone order.
