# Payment timing and cancellation

**Status: model decided 2026-08-10 (owner); built 2026-08-10, NOT yet
deployed.** Written 2026-08-10.

Built: `functions/payment_hold.js` (decisions, 20 tests) + hold registry
(`paymentHolds`) + `captureExpiringPaymentHolds` scheduler + manual capture
derived from `metadata.paymentType` in both creation helpers + all six settle
callables accept held intents and defer payouts to capture + all six
cancel-pending callables release holds free + disclosure copy on both clients
(en/fr).

**Deploy warning: the payment functions must go out together.** A partial
deploy where create* takes holds but complete* still rejects
`requires_capture` breaks every new booking. Deploy the whole payment set in
one targeted batch: create*/complete*/cancelPending* for parking, barrel
shipment/order, freight shipment, car deposit/purchase, plus
createCustomerCheckoutSession, confirmCustomerCheckoutSession,
handleBusinessProStripeWebhook, reconcileStaleStripePayments, and the new
captureExpiringPaymentHolds.

Customer-side cancellation (built 2026-08-10): `cancelSecuredCustomerOrder`
covers the single-intent shipping flows (barrelShipment, barrelOrder,
freightShipment) - held payments release free, captured ones refund minus the
REAL fee from the balance transaction, and the platform commission returns to
the business either way so only the canceller pays. Guard: platform-mode
orders already paid out refuse with "contact support" (a transfer reversal
needs a person). Web: the orders drawer offers it with outcome-specific labels
and confirmation. Mobile: barrel shipment details screen. NOT yet covered:
mobile freight details UI, parking, car flows (un-selling a car is its own
design).

Also required at go-live: subscribe the Stripe webhook endpoint to
`payment_intent.amount_capturable_updated` (dashboard), and ask Stripe
support about extended authorization / IC+ (holds work at 5-7 days without
it; extended just makes them ~30).

## THE DECIDED MODEL (supersedes the deposit design below)

The owner chose the hold-first model, favouring customers while the platform
is new:

1. **Every immediate payment starts as a hold** (`capture_method: manual`),
   never a straight charge — however far out the service is.
2. **Extended authorization is requested** (`request_extended_authorization:
   if_available`) so eligible Visa/Mastercard holds last up to ~30 days.
   Eligibility is per card; never assume it.
3. **Cancel while it is still a hold → completely free.** The hold is
   released; nothing was ever charged, no fee exists.
4. **Capture happens just before the hold expires** — driven by the
   `capture_before` timestamp Stripe stamps on each charge (Visa
   merchant-initiated can be 5 days, most cards 7, extended ~29.8), never a
   hardcoded day count. The customer is notified ~24h before capture.
5. **Cancel after capture → refund minus the Stripe processing fee**, and the
   customer is told this at checkout, before they ever pay.
6. **Business cancels / cannot perform → customer gets 100% back.** The
   processing fee falls on the business (this is Stripe's default on direct
   charges), and the platform refunds its application fee — no commission on a
   job that never happened, matching the launch-meeting decision.
7. **No deposits at launch.** The deposit + cutoff settings layer below is
   built and tested (`functions/deposit_policy.js`, 28 tests) but is
   **parked** — nothing reads it. If late cancellations start hurting
   businesses at volume, it switches on without redesign.
8. Ask Stripe support honestly about extended auth (freight genuinely has
   unknown final amounts — weight is settled at drop-off). No pretexts: the
   account is the platform.

Implementation notes for whoever picks this up:
- With `capture_method: manual`, a completed Checkout Session's
  `payment_status` is **"unpaid"** and the PaymentIntent sits at
  `requires_capture`. Every webhook/handler that treats
  `payment_status === "paid"` as "money secured" has to learn that
  `requires_capture` is also secured.
- Capture on a valid authorization cannot fail the way an off-session charge
  can; the funds are reserved. This is why hold-then-capture beats
  save-card-then-charge.
- Refund-minus-fee needs the **actual** fee from the charge's balance
  transaction, not the ~2.9%+30¢ estimate; the estimate is for the disclosure
  sentence only.

---

## Original design notes (kept for the reasoning; deposit model parked)

Today every service that requires payment charges the full amount immediately,
via a Checkout Session with automatic capture. No flow sets `capture_method`.
This document is the reasoning for changing that, and the constraints anyone
implementing it will hit.

**Out of scope:** shared barrel pools. They are not being worked on right now.
(They already carry `depositPerShare` / `sharedBarrelDepositCents` in
`shared_barrel.js`, which is prior art for the deposit idea below, but the pool
flow has its own fill-or-fail problem and should be designed separately.)

---

## 1. The problem: a refund does not return the fee

Stripe keeps its processing fee when you refund. Refunding a $110 barrel does
not return $110 — roughly $3.50 is gone, and somebody eats it. Because we
charge in full at booking, **every cancellation burns a fee on money that never
bought anything.**

That is the whole reason to move payment later. It is not about being generous
with refunds; it is about not creating a settled charge we are going to undo.

---

## 2. What the card networks actually allow

An authorization ("hold") that is never captured costs nothing — no fee,
because no charge ever settled. That makes it the ideal instrument for
"customer might still cancel". The limit is how long it lasts:

| | Window |
| --- | --- |
| Standard online card authorization | **7 days** (Visa merchant-initiated: 5) |
| Extended authorization | up to **30 days** |

**When an authorization expires, the funds are released and the PaymentIntent
becomes `canceled`.** You get nothing. So any fallback charge must fire
*before* expiry, never at it — Stripe's own `automatic_delayed` capture fires
about 6 hours ahead, which is the right shape to copy.

Extended authorization is not free to adopt:

- It requires **IC+ pricing**. We are on blended, so it means contacting Stripe.
- It adds **0.08% per transaction** for our merchant categories.
- Network rules intend extended windows for cases where **the final amount is
  unknown at authorization**. We know the exact amount. That is a
  rules-compliance question, not just a fee — worth asking Stripe directly
  before building on it.

### Why a long hold is worse than it sounds

- **Debit cards.** A hold genuinely removes the money from the account. Our
  customers are diaspora families sending barrels home, not people with spare
  credit headroom. Locking $110 for three weeks is a real hardship.
- **It looks like a double charge.** Stripe's own documentation warns that many
  issuers do not visually distinguish a hold from a settled payment. A hold
  followed by a capture reads as being billed twice, which produces *more*
  disputes — the opposite of the goal.
- **Business cash flow inverts.** Businesses are paid at capture, not at
  booking. Some of our operators buy a plane ticket to carry the freight; they
  may need the money *before* departure.

---

## 3. The gap a hold cannot close: reserved capacity

The owner raised the case that breaks the simple model:

> what if the business also saved that place just for this customer, and this
> customer cancelling last days will affect them to fill up the gap

This is the real asymmetry. The business commits capacity **at booking**. The
card networks will not hold funds for the weeks between booking and departure.
So under "free cancellation until the cutoff", there is a long stretch where the
business is fully exposed and the customer has nothing at risk. A customer who
walks away three days out leaves a slot that cannot be refilled — and the
business has been protecting it the whole time for free.

Any design that only moves the *charge* later, without putting something at
risk earlier, quietly transfers the cancellation cost onto the business.

---

## 4. Proposed model

Pick the mechanism by how far the service is from booking. **The deciding
question is not the service type, it is the horizon.**

### Near-term (service within ~6 days) — authorize, capture at service

Authorize at booking with `capture_method: manual`. Capture at drop-off or
departure. Cancelling before that voids the authorization: nothing settled,
no fee lost, the customer never sees a charge. This is strictly better than
today for viewings and near-term freight departures.

### Long-horizon (beyond the authorization window) — deposit now, balance at cutoff

1. **At booking:** charge a deposit, settled immediately. This is what the
   business holds against the reserved slot, and it is the answer to §3 — it
   survives indefinitely, unlike a hold.
2. **At the cutoff** (e.g. 48h before departure): charge the balance
   off-session against the saved card.
3. **Cancellation** is governed by which side of the cutoff it falls on, and by
   who cancelled.

A settled deposit beats charging a cancellation fee after the fact. Chasing
money from someone who has already walked away fails often — expired card,
removed payment method, no leverage — whereas a deposit is money already held.

We already have most of the machinery: `setup_future_usage` is wired into the
Checkout Session, and `attemptAutomaticFreightBalanceCharge` already charges a
saved card off-session and falls back to notifying the customer when no card is
on file. That fallback path is the one to extend, not rebuild.

### Who bears the loss

This is the fairness rule, and it should be stated in code as well as in copy:

| Who cancels | When | Outcome |
| --- | --- | --- |
| Customer | before cutoff | Deposit refunded; balance never charged |
| Customer | after cutoff | Deposit forfeited to the business; balance not charged |
| Business (or cannot perform) | any time | Everything refunded, including the deposit |

The business cancelling is not the customer's fault, and the customer must not
be the one who pays the fee for it.

---

## 5. Open decisions

These are not settled and should not be guessed at in code:

1. ~~Who sets the deposit, and what bounds?~~ **Decided 2026-08-10: the
   business sets the deposit, the platform bounds it.** Same shape as freight
   category multipliers and loss coverage — only the business knows what an
   empty slot costs it, and only the platform can stop a business from asking
   for something absurd. Implemented in `functions/deposit_policy.js`; the
   bound values themselves are constants at the top of that file and are a
   first proposal, not a considered pricing decision.
2. **Who eats the Stripe fee on a refunded deposit?** Refunding a settled
   deposit still loses the fee. Precedent exists for the platform absorbing
   small per-order costs (Terminal49 tracking, 2026-08-07), but a deposit is
   larger than $0.15. Options: platform absorbs, business absorbs, or a small
   part of the deposit is non-refundable and stated as such.
3. ~~Where exactly is the cutoff per service?~~ **Decided 2026-08-10: the
   business sets the cutoff too, and either number can be set per service.**
   The platform does not pick a number for anybody — a barrel leaving monthly
   and a car viewing next Tuesday are not the same commitment, and only the
   operator knows how late it can still refill a slot. Resolution order is the
   one `servicePlatformFeePct` already uses: this service's value, then the
   business's blanket value, then nothing. Bounded at
   `MAX_CUTOFF_DAYS` (30) — beyond that almost nobody books early enough for a
   free window to exist at all.
4. **Does extended authorization survive Stripe's own compliance answer?** See
   §2. Ask before designing around it.

---

## 6. Disclosure is not optional

Whatever the numbers, the customer sees **the date and the amounts before they
pay** — plainly, on the screen:

> Free cancellation until 3 March. After that you are charged $110 and
> cancelling costs $25.

This is what makes the fee defensible, and it is how hotels and car rental do
it. Per `UI-CONVENTIONS.md` rule 1, this belongs **on the screen, not behind an
"i"** — anything about money moving or an action that cannot be undone is never
hidden behind detail-on-demand.

---

## 7. Car transport joined the model (2026-08-16)

Transport was the one service whose money never touched the platform:
accepting a quote set statuses and stopped, and the carrier could drive the
job to `delivered` on money nobody collected.

Accepting a quote now charges, hold-first, exactly like every other service:

- **Selection** prices the job (quote + pickup fee), freezes charge routing
  (direct charge when the business absorbs fees and payouts are enabled),
  and parks the request at `pending_payment`.
- **Payment** uses `paymentType: transport_job` through the shared plumbing —
  hold type, reconciliation route, checkout action, completion and
  cancellation dispatch — so the capture scheduler, webhook path and the
  24-hour notice needed no changes.
- **The fulfilment machine refuses to start an unpaid marketplace job.**
  Cancelling stays open, and legacy (flowVersion 1) records are exempt.
- **Cancellation** is the standard secured ledger: held releases free,
  captured refunds minus the card fee, business cancels refund in full. The
  `transportJob` entry also closes `fulfillmentStatus` and `quoteStatus` so
  the carrier panel stops offering work on a refunded job.
- **An abandoned Stripe page keeps the selection.** The record predates the
  payment attempt (unlike a barrel order), so only the intent is cancelled
  and the console offers "Pay now".
