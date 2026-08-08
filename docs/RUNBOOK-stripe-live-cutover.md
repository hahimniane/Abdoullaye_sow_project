# Runbook: moving Stripe from test to live

Written 2026-08-08. Everything below was read off the running project, not
assumed. The `sk_test_` finding is from `firebase functions:secrets:access`;
the business counts are from Firestore.

Stripe test and live are **separate worlds**. No object created in test —
customer, price, webhook endpoint, connected account, payment link — exists in
live. That is what makes this a migration rather than a config change.

## Who does what

Claude does not enter API keys or secrets. Every step marked **[you]** needs a
human with the Stripe dashboard open. Steps marked **[claude]** can be done for
you.

---

## 1. Activate live mode **[you]**

Stripe Dashboard → complete account activation: business details, bank account
for payouts. Live charges are refused until this is done.

## 2. Recreate live-mode objects **[you]**

- **Webhook endpoint** → point it at:
  `https://handlebusinessprostripewebhook-5hmwan7kqa-uc.a.run.app`
  (`handleBusinessProStripeWebhook`, also exported as `stripeCheckoutWebhook`).
  Subscribe to the same events the test endpoint has. Copy the new **signing
  secret** — it differs from test.
- **Business Pro price** → recreate it in live mode and note the new price ID.

## 3. Re-onboard every connected business **[you + the businesses]**

This is the long pole: it depends on other people, so start it first.

As of 2026-08-08 there are **8 businesses, 3 with Stripe accounts**, all three
payouts-enabled — and all three are **test-mode** accounts that do not exist in
live. Each must run Connect onboarding again in live mode, after which
`stripeAccountId`, `payoutsEnabled` and `chargesEnabled` are re-established.

One of the three is on `business_absorbs_processing_fee`, i.e. direct charges.
That business **cannot take a payment at all** until it has re-onboarded — the
PaymentIntent is created on its connected account. The other two are on
`platform_absorbs_processing_fee`, so charges still succeed but the payout
transfer to them fails.

## 4. Set the three secrets **[you]**

```bash
firebase functions:secrets:set STRIPE_SECRET_KEY      --project car-selling-flutter-app
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET  --project car-selling-flutter-app
firebase functions:secrets:set BUSINESS_PRO_PRICE_ID  --project car-selling-flutter-app
```

`STRIPE_SECRET_KEY` is `sk_test_...` today. The webhook secret and price ID
come from step 2 and are different values in live.

## 5. Deploy the backend so it picks up the new secret versions **[claude]**

Use the project's own script, never `firebase deploy` directly — a full raw
deploy starts ~175 containers against a 20 vCPU regional ceiling and takes live
traffic down with it. See `deploy/cloud-run-capacity-lib.mjs`.

```bash
cd deploy && DEPLOY_BATCH_SIZE=3 DEPLOY_BATCH_GAP_SECONDS=120 npm run deploy:backend
```

Batches of 6 were still too aggressive on 2026-08-08: the quota is measured
over a rolling one-minute window, so consecutive batches overlap in it and live
requests get squeezed out. Symptom to watch for in logs:

```
The request failed because the project exceeded its quota limit for
run.googleapis.com/cpu_allocation recently
```

If that appears, stop the deploy and run `node deploy/prune-cloud-run-revisions.mjs`
to release allocation. Deploy when nobody is using the system.

Drop `DEPLOY_ENV=development` from this point on. It exists only to authorise a
test key on the production project, and that window closes 2026-08-31 anyway.
Once the secret is `sk_live_`, preflight passes without it.

## 6. Ship a mobile build carrying the live publishable key **[claude]**

```bash
flutter build ipa --release \
  --dart-define=STRIPE_PUBLISHABLE_KEY=pk_live_... \
  --export-options-plist=ios/ExportOptions-AppStore.plist
```

`stripe_config_service.dart` now **throws on first run** if a release build has
no `STRIPE_PUBLISHABLE_KEY`, rather than silently falling back to the bundled
test key. Builds 22–25 all shipped that fallback; with a live backend they
would have failed every payment while looking healthy.

## 7. Clear in-flight test payments **[claude can list, you decide]**

Parking payment links, checkout sessions and PaymentIntents created in test
mode all die at the switch. Anything at `paymentStatus: pending` needs
cancelling or reissuing after the cutover.

---

## Order matters

1. Activate live mode
2. Create the live webhook and price
3. **Re-onboard the three businesses** ← start here, it needs other people
4. Set the secrets
5. Deploy the backend
6. Ship the mobile build with the live key
7. Cancel or reissue pending test payments

Steps 4–6 should happen close together. Between the secret going live and the
new build reaching phones, any client on the old build is on a test
publishable key against a live backend, and its payments fail.

## Before you start

The iOS app is **Waiting for Review**, not released. Going live means
TestFlight testers can move real money. If that is deliberate — a paid pilot
with the Guinea partners — fine. If not, do step 3 now, since it depends on
other people, and hold steps 4–6 until App Store approval.
