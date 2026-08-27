# Guest checkout — paying without an account

Scoped 2026-08-07 against the code, not from memory. Every claim below has a
file behind it.

## The verdict

Smaller than it looks, because the platform already does this once. The
walk-up parking flow takes money from someone with no account, sends them a
receipt, and never creates a Firebase user. It is a complete working blueprint
for five of the six things guest checkout needs.

What is genuinely new is one thing: **no unauthenticated principal can create a
priced record anywhere in this system today.** Every guest capability that
exists is business-initiated — a staff member with permissions mints a link and
the guest's only power is following it. That new surface is where the design
effort and the abuse risk both live.

## What already works for a guest

**Pricing and quoting, end to end.** `listActiveBarrelDestinationOptions`
(index.js:2896), `quoteBarrelPickup` (index.js:14891) and
`suggestPickupAddresses` (index.js:14837) take no auth. `publicCatalog`,
`destinationCountries`, and approved businesses' office locations and
destinations are all `allow read: if true`. `enforceCallableRateLimit`
(index.js:407-443) already buckets by IP when there is no uid — anonymous
callers were designed for.

**The web form.** `console-router.tsx:296-322` renders the whole barrel form for
a signed-out visitor arriving at `?service=barrel`, with a synthetic
`profile={{id: "guest"}}`. A guest can fill everything in and see a real total.
They are stopped at one line — `customer-shipping-services.tsx:788-791` — and
the submit button relabels itself "Sign in to save & continue".

**App Check.** It attests the app, not the user, and both clients initialise it
before sign-in. Not a blocker.

## The five layers that block it

Each has a parking counterpart already written.

1. **Identity on the record.** `createBarrelShipmentPaymentIntent` requires a
   uid (index.js:18940) and then calls `admin.auth().getUser(customerUid)`
   (index.js:18996) purely to fill in `customerEmail`. A guest needs a contact
   block written from form input instead. Parking does exactly this: name and
   phone required, email optional, and `business_parking_entry.js:296-298`
   deliberately omits `customerUid` rather than writing an empty one.

2. **Webhook routing.** `PAYMENT_ROUTES.barrel_shipment` sets
   `customerMetadataKey: "customerUid"`, and `routePaymentIntentMetadata`
   throws when it is missing (payment_reconciliation.js:353). Parking's route
   anchors on `businessId` instead, for exactly this reason
   (payment_reconciliation.js:31-34). A guest route needs its own anchor.

3. **Payment completion.** `runPaymentCompletion` re-invokes the customer's own
   callable as that customer (index.js:6792-6797), which cannot work with no
   uid. `PAYMENT_COMPLETION_HANDLERS` (index.js:6619) is the escape hatch —
   currently one entry, parking's, with the comment saying why.

4. **Notifications.** `sendPreferenceNotification` needs a `users/{uid}`
   document and reads the address off it, not off the record
   (index.js:5284-5285, 4917). A guest gets nothing today — no email, no SMS,
   no push. Parking emails and texts straight from the record
   (index.js:10803-10809).

5. **Coming back later.** `barrelShipments` has no token field, no
   unauthenticated reader, and no server-rendered document. Firestore rules
   have no non-auth read branch (firestore.rules:598-599). A guest would have
   no way to see status, tracking or proof of payment.
   `parkingPaymentLink` + `parkingDocument` + `parking_document.js` are the
   complete pattern.

There is also a sixth, smaller one: `recordMarketplaceDisclosure` writes legal
acceptance keyed to `userId` (index.js:381-397). A guest still has to accept
terms, and that evidence has to attach to something.

## Fix first: the token endpoints are the weakest thing here

Before pointing the customer base at this pattern, the existing endpoints need
hardening. `parkingPaymentLink` and `parkingDocument` are `onRequest`, so App
Check does not apply, and what protects them is the 192-bit token and nothing
else:

- No rate limit of any kind. `maxInstances: 10` is a cost control.
- No expiry, by design — and `parkingDocument` never checks the cancellation
  state, so a cancelled or paid record's invoice stays readable forever.
- It renders name, phone, email, VIN, vehicle, dates and amount.
- Every visit to `/p` with an expired session mints a new Stripe Checkout
  session and increments a counter (index.js:10198). Unbounded.

Tokens travel in query strings through an Apache 302, so they reach browser
history and `Referer` headers. Unguessable is doing all the work.

## Phases

**Phase 0 — harden the token surface.** Rate limit both `onRequest` endpoints
by IP, make `parkingDocument` respect cancellation, cap session minting per
record, and decide an expiry policy for document links. Small, and it stands on
its own merits whether or not guest checkout ships.

**Phase 1 — a guest record layer, not a barrel special case.** Generalise
parking's token machinery into something any service can adopt: a
`guestAccessToken` on the record, one `PAYMENT_ROUTES` shape anchored on the
record id, one server-side completion handler shape, and one document renderer
generalised out of `parking_document.js`. Building this once is barely more
than building it for barrels, and it is what makes freight and transport cheap
later instead of a rewrite.

**Phase 2 — guest barrel checkout, backend.** A new unauthenticated create
callable (App Check enforced, IP rate limited, disclosure captured against the
contact block), the guest payment route, the completion handler, and email/SMS
off the record.

**Phase 3 — the token-served view.** Status, tracking milestones and a
receipt/invoice, rendered server-side off the token. This is what a guest gets
instead of an account, and it must be emailed and texted at purchase because
it is the only way back in.

**Phase 4 — web.** Remove the submit gate. The form already renders for
guests; the work is the submit path, the return screen (`pay-return.tsx:93-98`
currently shows "signed-out" rather than a result), and the copy — note there
is a test asserting the current copy does NOT say "No account needed"
(customer-service-intent.test.ts:30-33), which is a deliberate product position
being reversed.

**Phase 5 — mobile.** `send_barrel_screen.dart:431` `_ensureCustomerAccount()`
is the gate. Mobile uses the embedded PaymentSheet rather than hosted Checkout,
so the guest path needs its own client secret route.

**Phase 6 — claiming.** Someone who pays as a guest and later signs up with the
same email expects to see that order. Match on verified email and attach.
Worth designing now; retrofitting ownership is much harder than granting it.

## Decisions needed before building

- **Which services.** Barrels are clean: one payment, one moment. Freight and
  transport settle later — a balance due weeks after purchase, to someone with
  no account, is a genuinely hard problem and probably should stay
  account-only at first.
- **Unpaid guest records.** Creating them invites spam. The existing
  `STALE_PAYMENT_SCANS` sweeper already reaps unpaid records; confirm it covers
  the guest shape, or hold the draft outside the live collection until payment
  succeeds.
- **How much a token exposes.** Parking's document shows full PII. A guest
  tracking link for barrels should probably show less to whoever forwards it.
- **Whether guest orders can be edited.** Signed-in customers may edit a
  pending shipment (firestore.rules:600-625). A token holder probably should
  not.
