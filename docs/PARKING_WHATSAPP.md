# Parking customers on WhatsApp

Decided with the owner on 2026-10-29 (5 questions). The person a car is
parked under (`parkedCars.customerName` / `customerPhone`) hears from the
business on WhatsApp: once when the car is parked, and a receipt with a PDF
every time a payment is recorded. They can check what they owe at any time
on the car's Track page, which also offers the Laawol app.

## 1. Decisions

1. **Per-business switch, off by default:** `businesses/{id}.parkingWhatsApp`
   = `{enabled: bool, enabledAtMs, enabledByUid}`. Owner (or platform admin)
   only. Nothing is sent while it is off.
2. **Car parked → welcome** (Utility template `parking_parked_2lang`): car,
   parking date, daily rate, business name + phone, **Track** button
   (`https://customer.laawoldigital.com/t/{trackingCode}`). Only for cars
   created after the switch is on (the welcome goes when a NEW parkedCars
   doc appears, not when an old one is edited).
3. **Every payment → receipt** (Utility template `parking_receipt_2lang`)
   with the **receipt PDF attached** (document header): this payment, total
   paid so far, and the balance owed now or "Paid in full". Every payment
   type that appends to `parkedCars.parkingPayments` (cash, Zelle/other,
   part-payments, payment-link/Stripe payments). A reverted payment sends
   nothing; the next receipt shows corrected totals. One receipt per payment
   (idempotent by payment id).
4. **Current customers:** the owner previews and then sends a one-time
   welcome to everyone currently parked — **one message per phone number**
   listing that number's cars (template `parking_welcome_2lang`). Never
   automatic.
5. **App links live on the Track page**, not in the message (keeps the
   messages Utility). The parked-car Track page shows: daily rate, parked
   since, days so far, amount so far, paid, **balance owed right now** (or
   Paid in full), then "Get the Laawol app" (App Store + Google Play).
6. **Accounts** already exist: every parked-car phone gets a phone account
   automatically (docs/PHONE_ACCOUNTS.md); sign-in is by WhatsApp code.
7. Replies land in the business's WhatsApp conversations (Support), as with
   packages; STOP pauses templates (already enforced by
   `sendWhatsAppMessage`). Voided cars send nothing and track as not found.

## 2. Server (no new Cloud Function exports — 1000-CPU budget)

- **Triggering:** the existing `syncParkedCarOccupancy` (onDocumentWritten
  `parkedCars/{id}`) gains a guarded, best-effort step after its current
  work: (a) doc created (`before` missing) and business switch on → queue a
  `parked` message; (b) `parkingPayments` grew (new payment ids in `after`
  not in `before`, not reverted) and switch on → queue one `receipt` per new
  payment. Never throws (a messaging failure must not break occupancy).
- **Queue / idempotency:** `parkingMessages/{carId}_parked`,
  `parkingMessages/{carId}_pay_{paymentId}`, `parkingMessages/welcome_{businessId}_{phoneDigits}`
  created with `.create()` (a duplicate trigger delivery is a no-op);
  fields `{businessId, parkedCarId, kind: parked|receipt|welcome, phone,
  paymentId?, status: queued|sent|failed|stopped|skipped, wamid, error,
  attempts, createdAt, sentAt}`. Send inline right after creating the row
  (same trigger), record `whatsappMessageId` (wamid) like `containerUpdates`
  so delivery ticks and replies can be matched. Server-write only (rules:
  read by `canManageBusiness`, write false). A failed send stays `failed`
  (visible on the car); no retry loop in v1.
- **Contacts:** every send calls the WhatsApp contact recorder (as container
  updates do: `whatsappContacts/{e164}.businesses[businessId]`, with the car's
  tracking code) so the customer's reply routes to this business.
- **Receipt PDF design (2026-10-30):** the PDF is drawn to look exactly like
  the printable parking document (`parking_document.js`, `/d`): logo + name +
  address/contact left, "RECEIPT / REÇU" in teal + `REC-{trackingCode}-{n}`
  right, teal rule, PAID / PARTLY PAID pill, label/value rows with hairlines,
  shaded "AMOUNT PAID" box (total paid so far, balance owed or paid in full),
  footer. Colours come from `COLORS` in `parking_document.js`; the logo is
  fetched with a 3 s timeout and falls back to the business initial.
- **Receipt PDF:** a pure renderer `parking_receipt_pdf.js` (add `pdfkit` to
  functions dependencies) → bytes for one payment: business name/logo text,
  "RECEIPT", receipt number (`{trackingCode}-{n}`), date (US, month-first),
  customer, car (year make model, VIN), this payment (amount, method,
  received by name if any), total paid, balance or PAID IN FULL, footer
  "Issued through Laawol Digital · laawoldigital.com". English only in v1 is
  NOT acceptable — bilingual labels ("Receipt / Reçu") like the WhatsApp
  templates. Saved to Storage `parkingReceipts/{businessId}/{carId}/{paymentId}.pdf`
  (server-only path; storage rules deny clients). Served by the existing
  `/d` endpoint (`parkingDocument`) new view `receiptPdf`: `?view=receiptPdf&t={car.documentToken}&p={paymentId}&e={expiresMs}&s={sig}`
  signed exactly like `package_proof.photoLink` (reuse/generalise
  `photoSignature`), 30-day expiry, `Content-Type: application/pdf`,
  `Content-Disposition: inline; filename="Receipt {trackingCode} {Mon D}.pdf"`.
  The WhatsApp header link points **straight at the function URL**
  (`whatsappPhotoBase()` — laawoldigital.com/d 302-redirects and Meta may not
  follow). Mint `documentToken` on the car if missing (same first-write-wins
  pattern as `ensureLineDocumentToken`).
- **Money on the car:** balance = what the car has run up to today
  (open stay: days × daily rate, the same accrual as the month-end
  statement `accruedThroughCents`; closed: its total) minus non-reverted
  payments. Put this in ONE pure helper (`parkingBalanceNow(car, now)` in
  `business_parking_entry.js` or `parking_month_statement.js`), unit-tested,
  and mirror it in the console and app (parity fixture
  `test/fixtures/parking-balance-cases.json`, run by all three).
- **Track page:** `lookupGuestTracking` / `guest_tracking.js` for `service:
  "parking"` returns `parking: {dailyRateCents, sinceDayKey, leftDayKey,
  days, accruedCents, paidCents, balanceCents, paidInFull, stillParked}`
  from `parkingBalanceNow` (anyone with the code sees it, like container
  payments today).
- **Bulk welcome:** `updateBusinessParkingEntry` with `{businessId, action:
  "welcome_preview"}` → `{recipients: [{phone, name, cars: [{id, label,
  trackingCode}], alreadyWelcomed}]}` (non-voided cars of the business that
  are still parked, grouped by E.164 phone; skip numbers already sent a
  `parked` or `welcome` row) and `{action: "welcome_send", phones?: [...]}`
  → sends `parking_welcome_2lang` per phone (Track button = that number's
  most recently parked car), writes the `welcome_…` rows, returns counts.
  Owner/admin only (`welcome_owner_only`); refuses when the switch is off
  (`parking_whatsapp_off`). Throttle: sequential sends, cap 300 per call.
- **Switch:** `updateBusinessParkingEntry` `{businessId, action:
  "set_parking_whatsapp", enabled}` (owner/admin) writes
  `parkingWhatsApp`.
- **Templates** (`whatsapp_templates.js`, bilingual `en`, Utility):
  - `parking_parked_2lang` body: 1 name · 2 business · 3 car (EN) · 4 date
    (EN) · 5 rate (EN, "$12.00 a day") · 6 business · 7 car (FR) · 8 date
    (FR) · 9 rate (FR, "12,00 $ par jour") · 10 business phone · 11 tracking
    code; URL button `/t/{{1}}` (tracking code).
  - `parking_receipt_2lang` header DOCUMENT (link + filename); body: 1 name ·
    2 business · 3 amount · 4 car (EN) · 5 total paid · 6 balance line (EN:
    "Balance owed: $X" or "Paid in full") · 7 business · 8 amount · 9 car
    (FR) · 10 total paid · 11 balance line (FR) · 12 tracking code; URL
    button `/t/{{1}}`.
  - `parking_welcome_2lang` body: 1 name · 2 business · 3 cars list (EN,
    "2014 Toyota Corolla, 2016 RAV4 and 3 more") · 4 business · 5 cars (FR) ·
    6 business phone; URL button `/t/{{1}}`.
  - Bodies must not start or end with a variable, never contain a code to
    show, never promote the app (Meta rejected both kinds on 2026-10-29).
    Submission script: `~/laawol-deploy-logs/create_parking_templates.py`
    (dry run by default; the main session runs `--apply`).
- Refusals: `parking_whatsapp_off`, `welcome_owner_only`,
  `parking_whatsapp_owner_only`.

## 3. Clients

- **Console:** Business settings (where parking settings live — find it):
  the switch with a one-line explanation. Parking panel: "Send welcome to
  current customers" (only when the switch is on) → preview list (phone,
  name, cars, already welcomed) → Send. Each parked car's details show its
  WhatsApp messages (parked / receipts) with status ticks. Track page
  (`guest-tracking.tsx` / `lib/guest-tracking.ts`): the parking money block
  and the "Get the Laawol app" block (App Store + Google Play links from the
  existing app links config — find them; if none exist, add one constant
  with both store URLs). French for every string.
- **App:** the same switch in business settings, the welcome preview/send
  in the parking screen, message status on the car's details, and the
  guest-tracking widget shows the parking money block (the app's own
  guest-tracking view — find it). ARB keys in both languages.

## 4. Tests

Server: parkingBalanceNow fixture; template bodies (exact components incl.
document header); receipt PDF renders (non-empty, starts with `%PDF`, has
the amounts); trigger: no send when switch off, parked once on create,
receipt once per new payment, nothing on revert / voided car / edit;
`/d` receiptPdf link valid/expired/bad sig; welcome preview grouping +
send + owner-only + switch-off. Console + app: parity fixture, Track page
block, switch, welcome flow, French.
