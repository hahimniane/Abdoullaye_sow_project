# PLAN — Owner backlog, 2026-08-05

Seven items dictated by the owner. These are product decisions, not
suggestions. Work them in the order below unless the owner says otherwise.

## 1. Address entry: real suggestions, split fields, optional apartment

Today the customer address input only accepts a suggested address as one
opaque string, and an apartment/unit number is often lost.

Wanted:
- Suggestions as the customer types (already exists in places via
  `suggestPickupAddresses`) but applied consistently.
- Choosing a suggestion POPULATES SEPARATE FIELDS: street, city, state,
  ZIP/postal code, country.
- **Apartment / unit is its own optional field** and is never dropped.
- The customer must not be forced to accept a suggestion verbatim.

## 2. Business changes must reach customers without a reload

Turning a service off (e.g. pickup) does not show up on the customer side
until the page is reloaded. Customer-facing reads of business/service state
must be live subscriptions, not one-shot fetches, on web and mobile.

## 3. Remove the wallet — the platform no longer holds anyone's money

No wallet balance, no "use wallet balance" option, no wallet top-ups, in any
client or callable, for this version. Money moves through Stripe (or
business-direct methods, see #5), never a platform-held balance.

## 4. Customer-facing tracking, Amazon/eBay style — plus real notification links

- A customer must be able to TRACK an item, most importantly freight, with a
  visible progression of stages and dates.
- Businesses enter the tracking information as it becomes available.
- **Clicking a notification (web especially) currently lands on Home.** It
  must deep-link to the exact record the notification is about.

## 5. AI support for businesses, with guardrails + business-entered parking

- The AI support assistant must be available to BUSINESSES, not only
  customers, and must be able to TAKE ACTIONS on the business's behalf.
- Guardrails: it confirms with the user before any important action.
- Parking: a business can create a parking entry itself. After entering the
  car's details, the business chooses HOW IT GETS PAID:
  - the customer pays the business directly (e.g. Zelle), or
  - the customer is sent a Stripe payment link so the platform bills them.
  To send the link, the business supplies the customer's phone/email.

### Settled details (owner, 2026-08-06)

- **The platform's cut is a platform-admin decision, and only exists on the
  Stripe-billed path.** It runs through the EXISTING commission machinery —
  `shipmentPricing/serviceFees.parkingPlatformFeePct`, resolved by
  `servicePlatformFeePctForBusiness` with the per-business override, editable
  in the admin console. No new fee mechanism.
- **Direct/Zelle: record the amount, never bill it.** The lot keeps a record
  of what is owed and marks it received; the platform takes no cut and
  creates no Stripe object.
- **No customer account is required.** A walk-up customer must not be blocked
  at the door: the entry lives under the business with its tracking code.

## 6. Auto-select the only available business

In air freight (and anywhere else this pattern appears): when a chosen
destination country has exactly ONE business serving it, select that
business automatically instead of making the customer pick from a list of
one.

## 7. Remember recipients

Remember who a customer has sent to (cars, packages, barrels — any service).
When they start typing a recipient name on a later shipment, offer the saved
recipient profile to complete the rest (phone, address, country).

## Status and execution plan (as of 2026-08-06)

Legend: **DONE** = built, tests green, committed. **SHIPPED** = also deployed
and verified in the product. Nothing is SHIPPED until a tester drives it.

| # | Item | Built | Deployed | Verified | What is actually left |
|---|------|-------|----------|----------|----------------------|
| 1 | Address split fields | server + web + mobile | yes | partial | mobile customer-side re-test (needs customer sign-in on simulator) |
| 2 | Live business updates | server + web + mobile | yes | mobile yes | tester pass on web live refresh |
| 3 | Remove wallet | server + web + mobile | yes | yes | done (owner approved deleting balances) |
| 4 | Tracking + notif links | server + web + mobile | yes | no | tester pass on web deep-links (needs a fresh notification) |
| 5 | Business parking + AI | parking DONE end-to-end; AI backend built (`businessAssistantChat` + business_assistant.js, 20 unit tests) | parking yes; AI deploying | parking yes (sweep auto-settled 3 paid entries) | AI chat UI both clients (in flight via agents), then tester |
| 6 | Auto-select sole business | web freight + barrels + mobile barrels | yes | no | tester pass on web barrel flows |
| 7 | Remember recipients | server + web + mobile | yes | no | tester pass on web autocomplete |

### Item 5 AI half — how it works (built 2026-08-06)

- `functions/business_assistant.js`: tool definitions + transcript
  validation. READ tools (overview, parked cars, barrels, transports,
  profile) execute server-side; ACTION tools are **proposals only**.
- `businessAssistantChat` callable: auth + `requireBusinessManager`, runs
  Claude with tools; when the model wants an action it returns
  `proposedAction {toolUseId, callable, params}` and stops.
- The client shows a confirmation card; on Confirm it calls the mapped
  existing callable itself (`createBusinessParkingEntry`,
  `markBusinessParkingPaid`, `refreshBusinessParkingPayment`,
  `addShipmentTrackingMilestone`) under the staff member's own auth, so
  the assistant can only do what a human already can, and every action is
  human-confirmed. businessId is injected server-side into every proposal.

### Order of work, and why

**A. Close what is already built (cheapest value, highest risk of rot).**
1. Deploy `suggestPickupAddresses` so item 1 stops degrading to one box.
2. Tester drives items 1, 3, 6, 7 and the business-profile Save fix on a
   device and on the web consoles.

**B. Web parity — three items are half-shipped, and the halves are the web.**
3. Item 2 web: the customer console fetches its catalogs once per page load
   via callables. Subscribe to `publicCatalog/services` (the revision the
   server already bumps) and refetch on change. Mirrors the mobile fix.
4. Item 7 web: recipient autocomplete on the web receiver-name inputs,
   reading the customer's own `savedRecipients`.
5. Item 6 web: apply auto-select to the web barrel flows too.

**C. Item 4 — the real gap is the web.**
6. Web customer tracking view: a timeline per shipment reading the existing
   `trackingEvents`, freight first.
7. Web notification deep-links: clicking a notification must open the record,
   not Home. Mobile already routes correctly — copy that mapping.
8. Business-side milestone entry on the web console (the callable exists).

**D. Item 5 — parking, then the assistant.**
9. Parking backend (in flight): the two callables + pure module + tests.
10. Business console UI (web) and mobile: enter a walk-up car, choose direct
    vs payment link, mark a direct payment received.
11. Business AI assistant: available to businesses, able to take actions, and
    **confirming before every important one**. Build the action layer on the
    existing callables so the assistant can only do what a human already can.

### Known defects found along the way (not in the owner's list)

- ~~Error snackbars render teal, not red~~ — FIXED 2026-08-06. The shared
  `showErrorSnackBar` already used `errorRed`; one raw `SnackBar` in the
  platform-admin dashboard still used `brandRed` (the teal alias) and now
  does not.
- ~~Pickup number fields accept arbitrary text~~ — FIXED 2026-08-06, digits
  and one decimal point only.
- ~~Business 1's `state` holds "United States"~~ — FIXED 2026-08-06 (data,
  not code): set to `NY`. `businessIsNewYorkBased` matches only `NY` /
  `NEW YORK`, so the country name sitting in the state field silently
  disabled borough pickup pricing. The profile form normalizes US states but
  deliberately passes an unrecognized value through unchanged (non-US
  addresses put a province there), so it neither caused nor blocks this.
- ~~Choosing a transport carrier notified nobody~~ — FIXED 2026-08-06; the
  winner and the passed-over bidders now both get a notification.

### Transport payment: ANSWERED 2026-08-06 — bill it through the platform

`selectTransportQuote` records `totalCents` and flips the request to
`pending`, and that is the end of it — there is no Stripe route for car
transport at all (`payment_reconciliation.js` covers parking, barrel pools,
barrel shipments and orders; freight has its own estimate → weigh → balance
settlement). So today the customer and the carrier settle the transport
money entirely off-platform, and the platform takes no cut on it.

The owner has now decided: **accepting a bid must collect payment**, and the
platform takes its commission on it like every other service.

That decision does not, by itself, unblock the build. Transport differs from
parking in the one way that matters for money: parking is paid at or after a
short local service you can verify, whereas transport is paid *before* a long
fulfilment the platform cannot yet observe. Charging on acceptance means
holding money against a service not yet rendered, which makes refunds — not
charges — the hard part. Three things must be settled first, and only the
first is an engineering question:

1. **Where the money sits — DECIDED 2026-08-06: direct charges.** Funds land
   on the carrier's connected account the moment the customer pays, exactly as
   parking already works. The owner accepted the consequence knowingly: the
   platform holds no leverage if a carrier never shows, and a refund can only
   be taken from a carrier who still has a balance. Escrow was rejected; it is
   also against the existing product line, which avoids holding funds.

   Two things follow from that choice and are no longer optional. A refund
   attempt can now **fail for lack of funds**, so the refund path needs a real
   failed state that is visible and retryable rather than a silent throw — the
   existing `retryFreightSettlementRefunds` sweeper is the precedent. And
   because exposure is capped only by how much was collected, the deposit
   question below stops being a preference and becomes the main risk control.
2. **The cancellation and refund policy.** The code encodes the policy, so
   the policy has to exist first: customer cancels before pickup, customer
   cancels after dispatch, carrier no-shows, vehicle turns out to be
   non-running and the price changes. Each needs a stated outcome.
3. **Whether acceptance takes a deposit or the full fare — DECIDED
   2026-08-06: each business sets its own rule, and the customer sees that
   rule before accepting.** So a carrier may ask for a deposit or the full
   fare, and their terms are part of what the customer is comparing when they
   choose between bids — a carrier demanding 100% up front is offering
   something different from one asking 15%, and the customer should be able to
   see that.

   The trap this creates: the rule must be **copied onto the quote when it is
   submitted**, not read from the business profile at acceptance. Otherwise a
   carrier can change their terms between the moment the customer reads them
   and the moment they pay, and the customer is charged something they never
   agreed to. Quotes are already revised in place with a `revision` counter,
   so a terms change should behave exactly like a price change: a new revision
   the customer has to accept, never a silent edit under a live bid.

   A business with no rule set needs a platform default rather than an
   undefined charge, and the deposit percentage needs bounds — the same
   reasoning as `platform_fees.js`, where an out-of-range value is refused
   rather than clamped so a typo cannot charge a customer 400%.

Two implementation traps to carry into the build regardless of those answers:
refunding a Stripe charge does **not** refund the platform's
`application_fee` unless `refund_application_fee` is set, so a naive refund
leaves the carrier paying a commission on a job they never performed; and
acceptance must not be a single write — accept, pay, and carrier-confirm are
distinct states, with a timeout that releases a request whose customer
accepted and then never paid, otherwise an unpaid acceptance holds a carrier
hostage indefinitely.

Commission on transport should count as *pending* until the transport
completes, not *earned* at acceptance — the Finance view already separates
those, and booking refundable money as earned would overstate revenue.

Every item ships on BOTH web and mobile, and is tester-verified on the real
interface before it is called done (docs/ENGINEERING_GUARDRAILS.md).

### Scope: business service actions missing from mobile (2026-08-07)

Parking is the only service a business can actually *operate* from the phone.
Barrels, freight and transport permissions gate read-only feeds and the
activity filter chips; there is nothing to do for them in the app. Everything
below already exists as a deployed callable and a working web control, so this
is client work, not new backend.

**Transport — 3 actions, and the strongest case.**
`submitTransportQuote`, `withdrawTransportQuote`,
`updateTransportFulfillmentStatus`. Both halves are inherently mobile: bidding
is time-boxed (a 7-day quote window where the first credible bid usually wins,
and a hauler away from a desk cannot bid at all today), and advancing a
transport is done by the person standing next to the car, not by someone at a
desk afterwards. This is also the natural companion to transport payments —
accepting a bid and collecting money is a phone workflow end to end.

Two things the mobile build must get right that the web currently does not.
`updateTransportFulfillmentStatus` enforces a transition table and refuses
`in_transit` without a validated container number; the web business console
bypasses both by writing `status` straight to Firestore
(`operations-panels.tsx`), so mobile should call the callable and be the
correct implementation rather than copying the shortcut. And an admin path can
push transport into statuses the transport state machine never produces, so
the mobile UI must render an unexpected status rather than assume the
vocabulary.

**Freight — 1 action.** `confirmFreightShipmentWeight`. Also inherently
physical: someone at a scale. It moves money — the settlement it triggers
either raises a balance due or refunds the card — so it needs a confirmation
step and the server's own error surfaced, not a generic failure sentence.

**Car sales — 4 actions.** `businessFinalizeCarPurchase`,
`decidePaidHoldExtension`, `markPaidHoldNoShow`, `markPaidHoldSold`. Real, but
desk work rather than yard work.

**Barrels — nothing worth porting.** Almost every barrel business action in
the console is shared-barrel pool machinery (`createBusinessBarrelPool`,
`sealBarrelPool`, `decideBarrelPoolJoin`, `adjustBarrelPoolCapacity`,
`cancelBarrelPool`, `rollBarrelPoolToBusinessHeld`,
`markBarrelPoolBalanceCollected`) and shared barrels are retired. The one
barrel action that matters day to day is the tracking milestone, which mobile
already has.

Order: transport, then freight, then car sales. Barrels need no work.

### Parking payment links are durable (2026-08-06)

A Stripe Checkout Session expires **24 hours** after it is minted; that
ceiling is the API maximum, not a setting. So a link a lot texted on Monday
was dead by Wednesday, while the owner's rule is that a link stays good
until the customer pays it or the lot cancels it.

The customer now receives a Laawol URL, not a Stripe one:

- `parkingPaymentLink?t=<token>` — stable for the life of the record. Each
  visit reuses the stored Stripe session if it is still alive, otherwise
  mints a replacement with the same amount and fee split. Paid records show
  "Already paid"; cancelled ones show "Link cancelled".
- `cancelBusinessParkingPaymentLink` — the lot's half of the rule. Expires
  the open Stripe session too, so a customer sitting on an already-open
  checkout tab cannot complete a payment that was just cancelled.
- `paymentLinkUrl` on the record is what the console copies;
  `stripeCheckoutUrl` keeps the raw session for support only.

Verified live: a bad token renders "Link not found"; the unpaid $35 entry
303s to a working Stripe session; the paid Audi renders "Already paid".

### Also fixed 2026-08-06

- **"New parking" removed from the business console.** It wrote a
  `parkedCars` document straight from the browser — faked `PC-xxxxxx`
  tracking code, no `amountDueCents`, no payment plan, no space check — so
  it produced records the payment system could not settle. Creation goes
  through `createBusinessParkingEntry` only.
- **Paid parking records can no longer be edited**, in the UI and in the
  save path. Editing rewrote the price of a completed sale with no server
  check and no audit trail. The amount on a payment-link entry is refused
  too: the customer's Stripe session already carries it.
- **Paid vs unpaid is now a badge**, green/amber, on both clients.
