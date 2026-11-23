# Package receipt: Send receipt, automatic or by button

Owner, 2026-11-23. Builds on the package receipt PDF
(`functions/parking_receipt_pdf.js` `packageReceiptModel`, stored at
`packageReceipts/{businessId}/{lineId}.pdf`, served by `parkingDocument`
`view=packageReceiptPdf` with a signed link) and on the sender's
"package received" WhatsApp (`deliverContainerCustomerUpdate`).

## Decisions (owner)

1. The receipt goes to the **sender** only (it shows price, paid, balance).
   Never to the receiver.
2. The "we received your package" confirmation **always** goes out
   automatically, as today.
3. Each business chooses how the receipt goes:
   - `button` (default for every business, existing and new): staff press
     **Send receipt** on the package. Nothing goes on its own.
   - `auto`: the receipt goes with the confirmation, without a click.
   Only the business owner or a business admin can change it.
4. "Received by / Reçu par" is removed from the **package** receipt.
   (Parking payment receipts keep it: there it says who took the cash.)
5. Ways to send, WhatsApp first and the default:
   - **WhatsApp**: the approved template `shipment_received_doc_2lang`
     (document header = the receipt PDF).
   - **Text message (SMS)**: sent by the server through Twilio **only when
     Twilio is really set up** (it is not on 2026-11-23: the saved keys are
     placeholders). Until then the screen offers **Text from this phone**,
     which opens the staff's own Messages app with the text and the receipt
     link filled in.
   - **Email**: opens the staff's own mail app (`mailto:`) with the
     customer's address, a subject and the receipt link filled in. No
     server email (no email provider is installed on the live project).
   - **Show QR**: a QR code of the receipt link, for a customer at the
     counter to scan with the phone camera.
   - **Open / Print** (website) and **Share** (app): the PDF itself.
6. When WhatsApp says the number is not on WhatsApp (Meta error 131026,
   or any failed status), the screen says so and offers text / email / QR.

## Data

- `businesses/{id}.packageReceiptSettings.sendMode`: `"button"` | `"auto"`.
  Missing = `"button"`.
- A WhatsApp receipt is a `containerUpdates` row like the other package
  messages, with `update: "receipt"`, `role: "sender"`, the line's sender
  phone, so the existing send / retry / waiting-for-template / webhook
  status / "Send again" machinery applies. The row says who asked
  (`requestedByUid`) and why (`trigger: "button" | "auto"`).
- A text sent by the server is logged as a `containerUpdates` row with
  `channel: "sms"` (never picked up by the WhatsApp sender) or in its own
  log; the builder chooses, the console must be able to show "Sent by text
  at …".
- Every send re-renders the PDF from the line as it is now, so the receipt
  always shows the current paid amount and balance.

## API (server)

`updateContainerLine` (same callable, same permission as editing a line:
`requireBusinessPermission(uid, businessId, CONTAINER_SECTION)`):

- `{action: "receipt_link", businessId, lineId}` →
  `{success, link, filename, expiresAtMs, smsReady, sender: {name, phone,
  email}}`. Renders and stores the PDF, returns a signed link (30 days)
  that opens it in any browser. `smsReady` = Twilio really configured.
  Used for QR, Open/Print, Share, Text from this phone, Email.
- `{action: "receipt_send", businessId, lineId, channel: "whatsapp" | "sms"}`
  → `{success, channel, messageId}`. Refusals (HttpsError with
  `details.reason`, English message, both languages on the screens):
  - `receipt_no_sender_phone`: the package has no sender phone.
  - `receipt_sms_not_set_up`: texting is not set up yet.
  - `receipt_too_soon`: the same channel was used for this package less
    than 60 seconds ago (double tap).
  - `receipt_line_gone`: the package was removed / voided.
  - `receipt_whatsapp_off`: WhatsApp is not connected.

New callable `setPackageReceiptMode {businessId, sendMode}` →
`{success, sendMode}`; owner or business admin only (the same check other
business settings use); refused `invalid-argument` for any other value.

## Automatic mode

In `deliverContainerCustomerUpdate`, the sender's `received` row:
- `button` mode: never attaches the receipt (plain or photo template).
- `auto` mode: as today, the receipt rides on the confirmation when there
  is no drop-off photo. When the photo heads the confirmation, a separate
  `receipt` row is queued for the sender (`trigger: "auto"`), once per
  package (idempotent row id).

## Screens

Website (business console, wherever a package line shows its WhatsApp
messages / "Send again") and phone app (package details): a **Send
receipt** button opening a choice: WhatsApp (default, first), Text message,
Email, Show QR, Open/Print (web) or Share (app). The last receipt send and
its status are shown ("Receipt sent on WhatsApp Nov 23, 2:10 AM",
"Not on WhatsApp: send it by text or email"). Business settings:
"Package receipts: Send with the confirmation automatically / Staff press
Send receipt" (owner/admin only). English and French everywhere. US dates,
12-hour times.

## As built (server, 2026-11-23)

Decisions the builder made; the contract above is unchanged unless a line
says DEVIATION.

- **Pure logic** in `functions/package_receipt_send.js` (mode, refusals,
  one-minute guard, `smsConfigured`, SMS body, row fields).
- **Link base.** `receipt_link` returns the short human link
  `PARKING_DOCUMENT_BASE_URL || https://laawoldigital.com/d` (the /d
  endpoint 302s to `parkingDocument`, a browser follows it). Meta's own
  fetch (WhatsApp header) still uses the function URL. The signature covers
  token + line + expiry, not the host, so both open the same PDF.
- **Guard.** `lastReceiptSend.{whatsapp|sms}: {atMs, byUid}` on the
  `containerLines` doc, taken in the same transaction that writes the
  WhatsApp row (race-safe). A text that fails to send releases it.
- **WhatsApp row.** `containerUpdates/{autoId}`: `update: "receipt"`,
  `role: "sender"`, `trigger: "button"`, `requestedByUid`, `phone` (the
  sender's number, a US business's local number as +1), `name`,
  `trackingCode`, `status: "queued"`. The existing trigger sends it, and the
  webhook writes `deliveryStatus` / `deliveryError` / `deliveryErrorCode`
  (131026 = not on WhatsApp) on it like any row. The line's
  `lastCustomerUpdate` is never touched by it.
- **Text log.** A `containerUpdates` row too, with `channel: "sms"`,
  `update: "receipt"`, `trigger: "button"`, `requestedByUid`,
  `status: "sent" | "failed"`, `twilioSid`, `sentAt` (or `error`). The
  WhatsApp sender ignores any row with `channel: "sms"`. Screens show "Sent
  by text at ..." from the newest such row (`sentAt`).
- **Send again.** `updateContainerLine {action: "resend_update", lineId,
  update: "receipt"}` queues the newest WhatsApp receipt row again when it
  failed, was reported undeliverable, or went to a number since corrected;
  `{success, lineId, update: "receipt", queued, alreadySent}`. The plain
  `resend_update` (no `update`) is unchanged and is about the shipment news.
  Refusals as above (`receipt_no_sender_phone`; `receipt_line_gone` when
  there is no WhatsApp receipt row yet).
- **Extra refusals (additions):** `receipt_channel_invalid` (channel is
  neither `whatsapp` nor `sms`, `invalid-argument`) and `receipt_sms_failed`
  (Twilio refused or was unreachable, `unavailable`). Refusal codes:
  `receipt_line_gone` is `not-found`, the rest `failed-precondition`.
- **Order of refusals:** permission, channel, line gone, no sender phone,
  channel not ready (`receipt_sms_not_set_up` / `receipt_whatsapp_off`),
  too soon.
- **Mode callable** `setPackageReceiptMode`: owner or Laawol admin (the same
  check as `setPackageRequestSettings`); other values are refused
  `invalid-argument` with `details.reason: "invalid_send_mode"`. Writes
  `packageReceiptSettings: {sendMode, updatedByUid, updatedAt}`; read it
  from the business document (the console and app already read it).
- No History (audit) line is written for a receipt send.
