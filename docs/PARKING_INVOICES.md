# Monthly parking invoices on WhatsApp

Decided with the owner on 2026-10-30 (3 questions + the rule below). Builds
on docs/PARKING_WHATSAPP.md (same switch, same send/row/contact plumbing,
same receipt design) and the month-end statement
(`parking_month_statement.js` + staff expense netting,
docs/STAFF_EXPENSE_CREDIT.md).

## 1. Decisions

1. **Who:** at the end of each month, every parking customer of the
   business (grouped by `parkingCustomerKey`, i.e. phone) who **owes money
   (netted `dueCents > 0`) OR still has a car parked** gets ONE invoice
   covering all their cars. Staff linked to a parking bill are included
   with their expenses netted (exactly what Month end shows).
2. **When (owner reviews first):** on the 1st (the existing
   `notifyParkingMonthEnd` push) the owner is told "{Month}'s invoices are
   ready: N customers, $X". Month end shows a **Send invoices** panel with a
   preview list; the owner taps Send. If nobody has sent them by the **3rd
   (New York time)**, they go out automatically. Only for businesses whose
   `parkingWhatsApp.enabled` is true.
3. **Design:** the invoice PDF uses the SAME design as the WhatsApp receipt
   (`parking_receipt_pdf.js`, itself matching the printable parking
   document): logo + business header, **INVOICE / FACTURE** + number
   `INV-{YYYYMM}-{phoneDigits last 4}-{n}`, a status pill (PAYMENT DUE /
   À PAYER, or PAID UP / À JOUR when $0 due but still parked), the
   customer block, then one row per car (car · VIN · days × rate = amount
   for the month), lot activities of the month, "Unpaid from before",
   "Less expenses" (+ earlier-months line), payments received, and a
   shaded **Balance due** box. Bilingual labels like the receipt.
4. **How to pay:** `businesses/{id}.paymentInstructions` (plain text, ≤ 300
   chars, e.g. "Pay at the office, or Zelle 347-xxx-xxxx (Keren Auto
   Sales)"), set by the owner in Business settings; printed in the PDF
   under the Balance due box and sent as a template variable. Missing →
   the line is left out of the PDF and "—" in the message.

## 2. Server (no new Cloud Function exports)

- **Pure:** `parking_invoices.js` — `invoiceRecipients(summary,
  staffCredit, now)` (from the month-end summary with netting: customers
  with `dueCents > 0` or any `stillParked` car; voided cars excluded),
  `invoiceNumber`, `invoiceMessageValues`. Fixture
  `test/fixtures/parking-invoices-cases.json` + unit tests.
- **PDF:** `parking_invoice_pdf.js` reusing the receipt module's drawing
  helpers (export what is needed from `parking_receipt_pdf.js`; never
  fork the layout). Logo fetch with the same timeout/fallback.
- **Batch doc:** `parkingInvoiceRuns/{businessId}_{yyyy-mm}` `{businessId,
  monthKey, status: "ready"|"sending"|"sent", preparedAtMs, sentAtMs,
  sentBy: uid|"auto", recipients: N, totalDueCents, sent, failed,
  skipped}`. Server-write only; read by business managers.
- **Rows:** `parkingMessages/invoice_{businessId}_{yyyy-mm}_{phoneDigits}`,
  `kind: "invoice"`, `.create()` idempotent (one per customer per month),
  same fields as other parking messages + `monthKey`, `totalDueCents`,
  `invoiceNumber`, `parkedCarIds`.
- **Prepare:** `notifyParkingMonthEndFor` (1st) creates the run doc as
  `ready` (for switched-on businesses) and includes "N invoices ready"
  in the existing owner push.
- **Send:** `updateBusinessParkingEntry` actions
  `invoices_preview {businessId, monthKey?}` → `{monthKey, run, recipients:
  [{phone, name, cars:[{id,label}], totalDueCents, stillParked,
  alreadySent}]}` and `invoices_send {businessId, monthKey, phones?}` →
  `{sent, failed, skipped, remaining}` (owner/admin; refusals
  `invoices_owner_only`, `parking_whatsapp_off`, `invoice_month_invalid`
  — only the month just ended may be sent). Sequential, cap 300, stops at
  240 s with `remaining`.
- **Auto on the 3rd:** the hourly `sweepPackageRequests` (existing
  schedule) calls `autoSendParkingInvoices(now)`: on/after the 3rd (New
  York), for every switched-on business whose run for the month just
  ended is still `ready`, send it (`sentBy: "auto"`). Guard with a
  transaction on the run doc (`ready` → `sending`) so two sweeps never
  double-send; bounded per sweep.
- **Template** `parking_invoice_2lang` (Utility, `en`, DOCUMENT header =
  the invoice PDF via the signed `/d?view=receiptPdf`-style link — add a
  `view=invoicePdf` generated on the fly from the month statement or
  stored in Storage `parkingInvoices/{businessId}/{yyyy-mm}/{phoneDigits}.pdf`):
  body: 1 name · 2 business · 3 month (EN) · 4 balance due · 5 business ·
  6 month (FR) · 7 balance due · 8 payment instructions · 9 business phone;
  URL button `/t/{{1}}` = the customer's most recent parked car's code.
  No variable first/last, no codes to show, no app promotion. Submission
  script `~/laawol-deploy-logs/create_parking_invoice_template.py` (dry
  run by default; the main session runs `--apply`).
- **Payment instructions:** `updateBusinessParkingEntry {businessId,
  action: "set_payment_instructions", text}` (owner/admin; trimmed, ≤ 300,
  refusal `payment_instructions_invalid`).
- Rules: `parkingInvoiceRuns` read = `canManageBusiness`, write false;
  Storage `parkingInvoices/**` denied to clients.

## 3. Clients

- **Console:** Business settings → **Payment instructions** (textarea,
  owner/admin). Month end → **Send invoices** panel (only when the switch
  is on): run status (ready / sent on {date} by {name or "automatically"}),
  preview list (name, phone, cars, balance due, "still parked", already
  sent), select, Send; result counts. Each customer card shows its invoice
  message status. French for every string.
- **App:** the same panel on the month-end screen and the same settings
  field. Both ARBs.

## 4. Tests

Server: recipients fixture (owes / still parked & paid / left & paid →
no invoice / staff netted / voided car), PDF renders (INVOICE, rows,
balance, instructions), template body exact, run lifecycle (ready on the
1st, owner send, auto on the 3rd once, never twice), owner-only, switch
off, rules. Clients: panel wiring, settings field, French.
