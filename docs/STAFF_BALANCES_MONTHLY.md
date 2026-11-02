# Staff balances, month by month

Keren Auto Sales, 2026-11-02. The owner found the person "Details" window
(Staff balances) too thin: one cumulative total per line since the start,
nothing per month, so people cannot follow it. Decided:

- **A row per month**, oldest first, adding up to the person's net.
- **Money counts in the month its bill was for** (owner, Q "A"), not the
  month it was collected; each line still shows the date it was collected.
- Tapping a month opens its lines: every payment the person collected (what
  for, customer, car/job, amount, date collected), every bill they paid,
  every hand-over, their own parking that month.
- "Expenses they paid for the lot" shows the **real total** paid; the part
  used for their own parking is shown separately (it was mislabelled).

Builds on [STAFF_BALANCES.md](STAFF_BALANCES.md),
[STAFF_EXPENSE_CREDIT.md](STAFF_EXPENSE_CREDIT.md),
[EXPENSE_PAID_BY.md](EXPENSE_PAID_BY.md).

## 1. The month of each amount

| Amount | Month |
|---|---|
| Parking payment a person collected | The month(s) of the car's charges it paid off, **oldest first** — the same rule the month-end bill uses (`parkingMonthStatement`: money pays what came before, then this month). A car's payments are taken in time order; the payment covering cumulative cents `[a, b)` of the car's charges lands in each month by its overlap with that month's `[accruedThrough(end of previous month), accruedThrough(end of month))`. Anything paid beyond all charges goes to the car's last month. |
| Lot job payment / instalment | The job's month (`activityDateMonth`, else its date). |
| Package / shop / invoice receipt (when counted) | The month of the payment's own date. |
| Expense the person paid (real or a monthly line's standing payer) | The entry's `month`. |
| Paid back to them (staffExpenseRepayments) | Its `month`. |
| Hand-over (confirmed) given or received | The month of its date. |
| Their own parking (their linked customers: `staff:{uid}` and `staffParkingLinks`) | Month-end bills: `monthCents − monthPaidCents` of each month (what that month added and is still unpaid). Shared links split evenly, remainder to the first id, as today. |

## 2. Per person, per month

```
{ monthKey,
  collectedCents,          // Σ receipts for the month (counted kinds only)
  handedOutCents,          // confirmed, given
  receivedFromOthersCents, // confirmed, received
  ownParkingCents,         // their bills' unpaid charge for the month
  expensesPaidCents,       // what they paid for the lot
  paidBackCents,           // the business paid them back
  monthNetCents,           // collected − handedOut + received + ownParking
                           //   − expensesPaid + paidBack
  runningNetCents,         // Σ monthNet up to and including this month
  lines: {
    collected: [{source, id, label, customerName, vehicle, code,
                 amountCents, collectedAtMs, method}],
    expenses:  [{id, label, amountCents, standing}],
    handovers: [{id, direction: "out"|"in", otherName, amountCents, atMs}],
    parking:   [{customerKey, label, amountCents}],
    paidBack:  [{id, amountCents, atMs}],
  } }
```

Invariant (tested): the last month's `runningNetCents` equals the person's
existing `netCents` (`held + parkingDue − expenseOwedToThem`). Months run
from the first month with anything to the current month. Pending (not yet
confirmed) hand-overs stay out of the months, as they stay out of the net.

## 3. Where

- Server: pure `staffBalanceMonths(...)` in `staff_balances.js` (unit tests
  + the invariant); `staff_balances` answer gains `months` on each staff
  row. No new callable.
- Console (`staff-balances-panel.tsx` Details) and app
  (`staff_balances_screen.dart`): the monthly table (Month · Collected ·
  Bills paid · Own parking · Handed over · That month · Running), each month
  expandable to its lines; the "Expenses they paid for the lot" row shows
  the real total and "Used for their parking" under it. English + French.
