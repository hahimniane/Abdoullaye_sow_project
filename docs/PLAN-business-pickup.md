# PLAN — Business-owned pickup (all services)

Decided with the owner on 2026-08-05. These are product decisions, not
suggestions — do not relitigate them in later sessions.

## The model

1. **Pickup belongs to the business.** Every service's pickup is enabled,
   priced, and capped by the business offering it. The platform has **no
   default pickup fees** — `shipmentPricing/barrelPickup` is retired.
2. **Three pricing modes**, chosen by the business:
   - `flat` — one price for any pickup within their travel cap
   - `distance` — base + per-mile, within the cap
   - `borough` — per-borough flat prices; **only offered when the business is
     in New York** (registered address in NY, or an office location in NY)
3. **Mandatory travel cap.** `maxPickupMiles` is required in every mode. An
   address beyond the cap is a clean rejection, never a runaway fee. This is
   what makes `flat` safe ("one price as long as you're within my range").
4. **One shared plan by default, per-service overrides on demand.** A business
   configures pickup once and it applies to all their pickup-capable services
   (barrels, freight, parking, car transport). The UI must SAY this plainly.
   Any service can then be switched to its own separate configuration.
5. **New service → explicit choice.** When a business enables a service it
   didn't have, ask: inherit the shared pickup plan, or configure this service
   separately. Never silently inherit, never silently disable.
6. **The address decides the price — on the server.** No customer-facing
   borough dropdowns anywhere. The server geocodes the pickup address (the
   mechanism barrels already uses), derives the borough or distance itself,
   and enforces the cap. The client only ever displays a server quote.
7. **Car transport gets a separate pickup fee.** Charged on top of the
   business's job quote, from the same plan.
8. **Shared barrel pools: explicitly out of scope for now** (owner decision).
9. **Barrels may go dark during migration.** Businesses that have not
   configured pickup simply cannot offer it until they do. No platform-price
   fallback. Surface "pickup unavailable" to customers and a setup nudge to
   the business.

## Known leaks this closes (from the 2026-08-05 pickup investigation)

- Customers choosing their own borough (= their own price) on freight.
- App-side fee guesses that disagree with the server's charge.
- Uncapped distance fallback creating four-figure fees for far addresses.
- Post-payment `pickupAddress` edits at a frozen fee (rules allowlist).
- "Enabled but unconfigured" freight pickup being silently free or silently
  blocked — plan validation rejects incomplete configs at save time.

## Data model

On `businesses/{id}` (written ONLY via `updateBusinessProfile`, validated):

```
pickupPlan: {
  version: 1,
  shared: {
    enabled: bool,
    mode: 'flat' | 'distance' | 'borough',
    maxPickupMiles: number > 0        // REQUIRED in every mode
    flatFee: dollars,                  // flat mode
    baseFee, perMileFee, minimumFee,   // distance mode
    boroughPrices: {Bronx: ...},       // borough mode, NY businesses only
    originAddress, originLat, originLng,
  },
  services: {                          // present key = explicit decision
    barrels:      {inherit: true} | {inherit: false, ...same shape},
    freight:      ...,
    parking:      ...,
    carTransport: ...,
  },
}
```

Legacy compatibility during rollout: if `pickupPlan` is absent, freight falls
back to the existing `freightPickup*` fields and parking to
`parkingPickupFee`, so nothing breaks before businesses migrate. Barrels have
no fallback (decision #9).

## Build order

1. **`functions/pickup_plan.js`** — pure module: normalize/validate a plan,
   resolve the effective config for a service (shared vs override vs legacy
   fields), compute a fee from a geocoded result (borough/miles), enforce the
   cap. Unit-tested exhaustively; no Firestore, no HTTP.
2. **Server integration** — `updateBusinessProfile` accepts and validates
   `pickupPlan` (NY check for borough mode; reject enabled-but-incomplete);
   barrel/freight/parking/transport fee paths resolve through the module;
   borough always derived from the geocoded address; remove `pickupAddress`
   from the customer post-payment edit allowlist in firestore.rules.
3. **Business console UI (web)** — pickup section: shared plan editor, "this
   applies to all your services" notice, per-service override, borough mode
   visible only to NY businesses, cap required.
4. **Business profile UI (mobile)** — same, same wording.
5. **Customer flows** — delete borough dropdowns (app + web freight); barrel
   app calls `quoteBarrelPickup` instead of guessing locally; all clients
   display server quotes only.
6. **Car transport** — pickup fee computed per quoting business and shown
   with each quote; added to the accepted quote's total.
7. **New-service prompt** — both clients, on enabling a service not yet in
   `pickupPlan.services`.

Every phase: tester agent drives the real UI before it is called done.
