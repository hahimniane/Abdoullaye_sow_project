# Paying part of a month bill

Decided with the owner on 2026-10-30 ("Use recommendations and build"):

1. **Staff record it.** A customer pays part of their monthly bill (cash,
   Zelle...). Staff type ONE amount on the customer's Month end card. An
   online "Pay" link for customers is a later add-on.
2. **Oldest first, automatically.** The amount pays the bill's charges
   oldest first; staff do not pick cars. A preview shows what it pays off
   and what is left.
3. **Never more than owed.** The amount is capped at what the bill can be
   paid here; there is no parking credit balance. Staff give change back.
4. **One WhatsApp receipt per payment**, not one per car it touched.
5. **Undo the whole payment at once.** It stays on the record as "Undone"
   (who, when). Nothing is deleted. Same permission as recording. No message
   to the customer; the next receipt shows the corrected totals.

## The split (pure, shared)

`parking_bill_payment.js` (server) · `admin_web/src/lib/parking-bill-payment.ts`
(console) · `my_flutter_app/lib/services/parking_bill_payment.dart` (app).
All three must give the same answers for
`my_flutter_app/functions/test/fixtures/parking-bill-payment-cases.json`.

`billPaymentItems(customer)` — the charges a payment can pay, oldest first:

- **Before the month** (in date order): `olderCars` (`dueCents`, day =
  `periodFrom`), each month car's `priorUnpaidCents` (capped at its
  `dueCents`, day = `periodFrom`), `olderActivities` (`dueCents`, day =
  `date`).
- **Then the month** (in date order): each month car's rest
  (`dueCents - prior`), then `activities` (`dueCents`, day = `date`).
- Sort is **stable** by the day key (`"YYYY-MM-DD"` string compare) within
  each group, so on the same day a car comes before an activity, and a car's
  earlier days before its month.
- Cars with `recordable !== true` (Stripe / payment link) are left out, as
  in Mark all paid.
- Linked staff's expense credit (`expenseCreditCents`) covers the first
  items (`itemsAfterCredit`, the same helper Mark all paid uses).
- Item: `{kind: "car"|"activity", id, label, trackingCode, dayKey,
  amountCents}`. Car label = `vehicle` or "Car"; activity label = `label`
  (or "Activity") + `" · " + vehicle` when there is one.

`billPaymentPlan(customer, amountCents)` →
`{ok, reason, payableCents, parts, leftCents}`:

- `payableCents` = sum of the items. `leftCents` = `customer.dueCents -
  amount` (floored at 0) when ok, else `customer.dueCents`.
- Refusals, checked in this order: `bill_payment_nothing_to_pay`
  (payable 0), `bill_payment_no_amount` (amount not > 0),
  `bill_payment_more_than_owed` (amount > payable). Refused → `parts: []`.
- Parts: walk the items, take `min(left, item)`; a car's two items merge
  into one part. Each part `{kind, id, label, trackingCode, amountCents,
  full}`; `full` = the part covers everything that charge owed on the bill.

`billPaymentFor(parts, lang)` — "A", "A and B", "A, B and N more" /
"A et B", "A, B et 1 autre", "A, B et N autres"; distinct labels; none →
"parking" / "stationnement".

## Server

`updateBusinessParkingEntry` actions (no new function):

- `bill_payment_record {businessId, monthKey, customerKey, amountCents,
  receivedVia, receivedByStaffId, note?, expectedPayableCents?}` →
  `{success, billPaymentId, amountCents, leftCents, parts:[{kind, id,
  label, amountCents, full}], receipt}` (`receipt`: "sent" / "failed" /
  "skipped" / "" when parking WhatsApp is off).
  - Permission `parking`; also `ledger` when a part is an activity
    (refusal `bill_payment_ledger_required`, permission-denied).
  - Rebuilds the customer's bill exactly as Month end shows it (the month's
    statement + linked staff expense credit, strict), as of now.
  - `expectedPayableCents` (the preview's `payableCents`) must match, else
    `bill_payment_bill_changed` — the client refreshes.
  - One transaction: each car part is a normal part payment (the shared
    `parkingPartPaymentUpdate`: entry on `parkingPayments` with
    `billPaymentId`, total, settled shape when it covers a fixed stay); each
    activity part a normal instalment (`lotInstalmentWrites`:
    `lotActivityPayments` row with `billPaymentId`). Any part that no
    longer applies in full → `bill_payment_bill_changed`, nothing written.
  - Writes `parkingBillPayments/{id}`: `{businessId, monthKey, customerKey,
    customerName, customerPhone, amountCents, receivedVia,
    receivedByStaffId, recordedByUid, note, parts:[{kind, id, label,
    trackingCode, amountCents, full, paymentRecordId?}], dueBeforeCents,
    leftCents, billPaidCents, status: "recorded", documentToken, at, atMs,
    createdAt}`.
  - Other refusals: `bill_payment_receiver_required` (invalid-argument),
    `bill_payment_month_invalid` (invalid-argument; month not started),
    `bill_payment_customer_not_found`. Every refusal carries
    `details.reason`.
- `bill_payment_undo {businessId, billPaymentId}` → `{success,
  billPaymentId, undone:[{kind, id, amountCents}]}`.
  - Same permissions. One transaction: a car's entries with this
    `billPaymentId` move to `revertedParkingPayments` (as the car's own undo
    does), its total drops, a `paid` car goes back to
    `awaiting_direct_payment`; an activity's instalments get `reverted:
    true`, its total drops, a `succeeded` one goes back to awaiting. The
    payment gets `status: "undone", undoneByUid, undoneAt, undoneAtMs`.
  - A part already taken off by the car's own undo is skipped.
  - Refusals: `bill_payment_not_found` (not-found),
    `bill_payment_already_undone`, `bill_payment_settled_since` (a car or
    activity was marked paid in full afterwards with no entry of its own —
    its total no longer matches its payments; undo that first).

Staff balances already count every live `parkingPayments` entry and every
non-reverted `lotActivityPayments` row by `receivedByStaffId`, so a bill
payment counts as cash the receiver holds, and an undo takes it back off.

## Receipt (WhatsApp)

When the parking WhatsApp switch is on: ONE `parking_receipt_2lang` (already
approved) per bill payment — row `parkingMessages/bill_{id}`, kind
`bill_receipt`:

- 3/8 amount; 4/9 `billPaymentFor(parts)`; 5/10 `billPaidCents`
  (the month's paid before + this payment); 6/11 "Balance owed: $X" for
  `leftCents` or "Paid in full"; 12 + button: the first car part's tracking
  code. A payment on activities only has no car code: the row is `skipped`
  with error `no_car`.
- PDF: `billReceiptModel` (parking_receipt_pdf.js), stored at Storage
  `parkingBillReceipts/{businessId}/{id}.pdf`; link
  `/d?view=billReceiptPdf&t={documentToken}&p={id}&e=&s=` signed with the
  `bill:` prefix (`package_proof.billReceiptLink`). An undone payment's link
  is 404. Lists up to 12 lines, then "And N more".
- The cars' own per-payment receipts are **not** sent for a bill payment's
  parts: `parking_whatsapp.newPayments` returns nothing for a write that
  added an entry carrying `billPaymentId` (not even the "car just settled"
  receipt).

## Clients (Month end card)

Read: `parkingBillPayments where businessId == id where monthKey == month`
(rules: the business's team reads; no client writes). Shown on each
customer's card (match `customerKey`), newest first.

On a customer card, when the person can settle (same gate as Mark all paid),
the view is not an estimate, and `billPaymentPlan(customer, 1).payableCents
> 0`:

- **Record a payment** button next to Mark all paid → a sheet:
  - Amount ($, prefilled empty), Method (the same methods as the car's part
    payment), Received by (the same staff picker Mark all paid uses —
    required), Note (optional).
  - Live preview from `billPaymentPlan`: "Pays off: 2014 Toyota Corolla
    $30.00 (paid) · 2016 Honda Civic $20.00 · Left on the bill: $120.00".
    A refusal shows its words (more than owed → "That is more than this
    bill owes ($X). Record what is owed and give the rest back.").
  - Save sends `bill_payment_record` with `expectedPayableCents =
    plan.payableCents`; on `bill_payment_bill_changed` show the message and
    let the live data refresh.
- **Payments on this bill**: each payment — amount, method, date (US,
  month-first), received by, what it paid (`billPaymentFor`). Recorded ones
  have **Undo** (confirm dialog: "Undo this $X payment? It comes off every
  car and job it paid."); undone ones show "Undone · {date}" greyed.

All new words in English and French (console `french-dom.ts`; app both ARB
files).
