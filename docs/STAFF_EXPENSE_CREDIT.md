# Staff expenses come off their parking bill

Keren Auto Sales: staff buy things for the lot out of their own pocket
(recorded in the lot ledger as expenses "paid by" them) and also park their
own cars there, which they pay for like anyone else. The business owes them
for the expenses; they owe the business for parking. Decided with the owner
on 2026-10-29: the two are netted on their month-end bill.

## 1. Decisions

1. **Every expense paid by a staff member is their own money** (no "business
   money" choice). Non-voided `lotExpenseEntries` only.
2. **The owner links each staff member to their parking customer once**
   (staff list → "Parking bill"), Laawol suggesting the match by phone or
   name. Owner (or platform admin) only.
3. **Automatic, by month.** On a month's bill, a linked staff member's
   expenses lower what they owe ("Expenses you paid for the lot −$X"). Extra
   credit carries forward. Reports show it as "by expenses".
4. **"Business owes" list** in the month-end report: staff the business still
   owes (no cars, or credit bigger than their bill), with a **Paid back**
   button recording the cash given (who gave it, how, note). Owner or staff
   with the `ledger` permission.
5. **Every expense already recorded counts**, September included.
6. Editing or voiding an expense changes the bills by itself (they are
   computed, not stored).

## 2. Data

### `businesses/{id}.staffParkingLinks` (server-write only)
`{ [staffUid]: { customerKey, customerName, customerPhone, linkedAtMs, linkedByUid } }`
- `customerKey` = `parkingCustomerKey({customerPhone, customerName})` (the
  last ten phone digits, else the name key) — the same key month-end bills
  group by.
- Several staff may link to the same customer (their credits add up).

### `staffExpenseRepayments/{id}` (server-write only)
`{ businessId, staffId, amountCents, month ("yyyy-mm" of paidAt), paidAt,
   method ("cash"|"zelle"|"check"|"other"), givenByStaffId, note, voided,
   voidedAt, voidedByUid, createdAt, recordedByUid }`
Never deleted; a mistake is voided.

### Rules
`staffExpenseRepayments`: read `lotLedgerRead(resource.data.businessId)`,
write false. `staffParkingLinks` lives on the business doc (already readable
by its managers; written only by the callable).

## 3. The arithmetic (pure; mirrored in server, console, app)

Module: `functions/staff_expense_credit.js` · `admin_web/src/lib/staff-expense-credit.ts`
· `my_flutter_app/lib/services/staff_expense_credit.dart`. One shared JSON
fixture (`functions/test/fixtures/staff-expense-credit-cases.json`) run by
all three suites.

For month `M` ("yyyy-mm"):

- `expensesCents(staff, M)` = Σ `amountCents` of non-voided entries with
  `paidByStaffId == staff` and `month <= M`.
- `repaidCents(staff, M)` = Σ non-voided repayments with `month <= M`.
- `creditCents(staff, M)` = max(0, expenses − repaid).
- A customer's credit = Σ credits of the staff linked to it.

Month-end bills already carry `dueCents` = everything the customer owes as of
the end of `M` (this month unpaid + unpaid from before). Because both sides
are cumulative, netting them never needs history:

- `expenseCreditCents` (applied on the bill) = min(dueBefore, credit)
- `dueCents` (what they still owe) = dueBefore − applied
- leftover = credit − applied → the "Business owes" list (split back across
  the linked staff in proportion to their credits, rounding to the first).

Staff with credit but **no link**, or linked to a customer with no bill this
month, appear in "Business owes" with their whole credit.

Customer fields added to `ParkingMonthCustomer`:
`dueBeforeExpensesCents`, `expenseCreditCents`, `expenseLines` (this month's
entries of the linked staff: `{id, date, label, amountCents, staffName}`),
`linkedStaffIds`. `owes` = `dueCents > 0`; `paid` as before but on the
netted `dueCents`.

Summary fields added: `expenseCreditCents` (Σ applied), `businessOwes:
[{staffId, staffName, customerKey, owedCents}]`, `businessOwesCents`.
`dueCents` / Still owed tile are after expenses. Billed and Collected are
unchanged.

**Mark all paid** records only the netted amount: `monthBillPaymentPlan`
reduces its items oldest-first by `expenseCreditCents` before paying (the
credit covers the first items; the car rows keep that part "unpaid" on
purpose — next month the same cumulative credit covers it again).

**Paid back** may record at most the person's `owedCents` shown (client
cap); the server checks only that the amount is > 0 and ≤ the staff
member's `creditCents(staff, current month)` (it cannot see bills).

## 4. Callables (no new exports — 1000-CPU budget)

On `updateLotExpenseEntry`, by `action`:
- `link_staff_parking {businessId, staffId, customerKey, customerName,
  customerPhone}` — owner/admin; staff must be a member of the business.
  `customerKey: ""` unlinks.
- `record_staff_repayment {businessId, staffId, amountCents, method,
  givenByStaffId, note, paidAt?}` — `ledger` permission.
- `void_staff_repayment {businessId, repaymentId}` — `ledger` permission.

Refusals: `staff_not_member`, `repayment_amount_invalid`,
`repayment_exceeds_credit`, `repayment_not_found`, `repayment_voided`,
`link_owner_only`.

## 5. Where it shows
- **Console** (`parking-month-end.tsx`): the customer card's line, the bill
  PDF and copied text ("Expenses you paid for the lot" lines, then "Less
  expenses −$X"), the Still owed tile, a "Business owes" section with Paid
  back. Staff list: "Parking bill" link picker with suggestions.
- **App** (`parking_month_end_screen.dart`): the same numbers, lines and
  "Business owes" with Paid back. Linking stays in the console (done once).
- **Server** (`notifyParkingMonthEnd`): the owing totals in the 1st-of-month
  push use the netted numbers.
