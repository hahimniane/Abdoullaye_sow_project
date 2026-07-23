# PLAN — Customer Web Parity (Implementation Spec)

**Goal:** customers can do on the web (`customer.laawoldigital.com`, served from `admin_web`) everything they do in the mobile app — all six services end-to-end, plus auth, payments, wallet, tracking, support, profile. Design may differ for screen size; **behavior, data, and outcomes must match the mobile app exactly.**

**Payments decision:** **Stripe Checkout (redirect).**
**Status:** spec ready to execute. This document is self-contained — an agent can build from it without re-deriving contracts.

> **MANDATORY:** obey `docs/ENGINEERING_GUARDRAILS.md`. Definition of Done = typecheck + tests + build pass **and** verified in a real browser (EN **and** FR, desktop **and** narrow mobile). Every user-facing string added to `french-dom.ts` (incl. `placeholder`/`title`/`aria-label`). Reuse before building. Loading states always resolve (safety timeout). No O(N)-per-render. Deploy through `deploy/` preflight (clean tree, tests, build-from-source; Cloud Functions need JDK 21+ on PATH).

---

## 0. How to use this doc

Each service section below gives: **(a)** entry point + form fields, **(b)** the exact Cloud Function payloads (already used by mobile — do not invent), **(c)** the Checkout adaptation, **(d)** detail/cancel, **(e)** Firestore reads, **(f)** acceptance criteria. Build **Phase 0 first** — nothing else works without it.

**Backend contract you must preserve:** every paid flow in mobile is `create*PaymentIntent(payload) → { <recordId>, simulatedPayment, clientSecret } → complete*Payment({recordId}) | cancelPending*({recordId})`. On web we keep the record-creation and completion logic but replace the PaymentSheet middle with **Stripe Checkout redirect** (§3).

---

## 1. Current web state (audit)

`admin_web/src/components/customer-console.tsx` is a **read-only second screen** (accounts created on mobile). Present today:

| Area | Web today | Gap vs mobile |
|---|---|---|
| Auth | Sign-in only | No sign-up, forgot-password, phone verification, account deletion |
| Home | Activity summary (read) | No service actions |
| Cars | Browse list (read) | No detail, favorites, viewing reservation, deposit, **purchase**, my-purchases |
| Orders | Aggregated status list (read) | No detail, cancel, modify |
| Tracking | Status text only | No live Maersk/freight/barrel tracking |
| Wallet | Balance + transactions (read) | No card-refund request |
| Profile | Read-only | No edit, notif prefs, language, deletion |
| 6 services | ❌ cannot request or pay | All create+pay flows |
| Support | ❌ none | Real-time chat |
| Payments | ❌ none | Every paid action |

Data model already correct and shared with mobile (`barrelShipments`/`freightShipments`/`transportRequests`/`parkedCars` keyed on `customerUid`; `carPurchases` on `buyerUid`; `wallets/{uid}` + `transactions`; `cars` on `status=="active"`). Routing `resolveConsoleKind` fails closed. 79 web unit tests pass.

---

## 2. Architecture, conventions & reusables

**App shell:** `admin_web/src/components/console-router.tsx` gates by role → renders `CustomerConsole`. All new customer UI lives under `admin_web/src/components/` + logic/tests under `admin_web/src/lib/`.

**Firebase:** `@/lib/firebase` exports `auth, db, functions, storage`. Callables: `import { httpsCallable } from "firebase/functions"`. Prod by default; emulator only when `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true`.

**Reuse these (do NOT re-implement):**
- `@/lib/format` → `text(value, fallback)`, `optionalText`, `formatMoney(value, currency="USD")`, `formatDate(value)`, `asDate(value)`, `currentLanguage()`, `currentLocale()`.
- `@/lib/french-dom` → DOM i18n; add EN→FR entries for every new string.
- `@/types/admin` → `Role`, `FirestoreRow`, `UserProfile`, `Metric`.
- `country-catalog.ts` (all countries) / `us-locations.ts` (all US states) for pickers — **complete sets required** (barrel destination subset is the only allowed exception).
- Existing CSS classes in `globals.css` (`app-shell`, `panel`, `metric-grid`, `row-list`, `data-row`, `empty-state`, `error-box`, `status-pill`, `primary-button`, `secondary-button`, `section-intro`, `login-card`).

**Shared payloads (identical shape, reuse a single builder):**
```ts
// marketplaceDisclosure — required by every PAID service call
{ accepted: true, version: "marketplace-provider-responsibility-v1", locale: currentLocale() }
// legalAcceptance — required by signup
{ accepted: true, version: "terms-privacy-marketplace-v1", locale: currentLocale() }
```
Build `@/lib/disclosures.ts` exporting `marketplaceDisclosure()` and `legalAcceptance()`.

**Dates:** all callables expect UTC ISO-8601 (`new Date(...).toISOString()`).

**i18n rule:** the `french-dom` translator replaces exact text nodes. Interpolated strings (e.g. `Welcome, {name}`) need the static prefix (`"Welcome, "`) as its own key — **known existing bug: `"Welcome,"` is untranslated; fix it.**

---

## 3. Phase 0 — Payments backend + shared web infra (CRITICAL PATH)

### 3.1 Checkout backend (new Cloud Functions in `my_flutter_app/functions`)
Today the functions create **PaymentIntents** and return `client_secret` (13 sites; **0 Checkout Sessions, 0 webhooks**). For redirect Checkout, add:

1. **One `createCheckoutSession` callable per paid action** (or a generic factory keyed by `{ orderType, payload }`). Each must run the **same validation + pending-record creation** as its `create*PaymentIntent` sibling, then:
   ```js
   stripe.checkout.sessions.create({
     mode: "payment",
     line_items: [{ price_data: { currency, unit_amount, product_data:{name} }, quantity:1 }],
     success_url: `${CONSOLE_URL}/pay/return?type=<orderType>&id=<recordId>&session={CHECKOUT_SESSION_ID}`,
     cancel_url:  `${CONSOLE_URL}/pay/return?type=<orderType>&id=<recordId>&status=cancel`,
     metadata: { orderType, recordId, uid },
     payment_intent_data: { transfer_data / application_fee ... }  // preserve existing Connect split
   })
   ```
   Return `{ recordId, url, simulatedPayment }`. Reuse the existing Connect/destination-charge + wallet-credit logic from the PaymentIntent siblings — **do not diverge fee math**.
2. **Stripe webhook function** (`functions.https.onRequest`) handling `checkout.session.completed` (+ `checkout.session.expired`/`async_payment_failed`). On success it runs the **exact finalization** of the matching `complete*Payment` callable (keyed by `metadata.orderType`); on failure/expiry runs the matching `cancelPending*`. Must verify signature (`stripe.webhooks.constructEvent`) and be **idempotent** (guard against double-finalize from webhook + return).
3. **Return reconciliation:** `/pay/return` route (web) reads `type`+`id`, subscribes to the Firestore record, and shows pending → success/failure once the webhook flips status. Never finalize on the client from the return URL alone.

**Paid actions needing a session function** (amounts/fees already computed server-side): barrel shipment, barrel order (multi-line), barrel destination change, barrel pool deposit, barrel pool balance, freight shipment, freight settlement, parking reservation, car deposit, car purchase, paid hold extension. **Unpaid (no session):** transport request, car viewing reservation, all support/profile actions.

### 3.2 Shared web components/hooks (build once)
- `@/lib/use-checkout.ts` → `startCheckout(orderType, payload)`: calls the session callable, then `window.location.assign(url)`; handles `simulatedPayment` (skip redirect, poll record). Pure request-builder split out + unit-tested.
- `@/components/pay-return.tsx` (route `/pay/return`) → resolves payment status from Firestore with a safety timeout.
- `@/components/service-request-form.tsx` → multi-step shell: **fields → review → pay**, localized validation, disabled-submit while pending, error box, always-resolving loading.
- `@/components/order-detail-drawer.tsx` → shared detail + cancel-action pattern for all order types.
- `@/components/disclosure-checkbox.tsx` → marketplace/legal acceptance UI (blocks submit until checked).
- `@/lib/phone.ts` → port `PhoneNumberValidator` (E.164) used by signup + every phone field.

### 3.3 Auth (unblocks new users)
- **Sign-up** form (`RoleSignInCard` gains a "Create account" toggle): fields **fullName, email, password, phone, legal-acceptance checkbox** → `createCustomerUser({ email, password, fullName, phone, legalAcceptance })` → then `signInWithEmailAndPassword`.
- **Forgot password** → `sendPasswordResetEmail(auth, email)`.
- **Phone verification** → Firebase phone auth + `syncVerifiedCustomerPhone`.
- **Account deletion** (Phase 5) → `requestOwnAccountDeletion`.
- Public site: add the customer-app CTA to **every** page's shared header/footer (only `index.html` has it today).

### 3.4 Phase 0 acceptance
New user registers on web → verifies email/phone → lands in CustomerConsole. A test paid action redirects to Stripe, pays with a test card, returns to `/pay/return`, and the Firestore record flips to paid via webhook. All strings EN+FR. Unit tests for request-builders + webhook router.

---

## 4. Per-service specs

> For each: form fields come from the callable payload (authoritative). All amounts/fees are server-computed — the web never sets prices.

### 4.1 Cars (Phase 1 — first shippable milestone)
- **Browse** (exists, extend): `cars where status=="active"`. Add search/filter parity with mobile.
- **Detail page:** photos, price, specs, business, favorite toggle (`favorites` collection or user field — match mobile `favorite_cars_screen`).
- **Reserve viewing (unpaid):** `createCarViewingReservation({ carId, buyerName, buyerPhone, appointmentStart(ISO), appointmentLabel })`; update via `updateCarViewingReservation({ purchaseId, appointmentStart, appointmentLabel })`; cancel `cancelCarViewingReservation({ purchaseId })`.
- **Reserve with deposit (paid):** `createCarDepositPaymentIntent({ carId, buyerName, buyerPhone, holdUntilDate(ISO), marketplaceDisclosure })` → session → complete `completeCarDepositReservation({ purchaseId })` / cancel `cancelPendingCarPurchase({ purchaseId })`.
- **Buy (paid):** `createCarPurchasePaymentIntent({ carId, buyerName, buyerPhone, marketplaceDisclosure })` → session → `completeCarPurchase({ purchaseId })` / `cancelPendingCarPurchase`.
- **Paid hold extension:** `requestPaidHoldExtension({ purchaseId, requestedHoldUntilDate(ISO) })` then when approved `createPaidHoldExtensionPaymentIntent({ purchaseId, marketplaceDisclosure })` → session → `completePaidHoldExtensionPayment({ purchaseId })`.
- **My purchases:** `carPurchases where buyerUid==uid` (already read on web — add detail/actions). Pricing helper `getCarHoldPricing`.
- **Accept:** register → buy a car on web end-to-end; deposit + viewing + hold extension all work; EN/FR; regression test.

### 4.2 Barrel shipping — individual (Phase 2)
- **Address autocomplete:** `suggestPickupAddresses({ input })` → list of `{ description, placeId, borough, postalCode, formattedAddress, latitude, longitude }`.
- **Destination options:** `listActiveBarrelDestinationOptions` (business + price per destination).
- **Single shipment (paid):** `createBarrelShipmentPaymentIntent({ senderName, receiverName, receiverPhone, destinationCountryId, businessId, quantity, pickupRequested, pickupAddress, pickupBorough, useWalletBalance, marketplaceDisclosure, pickupDateTime?(ISO) })` → `{ shipmentId, simulatedPayment, clientSecret }` → session → `completeBarrelShipmentPayment({ shipmentId })` / `cancelPendingBarrelShipment({ shipmentId })`.
- **Multi-line order (paid):** `createBarrelOrderPaymentIntent({ senderName, useWalletBalance, lines:[…], pickupRequested?, pickupAddress?, pickupBorough?, marketplaceDisclosure, pickupDateTime?(ISO) })` → `{ orderId, shipmentIds[], simulatedPayment, clientSecret }` → `completeBarrelOrderPayment({ orderId })` / `cancelPendingBarrelOrder({ orderId })`. (Legacy fallback: single line → `createBarrelShipmentPaymentIntent`.)
- **Change destination (maybe paid):** `changeBarrelShipmentDestination({ shipmentId, destinationCountryId, businessId, changeRequestId, marketplaceDisclosure })` → if `requiresPayment` session → `completeBarrelDestinationChange({ shipmentId, changeRequestId })` / `cancelPendingBarrelDestinationChange`. Handle `failed-precondition "needs support"`.
- **Detail/cancel** from `barrelShipments`.
- **Accept:** request + pay a barrel shipment, change destination, cancel pending — all on web.

### 4.3 Freight (Phase 3)
- **Pickup quote:** `quoteFreightPickup({ businessId, pickupAddress?, pickupBorough?, pickupLatitude?, pickupLongitude? })` → `{ fee, model, distanceKm? }`.
- **Create (paid):** `createFreightShipmentPaymentIntent({ senderName, receiverName, receiverPhone, destinationCountryId, businessId, mode("air"|"sea"), weightKg, pickupRequested, pickupAddress?, pickupBorough?, pickupDateTime?(ISO), useWalletBalance, marketplaceDisclosure })` → `{ shipmentId, simulatedPayment, clientSecret }` → session → `completeFreightShipmentPayment({ shipmentId })` / `cancelPendingFreightShipment`.
- **Settlement (verified-weight balance, paid):** `createFreightSettlementPayment({ shipmentId, marketplaceDisclosure })` → `{ settlementId, attemptId, simulatedPayment, alreadySettled, clientSecret }` → session → `completeFreightSettlementPayment({ settlementId, attemptId })`.
- **Accept:** quote → pay freight → settle balance on web.

### 4.4 Car transport (Phase 3, unpaid)
- **Options:** `listTransportBusinessOptions`.
- **Create:** `createTransportRequest({ businessId, destinationCountryId, destinationCountryName, ownerName, carMake, carModel, carYear, customerPhone, vinNumber, pickupAddress, notes, preferredDate?(ISO) })` → `{ id, trackingCode }`.
- **Detail/cancel** from `transportRequests`.

### 4.5 Parking (Phase 4)
- **Search:** `listParkingOptions({ city, startDate(ISO), endDate(ISO), customerLatitude?, customerLongitude?, pickupRequested })` → `{ options:[…] }`.
- **Reserve (paid):** `createParkingReservation({ businessId, customerName, customerPhone, carMake, carModel, carYear, vinNumber, startDate(ISO), endDate(ISO), pickupRequested, marketplaceDisclosure })` → `{ reservationId, trackingCode, simulatedPayment, clientSecret }` → session → `completeParkingReservation({ reservationId })` / `cancelPendingParkingReservation`.
- **Detail** from `parkedCars`.

### 4.6 Shared barrels / pools (Phase 4)
- **List open pools:** `barrelPools where status=="open"`.
- **Create pool (paid deposit):** `createBarrelPool({ businessId, destinationCountryId, senderName, senderAddress, receiverName, receiverPhone, contentsDescription, attestedWeightKg, contentsAttested, prohibitedItemsAcknowledged, … })` → deposit session → `completeBarrelPoolDepositPayment` / `cancelPendingBarrelPoolDeposit`.
- **Join pool:** `requestJoinBarrelPool({ poolId, destinationCountryId, sharesClaimed, senderName, senderAddress, receiverName, receiverPhone, contentsDescription, attestedWeightKg, … })`; owner decides via `decideBarrelPoolJoin`.
- **Balance payment:** `createBarrelPoolBalancePaymentIntent` → session → `completeBarrelPoolBalancePayment`.
- **Leave/cancel:** `leaveBarrelPool` / `cancelBarrelPool`.

### 4.7 Support (Phase 5)
- **Open case:** `createOrOpenSupportCase(request.toJson())` → `{ caseId }`.
- **Send message:** `sendSupportMessage({ caseId, content, messageType:"text", replyTo? })`.
- **Read/typing:** `markSupportCaseRead({ caseId })`, `setSupportTyping({ caseId, typing })`.
- **Real-time:** subscribe to the case + messages subcollection (match mobile `support_thread_screen`).
- **Attachments — BLOCKED** until Storage rules fixed (see Risks). Ship text chat first.

### 4.8 Wallet / Profile / Tracking (Phase 5)
- **Wallet** (read exists): add `requestWalletCardRefund` action.
- **Profile edit:** `updateCustomerProfile(...)`, notification preferences, language, legal links (`utils/legal_links` equivalents), account deletion `requestOwnAccountDeletion`.
- **Tracking:** embed Maersk + freight/barrel tracking (mobile uses webview; web can iframe/redirect).

---

## 5. Cross-cutting requirements (every phase)

- **Localization:** every new string → `french-dom.ts` (EN + FR), incl. `placeholder`/`title`/`aria-label`. Verify both languages render. Fix the `"Welcome,"` gap.
- **Firestore rules & App Check:** every new client write path must pass prod rules; verify reCAPTCHA-Enterprise App Check is satisfied for new callable + webhook paths.
- **Tests:** one contract/regression test per flow (mirror existing `customer-console-contract.test.ts` / `console-routing.test.ts` style: assert exact callable names + payload keys + rules-scoped queries). Run `node --test` — keep green.
- **Responsive:** verify desktop + narrow-mobile in a real browser per guardrails.
- **Idempotency:** guard webhook + return double-finalization.

---

## 6. Risks / blockers

- **Storage rules broken for non-admin uploads** (memory `storage-rules-cross-service-broken`): blocks support attachments + any web image upload. Fix rules before Phase 5 attachments. Text chat unaffected.
- **App Check enforcement** on web callables/webhook — verify before relying on new functions.
- **Checkout vs PaymentIntent divergence** — session functions must reuse the existing fee/Connect/wallet math; do not fork pricing.
- **Legal/marketplace acceptance** payloads must match the versions in §2 exactly.
- **Deploy prereqs** (memory `functions-deploy-prereqs`): JDK 21+ on PATH + eslint install to deploy the new functions.

---

## 7. Phasing & milestones

**Phase 0** (payments backend + shared infra + auth) → **Phase 1 Cars** (register→browse→buy) → **Phase 2 Barrel** → **Phase 3 Freight+Transport** → **Phase 4 Parking+Pools** → **Phase 5 Support+Tracking+Profile**. Phase 0 is the gate. Each phase ships only when its acceptance criteria pass in a real browser, EN+FR, with tests.

---

## Appendix A — full customer callable → payload reference
(Authoritative; taken from mobile services. Web reuses these unchanged except paid flows swap PaymentSheet for Checkout session + webhook.)

**Auth/profile:** `createCustomerUser{email,password,fullName,phone,legalAcceptance}` · `syncVerifiedCustomerPhone` · `updateCustomerProfile` · `requestOwnAccountDeletion` · `deleteUser`
**Cars:** `getCarHoldPricing` · `createCarViewingReservation{carId,buyerName,buyerPhone,appointmentStart,appointmentLabel}` · `updateCarViewingReservation{purchaseId,appointmentStart,appointmentLabel}` · `cancelCarViewingReservation{purchaseId}` · `createCarDepositPaymentIntent{carId,buyerName,buyerPhone,holdUntilDate,marketplaceDisclosure}` · `completeCarDepositReservation{purchaseId}` · `createCarPurchasePaymentIntent{carId,buyerName,buyerPhone,marketplaceDisclosure}` · `completeCarPurchase{purchaseId}` · `cancelPendingCarPurchase{purchaseId}` · `requestPaidHoldExtension{purchaseId,requestedHoldUntilDate}` · `createPaidHoldExtensionPaymentIntent{purchaseId,marketplaceDisclosure}` · `completePaidHoldExtensionPayment{purchaseId}`
**Barrel:** `suggestPickupAddresses{input}` · `listActiveBarrelDestinationOptions` · `createBarrelShipmentPaymentIntent{…}` · `completeBarrelShipmentPayment{shipmentId}` · `cancelPendingBarrelShipment{shipmentId}` · `createBarrelOrderPaymentIntent{…}` · `completeBarrelOrderPayment{orderId}` · `cancelPendingBarrelOrder{orderId}` · `changeBarrelShipmentDestination{shipmentId,destinationCountryId,businessId,changeRequestId,marketplaceDisclosure}` · `completeBarrelDestinationChange{shipmentId,changeRequestId}` · `cancelPendingBarrelDestinationChange{shipmentId,changeRequestId}`
**Pools:** `createBarrelPool{…}` · `requestJoinBarrelPool{…}` · `decideBarrelPoolJoin` · `createBarrelPoolBalancePaymentIntent` · `completeBarrelPoolBalancePayment` · `completeBarrelPoolDepositPayment` · `cancelPendingBarrelPoolDeposit` · `leaveBarrelPool` · `cancelBarrelPool`
**Freight:** `quoteFreightPickup{businessId,pickupAddress?,pickupBorough?,pickupLatitude?,pickupLongitude?}` · `createFreightShipmentPaymentIntent{…}` · `completeFreightShipmentPayment{shipmentId}` · `cancelPendingFreightShipment{shipmentId}` · `createFreightSettlementPayment{shipmentId,marketplaceDisclosure}` · `completeFreightSettlementPayment{settlementId,attemptId}`
**Transport:** `listTransportBusinessOptions` · `createTransportRequest{businessId,destinationCountryId,destinationCountryName,ownerName,carMake,carModel,carYear,customerPhone,vinNumber,pickupAddress,notes,preferredDate?}`
**Parking:** `listParkingOptions{city,startDate,endDate,customerLatitude?,customerLongitude?,pickupRequested}` · `createParkingReservation{…}` · `completeParkingReservation{reservationId}` · `cancelPendingParkingReservation{reservationId}`
**Wallet:** `requestWalletCardRefund`
**Support:** `createOrOpenSupportCase(request)` · `sendSupportMessage{caseId,content,messageType,replyTo?}` · `markSupportCaseRead{caseId}` · `setSupportTyping{caseId,typing}` · `editSupportMessage` · `deleteSupportMessageForMe` · `reopenSupportCase` · `uploadSupportAttachmentMetadata`
**Payments (NEW for web):** `create<Type>CheckoutSession` per paid action + `stripeCheckoutWebhook` (onRequest, signature-verified, idempotent).

## Appendix B — Firestore collections read by customer web
`users/{uid}` · `cars` (status=="active") · `carPurchases` (buyerUid==uid) · `barrelShipments` (customerUid==uid) · `freightShipments` (customerUid==uid) · `transportRequests` (customerUid==uid) · `parkedCars` (customerUid==uid) · `barrelPools` (status=="open") · `wallets/{uid}` + `wallets/{uid}/transactions` · `supportCases` (+ messages subcollection) · `barrelDestinationChanges`.
