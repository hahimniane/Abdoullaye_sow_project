# Unpaid parking carried into later months

Decided with the owner on 2026-10-30 ("go ahead and build the carryover fix").

## The gap

A month's bill (`parkingMonthStatement`) only lists cars that were on the lot
during the month. A car that **left in an earlier month still owing** was on
no later bill at all: it vanished from Month end, from staff expense netting
and from the monthly invoice, and a customer whose only debt was such a car
got no invoice. Older unpaid **activities** already came along as "unpaid
from before"; cars did not.

## The rule

A car comes along on month M's bill as **unpaid from before** when:

- it is not voided and not `status: "cancelled"`;
- it has a leave day (`parkingEndDate`) **before** M's first day (a car still
  parked, or one that left on/after M's first day, is on M's own bill and its
  earlier days are already its `priorUnpaidCents`);
- what the whole stay ran up (`accruedThroughCents(row, leaveDay, today)`)
  minus what was paid (`paidCents(row, today)`) is above 0. That remainder is
  its `dueCents`.

Pure function `carriedCarItem(row, monthKey, now)` returns `{id, kind:
"parking", monthKey, periodFrom, periodTo, days, accruedCents, dueCents,
prior: true, customerName, customerPhone, customerEmail, vehicle, vinNumber,
trackingCode, paymentMethod, recordable}` or null.

- `parkingMonthSummary` gains `carried: [...]` (built from the same car rows).
- `parkingMonthCustomers(bills, activities, carried)`: carried cars group by
  the same phone key; each customer gains **`olderCars`** (sorted by
  `periodFrom`, then vehicle, each tagged `registeredTo`), and
  `priorUnpaidCents` adds `sum(olderCars.dueCents)`. A customer whose only
  line is a carried car still gets a bill (`monthCents` 0, `owes` true,
  `paid` false). `monthKey` falls back to `olderCars[0].monthKey`.
- Bill text: under "Unpaid from before", carried cars first, e.g.
  `Sep 6, 2026 to Sep 7, 2026 · Parking · 2021 Toyota Highlander (registered to Mariam) — $24.00`,
  then the older activities as before. The heading shows when either list
  has lines.
- Mark all paid (`monthBillPaymentPlan`): carried cars first (oldest money),
  then the month's cars, as `kind: "car"` items for their `dueCents`, skipped
  when not `recordable` exactly like the month's cars.
- Invoice PDF: "Unpaid from before" sub-lines list carried cars
  (`Sep 6, 2026 – Sep 7, 2026 · Parking / Stationnement · 2021 Toyota Highlander`)
  before older activities. The WhatsApp Track button falls back to a carried
  car's tracking code.

Shared fixture: `my_flutter_app/functions/test/fixtures/parking-carryover-cases.json`
(server `test/parking-carryover.test.js`). The console and app mirrors must
give the same `carried` and `customers` answers for every case.

## Reads (no history scans)

Every stored car carries a `paymentStatus` (checked on production
2026-10-30: all of them). Month end adds ONE read, on the existing
`parkedCars (businessId, paymentStatus)` index:

    parkedCars where businessId == id
               where paymentStatus not-in ["paid", "succeeded"]

merged by id with the existing `occupancyEndMs >= monthStart` read. Server:
`parkingMonthEndData` (month-end notice, invoices). Console:
`parkingMonthQueryPlan` gains `unpaidCars`. App: the month-end screen's
listeners. Staff balances already read every car (no change).
`test/parking-month-scope.test.js` replays the reads and requires the
whole-history summary; `test/console-query-rules.test.js` allows the query.
