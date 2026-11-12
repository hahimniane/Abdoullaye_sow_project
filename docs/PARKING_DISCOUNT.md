# Parking discount

Owner, 11/11/2026: a car is parked at $12 a day, the customer has run up
$2,000, and the lot agrees to take $1,500. "Can we add a discounted price and
just mark it all as paid?"

## Decisions (owner, one question at a time)

| # | Decision |
|---|---|
| 1 | **A discount is its own line on the bill**: $2,000 parking, −$500 discount, $1,500 paid, $0 left. The price is never rewritten; History keeps who, when and why. |
| 2 | **Anyone with the parking permission** can give one. |
| 3 | **No limit on the amount, but a reason is required.** It can never be more than what the car owes. |
| 4 | **Two ways:** "Settle for a lower amount" (amount paid now + method + received by + reason: the rest of what is owed today becomes the discount, payment and discount recorded together) and "Give a discount" alone (the balance left stays to pay later). |
| 5 | **Car still parked:** the discount covers what is owed up to today; the days keep adding up from tomorrow. It never ends the stay. |
| 6 | **The customer sees the discount line** on the receipt or invoice they already get (WhatsApp + PDF). No new template. |
| 7 | **It can be undone** like a payment, by anyone with parking, and the undo is logged. "Discounts given" shows per month, person and lot in the parking money figures. Staff balances are unaffected (a discount is not cash). |

Team members' cars follow the same rules. Website first; the phone app in its
next build.

## Data (on the `parkedCars` document)

- `parkingDiscounts`: `[{id, amountCents, reason, mode: "discount"|"settle",
  paymentCents, givenByUid, at, atMs, undone?, undoneByUid?,
  undoneAtMs?}]`. An undone discount stays in the list.
- `parkingDiscountCents`: the sum of the live ones. Every balance reads it.
- A discount is never in `amountPaidCents` or `parkingPayments`, so cash
  held, "collected", payouts and the bill-payment undo check are untouched.

## The rule everywhere

What a car owes = what it ran up − what was paid − `parkingDiscountCents`.

- Server `parking_month_statement.js`: `discountCentsOf`; `parkingBalanceNow`
  (balance, `paidInFull`, `discountCents`); `paidCents` (a car marked paid
  with no amount counts what it ran up less the discount); the month bill
  covers oldest first with cash then discount (`monthDiscountCents`);
  `carriedCarItem`.
- Server `console_summaries.js` and `business_parking_entry.js`: balance,
  mark paid (records only the net), part payment and close plans compare
  against the total less the discount.
- Website and app mirror the same helpers (`parking-balance.ts`,
  `parking-month-statement.ts`, `business-parking-entry.ts`; the Dart
  services of the same names), held together by the shared fixtures.

## Server

`parking_discount.js` (pure) and three actions on
`updateBusinessParkingEntry` (no new function):

| Action | What |
|---|---|
| `discount_give {entryId, amountCents, reason}` | Discount alone. |
| `discount_settle {entryId, paidCents, receivedVia, receivedByStaffId, reason, expectedOwedCents}` | Payment (a normal part payment, with `discountId`) + discount for the rest owed today. |
| `discount_undo {entryId, discountId}` | Marks the discount undone. A settle's payment stays; undo it as a payment if needed. |

Only cars the business records payments for (direct, entered by the
business). Refusals carry `details.reason` (`DISCOUNT_MESSAGES`).
A stay with a leave date that payments and discounts now cover takes the
"paid" shape; an open stay never does (decision 5).

Also: `billParkingThroughToday` (the old whole-days payment link) refuses a
discounted car (`parking_has_discount`): the link would charge what the lot
took off. `parking_whatsapp.settledCents` counts only the net, so a discount
that settles a car sends no "payment received" message.

## Money figures

`console_summaries.parkingSummaryPartial` adds `discountedByMonth` (cents per
month of the year, by the month the discount was given, in the viewer's time
zone) and `discountedByMonthByUid` (the same per person). `getParkingTotals`
returns both, and each lot's `month.discountCents`. The Parking page shows
"Discounts this month" with who gave them, and each lot card its own figure.
The month bill (`monthDiscountCents`, summary `discountCents`) never counts a
discount as collected.

## Website

- Each parked car's payment actions (`ParkingBillingActions`) show
  `ParkingDiscountActions` (`admin_web/src/components/business/parking-discount.tsx`):
  the car's discounts (newest first, Undo; undone ones greyed), and
  "Settle for a lower amount" / "Give a discount" with a live preview from
  `admin_web/src/lib/parking-discount.ts` (the server's checks, in its order).
- Receipt and stay-statement PDFs (server) and the month bill PDF (website)
  print "Discount / Remise -$X".
- History sentences: "Discount of $X given (reason)", "Settled for $X:
  discount of $Y (reason)", "Discount of $X undone" (French shapes in
  `audit-summaries.ts`).

## Tests

Shared fixture `my_flutter_app/functions/test/fixtures/parking-discount-cases.json`
(server `test/parking-discount.test.js`, console
`src/lib/parking-discount.test.ts`, app `test/parking_discount_test.dart`),
new cases in `parking-balance-cases.json` and `parking-carryover-cases.json`,
and the emulator test `test/parking-discount-callables.test.js`
(`npm run test:parking-discount`).

## Month end: settle a customer's bill for less (owner, 11/11/2026)

On a customer's Month end card, the "Record a payment" sheet has a second
kind, **Settle for a lower amount**: what the customer pays now + method +
received by + why. `billSettlePlan` (parking_bill_payment.js, mirrored in
parking-bill-payment.ts; shared fixture
`test/fixtures/parking-settle-cases.json`): the money pays the lot jobs first
(a discount only comes off parking; less than the jobs is refused,
`bill_settle_jobs_first`), then the cars oldest first; what the cars still
owe becomes a discount on each car. Server action `bill_settle` (same
callable as `bill_payment_record`, same checks): one `parkingBillPayments`
document with `mode: "settle"`, `reason`, `discountCents`, `discountParts`;
each car gets a `parkingDiscounts` entry carrying `billPaymentId`; a stay the
money and discount cover takes the paid shape. `bill_payment_undo` removes
the money AND those discounts (also on cars the money did not reach). An
all-discount settle (nothing paid) needs no receiver and sends no receipt.

## Not in this release

- The phone app screens (the Dart rules are in; buttons next build).
- The public Track page shows the right balance but no discount line yet.
- "Discounts given" on the Lot ledger reports page (the Parking page has it).

