# Who pays an expense: a person or the business

Keren Auto Sales, 2026-11-02. Yao pays the lot's rent ($8,500, a monthly
"fixed" line) out of the parking cash he collects, every month. The
owner wants that counted as Yao's money spent, automatically, and wants
expenses the business pays itself to count for nobody.

Builds on [STAFF_EXPENSE_CREDIT.md](STAFF_EXPENSE_CREDIT.md): an expense
"paid by" a staff member is money the business owes them; it comes off
their parking bill and their Staff balance.

## 1. Decisions

1. **"The business" is a payer.** `paidByStaffId: "business_account"` (the
   same constant Staff balances already uses for "Business account").
   Such an expense is a cost of the lot and nobody's credit. Offered on
   every "Paid by" picker (purchase form and monthly lines).
2. **A monthly (fixed) line has a "Paid by", with a starting month.** Rent
   → Yao from October 2026. Each month the line counts, its amount is that
   person's expense, as if they had logged a purchase for it. No one has to
   record it each month.
3. **History is kept, not rewritten.** Changing who pays takes effect from
   a chosen month; months before keep their payer.
4. **A purchase logged on the line for a month wins.** If someone records
   that month's bill (a different amount, a different payer, a receipt),
   the standing payer is skipped for that month — exactly as the logged
   purchase already replaces the line's standing amount in the ledger
   (`loggedAgainst`). September's rent, recorded by hand as Yao's, stays.
5. **Default is the business.** A line with no payer set behaves as today:
   its monthly amount is the lot's cost, nobody's credit.

## 2. Data

`lotExpenseLines/{id}.payers` (server-write only, through the callable):

```
[{ fromMonth: "yyyy-mm", staffId: "<uid>" | "business_account",
   setByUid, setAtMs }]
```

The payer for month `M` is the entry with the greatest `fromMonth <= M`;
none → the business. Setting a payer for a `fromMonth` that already has one
replaces it. Never deleted.

## 3. The arithmetic (pure; mirrored in server, console, app)

`staff_expense_credit.js` · `staff-expense-credit.ts` ·
`staff_expense_credit.dart`, on the shared fixture
`functions/test/fixtures/staff-expense-credit-cases.json` (`standing`).

- `linePayerFor(line, month)` → staff id, or `""` for the business.
- `standingPayerEntries(lines, entries, nowMonth)` → one virtual entry
  `{id: "standing:{lineId}:{month}", lineId, month, amountCents:
  recurringCents, paidByStaffId, note: "", spentAtMs, standing: true}` for
  every month `M` with all of:
  - line is `kind: "fixed"`, not voided, `active !== false`;
  - `M <= nowMonth` and `M <= endMonth` (when stopped);
  - the payer for `M` is a person (not the business, not empty);
  - no non-voided real entry has this `lineId` and `month == M`.
  Months run from the earliest `fromMonth` to `nowMonth` (at most 36).
- `withStandingPayers(entries, lines, nowMonth)` = entries + those.
- `staffCredits` and `monthExpenseLines` ignore `business_account`.

Every place that nets expenses passes `withStandingPayers(...)` instead of
the raw entries: Staff balances (server), the repayment cap (server),
month-end bills and invoices (server, console, app). The ledger's own
month totals are unchanged (the line's amount was already counted).

## 4. Callable

`upsertLotExpenseLine` `action: "setPayer"` `{businessId, lineId, staffId,
fromMonth}` — `ledger` permission. Refusals: `line_not_found`,
`line_voided`, `line_not_fixed` (only monthly lines have a standing payer),
`payer_not_member` (a person must be on the team; `business_account`
always allowed), `payer_month_invalid` (`fromMonth` not "yyyy-mm", or
before the line's first month). Writes `payers` and a History row ("Paid
by: The business → Yao from October 2026").

## 5. Where it shows

- **Console, Lot ledger**: a monthly line's card says "Paid by Yao since
  Oct 2026" (nothing when the business pays). Its edit (pencil) has "Paid
  by" (The business + each team member) and "Starting" (month). The
  purchase form's "Paid by" gains "The business"; such purchases read
  "The business".
- **App, Lot ledger**: the same label on monthly lines and "The business" in
  the purchase "Paid by". Setting a line's payer is console-only at first.
- Bills/Staff balances show standing payments like any expense line
  ("Rent · $8,500.00").
