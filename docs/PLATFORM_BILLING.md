# Laawol bills — platform billing of businesses (contract)

What each business owes Laawol per month under its own deal, how it is
counted, paid, closed and compared with other rates. Admin console only:
businesses never see bills. Server + admin web console; no app change.

Pure math: `my_flutter_app/functions/platform_billing.js` (mirrored for the
console's preview and the deal editor's hint by
`admin_web/src/lib/platform-billing.ts`; both run
`functions/test/fixtures/platform-billing-cases.json`). Firestore glue:
`functions/platform_billing_handlers.js`. One callable: `platformBilling`.

## 1. Decisions (agreed with the owner)

1. Every business has its real deal recorded. The Bills page shows what each
   business owes per month, plus a "Try other rates" calculator that is never
   saved: per business ("now vs with this deal", prefilled with its deal) and
   for all businesses at once (one rate card on every business, per-business
   results and the platform total for the month).
2. A deal combines any of the charges in §3; every one is optional.
3. Online-payment commission stays separate. Per business: **keep** the
   commission alongside the deal (default) or **replace** it with the deal.
   The bill always shows the commission Laawol already took that month as
   its own line; total earned = commission taken + deal charges.
4. Admin only. Viewing follows Finance (like Volume); editing deals,
   recording/voiding payments, closing/reopening months and switching the
   commission mode are **super admin only** — the same people who may write
   `businesses/{id}.platformFeePct` today (`firestore.rules`:
   businesses are writable by `isSuperAdmin` only).
5. Payments per business per month: amount, date paid, method, optional
   note, recorded by. Partial payments allowed.
6. Bills are live during the month. "Close month" freezes a snapshot;
   later record changes show as drift, the closed amount never changes.
   Super admins may reopen (audited, with a reason).
7. Counting month = the month the work was RECEIVED, the same month Volume
   counts in (see §2 for the zone).
8. Deal history: each change has an "effective from" month; every month is
   billed with the deal in effect then; closed months never change.
9. USD, integer cents everywhere. Dates month-first, 12-hour.

## 2. What is counted, per business per month

| Input | Source (reused) | Month rule |
| --- | --- | --- |
| Barrels received | `volumeMonthly/{businessId}_{yyyy-mm}.barrels` | Volume's: month the line was received (`receivedAt`, legacy `createdAt`, split parts inherit their root), **America/New_York** |
| Packages received | `volumeMonthly.packages` (fixed mode). In % mode the bill reads the month's lines with the same Volume query and month rule (`volume_rollup.js` `monthLines` + `volume_counts.js` `lineMonthKey`) to see each package's price; the count is then the package pieces found | same |
| Shipped cars | `volumeMonthly.cars`: car pieces on container lines received in the month | same |
| Parked cars | `parking_month_statement.js` `parkingMonthSummary(...).carsOnLot`: a car on the lot any day of the month counts once | Parking's own month (UTC calendar days), unchanged |
| Parking billed | `parkingMonthSummary(...).billedCents`: cars' days in the month + lot activities dated in the month | same |
| Items sold | `inventory.js` `summarizeSales(...).itemsSold`: sum of `quantity` over non-voided `inventorySales` created in the month | `createdAt` in the month, America/New_York |
| Commission taken | `console_summaries.js` `platformEarningsLines` (the `getPlatformEarnings` lines): `feeCents` of lines in state `earned` for the business whose date is in the month | America/New_York |

**Zone note.** The brief says "business's time zone (same as Volume)".
Volume counts every business in America/New_York (`VOLUME_TIME_ZONE`), so
Bills does too, to stay identical to the Volume page. Parking keeps its own
UTC-day months so the parking numbers equal Parking's month bills.

**Package price.** A package is one package piece (`box` or `other`) of a
line, read through `line_pieces.js` `linePieces`. Its price is that piece's
recorded `priceCents`; a legacy line's price is spread evenly over its pieces
(odd cents on the first), exactly as every other screen reads it. A line's
`pickupFeeCents` is not part of any package price. `0` is a recorded price
of $0. A piece with no price (`null`) is "no price": it pays the minimum ($0
when there is none) and is counted on the bill as "no price".

## 3. Deal and formulas

```
deal = {
  barrel:     {centsEach} | null                        // per barrel received
  package:    {mode: "fixed", centsEach}
            | {mode: "percent", bps, minCents} | null   // per package piece
  shippedCar: {centsEach} | null                        // per shipped car
  parking:    {mode: "perCar", centsEach}
            | {mode: "percent", bps} | null             // parked cars
  itemSold:   {centsEach} | null                        // shops, per item
  flatCents:  int >= 0                                  // monthly flat fee
  minimumCents: int > 0 | null                          // monthly minimum
  capCents:   int > 0 | null                            // monthly cap
}
```

Rates are basis points (`bps`, 1 bp = 0.01%; 5% = 500). Percent of an
amount uses integer math and **rounds half up to the cent**:
`pct(c, bps) = floor((c * bps + 5000) / 10000)`.

| Charge | Amount |
| --- | --- |
| Barrels | `barrels × centsEach` |
| Packages, fixed | `packages × centsEach` |
| Packages, percent | `Σ over package pieces: max(pct(price, bps), minCents)`; no price → `minCents` |
| Shipped cars | `cars × centsEach` |
| Parking, per car | `carsOnLot × centsEach` |
| Parking, percent | `pct(billedCents, bps)` (one rounding on the month's total) |
| Items sold | `itemsSold × centsEach` |

**Order (exact):**
1. `charges = Σ` of the lines above.
2. `beforeLimits = charges + flatCents`.
3. Minimum: if `minimumCents` and `beforeLimits < minimumCents`, the
   amount becomes `minimumCents` (a "minimum" adjustment line shows the
   difference). A month with no activity still owes the minimum.
4. Cap: if `capCents` and the amount `> capCents`, it becomes `capCents`
   (a "cap" adjustment line shows the reduction).
5. `amountCents` (owed) = the result. `earnedCents = commissionCents +
   amountCents`. Commission is never counted toward the minimum or the cap.

Validation (refuses, never clamps): unit charges and the package minimum are
whole cents `1..1,000,000` (`$10,000`; the minimum may be 0); `bps` whole
`1..10000`; flat `0..100,000,000`; minimum and cap `1..100,000,000`;
minimum `<=` cap. An empty deal (no charge, no flat, no minimum) is allowed:
it bills $0 from its effective month (how a deal is ended).

**Deal in effect for month M:** the version with the greatest
`effectiveFrom <= M`; on a tie, the one saved last. Months before the first
version have no deal ($0, counts still shown).

## 4. Commission: keep or replace

`billingDeals/{businessId}.commissionMode`: `keep` (default) | `replace`.

- **replace** (super admin, `setCommissionMode`): in one transaction the
  server writes the SAME fields the Finance settings already write on
  `businesses/{id}` — `platformFeePct: 0`, every existing
  `servicePlatformFeePct.<key>: 0` (otherwise a per-service override would
  keep charging, `platform_fees.js` level 1), `platformFeeUpdatedAt`,
  `platformFeeUpdatedBy` — and stores what was there in
  `commissionBackup` (`{platformFeePct: {present, value},
  servicePlatformFeePct: {<key>: value}}`). An `adminAuditLogs` entry
  `billing_commission_replaced` records before/after. No second fee system:
  every payment path keeps resolving through `platform_fees.js`.
- **keep** after replace: restores each backed-up value (an absent
  `platformFeePct` is deleted again) — but only where the field still reads
  the `0` Bills wrote. A value someone changed since is left alone and the
  answer lists it in `notRestored`. Audit `billing_commission_restored`.
- The commission line on a bill is what was actually taken that month,
  whatever the mode; under replace it falls to $0 for payments after the
  switch. The legacy `platformCommissionPct` is not touched
  (`platformFeePct` takes precedence over it). A `billingPlan` subscription
  is not touched either.

## 5. Data model (all server-only)

`firestore.rules`: `billingDeals`, `billingMonths`, `billingPayments` →
`allow read, write: if false;` read and written only through the callable.

`billingDeals/{businessId}`
```
{businessId, commissionMode: "keep"|"replace", commissionBackup|null,
 versions: [{id, effectiveFrom: "yyyy-mm", deal, note, createdAtMs,
   createdBy}],           // oldest first, at most 120
 updatedAt, updatedBy}
```

`billingMonths/{businessId}_{yyyy-mm}` (created by the first payment or a
close)
```
{businessId, month, status: "open"|"closed",
 paidCents, paymentCount,
 amountCents|null, unpaidCents,        // closed: snapshot amount, max(0, amount - paid); open: null, 0
 snapshot|null: {bill, usage, dealVersionId, deal, commissionMode,
   computedAtMs},
 closedAtMs, closedBy, reopenHistory: [{reopenedAtMs, reopenedBy, reason,
   closedAmountCents}],   // last 20
 updatedAt}
```

`billingPayments/{paymentId}`
```
{businessId, month, amountCents, paidOn: "yyyy-mm-dd", method, note,
 recordedBy, recordedAtMs, voided, voidedBy?, voidedAtMs?, voidReason?}
```
`method`: `zelle` | `cash` | `card` | `bank_transfer` | `check` | `other`.
A payment is never erased: void strikes it through (the codebase's money
rule) and the month's `paidCents` is the sum of the payments not voided,
kept in the same transaction.

## 6. Callable `platformBilling` (one function)

`onCall({enforceAppCheck, cors: true, invoker: "public", maxInstances: 1,
memory: "1GiB", timeoutSeconds: 120})`, routing on `data.action`.
Refusals are `HttpsError` with `details.reasons: [code]`.

| Action | Who | Payload | Answer |
| --- | --- | --- | --- |
| `getMonthBills` | view | `{month?, cursor?}` | `{month, timeZone, summary, rows[], nextCursor, complete, canManage, computedAtMs}` |
| `getBusinessBill` | view | `{businessId, month?}` | `{business, month, status, bill, usage, closed, drift, deal, versions, commissionMode, payments, paidCents, unpaidCents, standing, unpaidToDateCents, months[], pastOpenMonths, canManage}` |
| `whatIf` | view | `{month?, deal, businessId?, cursor?}` | one business: `{now, alt, deltaCents}`; all: `{rows[], totals, nextCursor, complete}` |
| `saveDeal` | super | `{businessId, effectiveFrom, deal, note?}` | `{versionId, effectiveFrom, deal}` |
| `setCommissionMode` | super | `{businessId, mode}` | `{mode, notRestored[]}` |
| `recordPayment` | super | `{businessId, month, amountCents, paidOn, method, note?}` | `{paymentId, paidCents}` |
| `voidPayment` | super | `{businessId, paymentId, reason?}` | `{paidCents}` |
| `closeMonth` | super | `{businessId, month}` | `{amountCents, closedAtMs}` |
| `reopenMonth` | super | `{businessId, month, reason}` | `{status: "open"}` |

view = admin with the `finance` capability or Finance view access
(`requireVolumeAdmin`'s rule); super = `adminRole == superAdmin`.

**Refusal codes.** `permission-denied`: `billing_view_required`,
`billing_manage_required`. `invalid-argument`: `action_invalid`,
`business_invalid`, `month_invalid`, `deal_invalid`, `charge_mode_invalid`,
`amount_invalid`, `rate_invalid`, `minimum_invalid`, `cap_invalid`,
`minimum_above_cap`, `effective_month_invalid`, `effective_month_out_of_range`
(more than 24 months back or 12 ahead), `note_too_long` (> 300),
`commission_mode_invalid`, `paid_on_invalid` (not a day, before 2020, or
after today in New York), `method_invalid`, `reason_required`,
`cursor_invalid`. `failed-precondition`: `effective_month_closed`,
`deal_history_full`, `month_not_over` (close the current or a future month),
`month_already_closed`, `month_not_closed`, `payment_exceeds_balance` (a
closed month: more than it still owes), `payments_full` (200 a month),
`bill_incomplete` (a read hit its deadline: nothing frozen).
`not-found`: `business_not_found`, `payment_not_found`.
`failed-precondition`: `payment_already_voided`.

Every write is audited in `adminAuditLogs` (`billing_deal_saved`,
`billing_commission_replaced` / `_restored`, `billing_payment_recorded` /
`_voided`, `billing_month_closed` / `_reopened`).

## 7. Bounded work

- Per business per month: one `volumeMonthly` read; the lines query (only
  for a percent package charge); the parking queries (only with a parking
  charge): `parkedCars` by `businessId` + `occupancyEndMs >= monthStart`,
  `lotActivities` by `businessId` + `activityDate` in the month and undated;
  `inventorySales` by `businessId` + `createdAt` in the month (only with an
  item charge). Each paged with a deadline; a cut-short read marks the row
  `complete: false` and closing refuses `bill_incomplete`.
- Commission: the same full read of five collections `getPlatformEarnings`
  does, computed once into compact lines and kept on the instance for 10
  minutes (maxInstances 1, so one cache).
- `getMonthBills`: candidates are businesses with a deal, a Volume rollup
  for the month, commission in the month, or a `billingMonths` doc for the
  month. At most 100 rows per call (deals first, then by name), `nextCursor`
  for the rest, rows computed 6 at a time under a 90-second deadline; the
  summary says when it covers only part.
- `whatIf` for all businesses adds businesses whose `enabledServices`
  contain `carParking` / `inventory` when the rate card charges for them.
  A business that never stored its services is not added that way.
- Unpaid to date = closed months still owed: `billingMonths` where `status ==
  "closed"` and `unpaidCents > 0`. Open past months are listed as "not closed
  yet" so nothing is hidden, but they are not added to the unpaid total.

Indexes added: `billingMonths (status, unpaidCents)` and `billingMonths
(businessId, month DESC)`. Everything else reuses existing indexes
(`containerLines (businessId, receivedAt|createdAt)`, `parkedCars
(businessId, occupancyEndMs)`, `lotActivities (businessId, activityDate
DESC)`, `inventorySales (businessId, createdAt DESC)`); payments of one month
are an equality-only query (at most 200) sorted in memory.

## 8. Close, drift, reopen

- Close (a month that has ended in New York): compute the live bill with the
  deal in effect; refuse when incomplete; store the snapshot, amount, unpaid.
- Viewing a closed month recomputes it with the SNAPSHOT's deal and compares
  usage: each changed count is a drift item (`{key, before, after}`), e.g.
  "Packages +3 since you closed", plus what the bill would be today. The
  closed amount is what is owed; drift is information only.
- Reopen (super admin, reason required) returns the month to live and keeps
  the closed amount in `reopenHistory`.
- A deal version cannot start in a closed month (`effective_month_closed`).

## 9. Screens (admin console → Bills)

Nav entry "Bills" (`admin-areas.ts`, governance `follows: "finance"`, like
Volume), `components/billing-views.tsx`, pure helpers in
`lib/platform-billing.ts`, preview data (`?preview=1`) in
`lib/platform-billing-preview.ts`.

- Month picker (Volume's), tiles: owed this month, paid this month, unpaid
  to date (closed months), commission taken.
- Businesses table: deal summary, barrels / packages / cars, amount owed,
  paid, status (open / closed), drift badge; a row opens the business.
- Business view: the bill line by line ("87 × $1.00 each = $87.00"), flat,
  minimum / cap adjustments, commission taken, owed, total earned; payments
  with Record payment / Void; Close month / Reopen; drift note; deal editor
  (effective month, every charge, commission keep/replace) with the history;
  "Try a different deal" (now vs with this deal).
- "Try other rates" for all businesses: one rate card, per-business now vs
  with it, platform totals. Never saved.
- Every string in English and French (`french-dom.ts`); business names and
  notes are `data-no-translate`. Works from 375 px to desktop.

## 10. Edge cases

- A business deleted since: its rows show its id.
- A version saved for a month already passed (but not closed) re-prices that
  open month: intended; the history says who and when.
- Overpaying an open month is allowed (the bill can still grow); the
  standing reads "overpaid". On a closed month it is refused.
- Commission lines with no business id are matched by name the way Finance
  matches them; lines with no date never fall in a month.
