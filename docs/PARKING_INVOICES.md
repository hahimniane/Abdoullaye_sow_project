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

## 5. As built (server, `invoices/server`)

Where the build chose within the contract:

- **PDF link:** the PDF is rendered when the message is sent and **stored**
  in Storage `parkingInvoices/{businessId}/{yyyy-mm}/{phoneDigits}.pdf`
  (server only; storage rules deny clients). What the customer was sent is
  what the link shows, whenever it is opened. The WhatsApp header link is
  `whatsappPhotoBase()` + `?view=invoicePdf&t={runToken}&p={phoneDigits}&e=
  {expiresMs}&s={sig}`, 30 days, signed by `package_proof.invoiceLink`
  (`photoSignature` over `invoice:{phoneDigits}`, so a receipt's or photo's
  signature never opens an invoice). The secret `t` is the run's own
  `documentToken` (minted with the run), not a car's, so a customer with only
  an activity (no car) is covered and a later-voided car cannot kill the link.
- **Run doc** adds `documentToken`, `remaining`, `sendingAtMs`, `sendingBy`.
  A send takes the run in a transaction (`ready`, or the owner's `sent`, ->
  `sending`); a claim older than 10 minutes is a send that died and is taken
  over. After the loop the run is `sent`, or back to `ready` when a call's
  limit left customers over and nobody picked who (the automatic send
  continues them); an owner who picked customers (`phones`) closes the run:
  whoever was left out is not sent by itself.
- **Rows** are claimed in a transaction (not `.create()`) so a `failed`,
  `stopped` or `skipped` invoice is tried again when the owner presses Send
  again; one already `sent`, or `queued` within 10 minutes, is never sent
  twice. Extra fields: `invoiceNumber`, `totalDueCents`, `monthKey`,
  `parkedCarIds`, `pdfPath`, `sentByUid` (uid or `auto`).
- **Invoice number** `INV-{YYYYMM}-{last 4 of the phone}-{n}`: `n` tells apart
  customers of the month whose numbers end in the same four digits (phone
  order, over every customer of the month), so it never moves when others pay.
- **Actions** (all on `updateBusinessParkingEntry`, no new export):
  `invoices_preview {businessId, monthKey?}` -> `{success, monthKey, run,
  recipients: [{phone, name, cars: [{id, label}], totalDueCents,
  stillParked, alreadySent, invoiceNumber, messageStatus}], skipped: [{phone,
  name, reason, totalDueCents, cars}], totalDueCents}`; `invoices_send
  {businessId, monthKey, phones?}` -> `{success, monthKey, sent, failed,
  stopped, alreadySent, skipped, remaining}`; `set_payment_instructions
  {businessId, text}` -> `{success, paymentInstructions}` (empty clears; needs
  no switch). Refusals (reason): `invoices_owner_only` (permission-denied),
  `parking_whatsapp_off`, `invoice_month_invalid`, `invoices_sending`
  (failed-precondition), `payment_instructions_invalid` (invalid-argument).
  "The month just ended" is New York's calendar, not UTC's.
- **The 1st** (`notifyParkingMonthEndFor`) reads the month through
  `parkingMonthEndData` (the same four narrow queries); a lot with the switch
  on gets a `ready` run when anybody is to be invoiced, and its owner's push
  adds "October's invoices are ready: N customers, $X. Review and send." (staff
  keep the old text; with nobody owing but invoices ready, only the owner is
  told). Invoices are never worked out from bills whose staff expenses could
  not be read (the push still falls back; the preview/send refuse by error).
- **Not covered by an invoice:** a customer whose number has no country code
  (or no number at all) is listed under `skipped`; no row is made.

## 6. Team members get a statement (owner decision, 2026-11-04)

A **team member** - a staff member or owner whose own cars are team cars
(month-end customer key `staff:{uid}`, docs/PARKING_TEAM_CARS.md) and/or who
is linked to ONE parking customer (`staffParkingLinks`,
docs/STAFF_EXPENSE_CREDIT.md) - is not invoiced like a customer. They get ONE
**statement** a month, and Month end's card shows the SAME numbers:

```
  Parking + lot jobs of the month (plus anything unpaid from before)
- expenses they paid that are not yet credited (cumulative to the month's
  end: a Sep 6 expense counts in October until it is credited)
+ cash they hold for the business at the END of the month
= Owes the business   (negative: The business owes them)
```

Example (Alhoussaine, October 2026): $1,226 - $35 + $36 = **$1,227**. Month
end used to say $1,191 (no cash line) and now says $1,227, like the WhatsApp
statement. A customer is unchanged: their monthly invoice stays as it was.
It is Staff balances' net (`held + parking due - expenses owed`) told as of a
month's last moment, because the bill and the credit are both cumulative.

**Definitions.**

- *Parking and jobs* = the member's bills' `dueBeforeExpensesCents`, summed:
  their `staff:{uid}` bill and the one customer linked to them (a customer
  linked to TWO members stays a customer). Several bills -> one statement;
  the first (own cars first) carries it and the others read "Included in the
  statement of {name}".
- *Expenses* = the member's whole credit (`staffCredits`: their non-voided
  expenses up to the month, standing payers included, less what was paid
  back), not the part that fits their bill - so a credit bigger than the bill
  makes the business owe them. The lines are this month's; the rest is
  "Expenses from earlier months".
- *Cash held* = what they collected (the kinds of money the business counts,
  Staff balances' "What counts") up to **the last millisecond of the month in
  New York**, less the handovers they gave and plus those they received that
  were **confirmed** by then. A payment or a handover dated after the month
  ended changes nothing. A payment with no date counts as old; a car marked
  paid counts from `directPaymentReceivedAt` (never `updatedAt`).
- Gets a statement when `owes > 0` **or** a car is still parked (the
  customers' rule); someone the business owes with no car parked gets none.

**Server.** Pure `staff_statement.js` (`monthEndMs`, `staffHeldAsOf`,
`staffStatements`; shared fixture `test/fixtures/staff-statement-cases.json`,
mirrored by `admin_web/src/lib/staff-statement.ts` and the app's
`staff_statement.dart`). `invoiceRecipients` returns recipients with `kind:
"invoice" | "statement"`; a statement's number is
`ST-{YYYYMM}-{last 4 of the phone}-{n}`. Their phone is the profile's
(`users/{uid}.phone`), else the linked customer's; with none (or without a
country code, or the same number as another recipient) they are listed under
`skipped` with the reason. `staffStatementModel` (parking_invoice_pdf.js)
draws "STATEMENT / RELEVÉ" in the invoice's design. The same template is sent
(`parkingInvoiceTemplate`) with the month and `due` = what they owe (0 when
the business owes them). `invoices_preview` marks each row `kind`; the
message row gains `documentKind` and `staffId`. `parkingMonthEndData` nets
team cars even when the business has no links yet. New action on
`updateLotExpenseEntry`: `staff_statement_cash {businessId, monthKey}` ->
`{monthKey, asOfMs, held: {staffId: cents}}` (any member of the business),
refusal `statement_month_invalid`. The month-end push still counts what
customers owe after expenses (no cash).

**Console / app.** Month end loads the cash once the month's bills are in;
until it arrives (or if it fails) team members show as before, with a note.
The card shows "Owes the business $X" with "parking and jobs - expenses +
cash held", a "Cash held for the business" line, and the bill (PDF / text)
says "STATEMENT". Send invoices lists statements with a "Statement" badge.
