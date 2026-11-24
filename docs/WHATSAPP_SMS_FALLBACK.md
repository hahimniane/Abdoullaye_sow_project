# A text when WhatsApp fails

Owner, 2026-11-23: "sending the text to WhatsApp, immediately if the
WhatsApp fails we should send the text through Twilio." He chose scope **a**:
messages to the **sender**, **US numbers only**. Receivers stay WhatsApp-only.

Builds on the package messages (`containerUpdates` rows, sent by
`deliverContainerCustomerUpdate`, delivery reports written by
`whatsappWebhook`: docs/WHATSAPP_CONTAINER_UPDATES.md) and on the receipt by
text (docs/PACKAGE_RECEIPT_SEND.md, `sendTwilioSms`, `smsConfigured`).

## Rule

A `containerUpdates` row gets ONE text, through Twilio, when all of these hold:

1. `role` is `sender`.
2. The row's phone is a US or Canada number (`+1` and ten digits).
3. Its `update` is `received`, `confirm`, `shipped`, `arrived`, `delivered`
   or `receipt`. (`confirm` cannot ask for a reply by text: it is texted as
   `received`.) A row with `channel: "sms"` is already a text: never.
4. WhatsApp failed for good, one of:
   - the send was refused and the row's status is `failed` (not
     `waiting_for_template`, not a try that will be retried);
   - Meta's delivery report says `failed` (`deliveryStatus: "failed"`), any
     error code (131026 "not on WhatsApp" is the usual one).
5. Texting is on: Twilio is really configured (`smsConfigured`) AND the
   deploy-time switch `SMS_FALLBACK` is `on` (functions `.env`, default off:
   the code ships dark until Twilio approves the number).
6. The business has not switched it off:
   `businesses/{id}.packageTextFallback !== false` (missing = on).
7. The row has no text yet (`smsFallback` unset). One text per row, ever:
   a later "Send again" on WhatsApp does not text again.

The text is sent at once, in the same function run that learns of the
failure. Nothing waits for a person.

## The texts

Short, English then French, the business's name first, the tracking link,
and how to stop. One segment where possible (GSM characters: no accents in
the French half, no emoji). `{biz}` the business name (40 chars max),
`{code}` the tracking code, `{link}` =
`https://customer.laawoldigital.com/t/{code}`.

- received / confirm:
  `{biz}: we received your package {code} / colis recu. Track: {link} Reply STOP to opt out, HELP for help.`
- shipped:
  `{biz}: your package {code} has left / colis parti. Track: {link} Reply STOP to opt out, HELP for help.`
- arrived:
  `{biz}: your package {code} is ready for pickup / pret a recuperer. Track: {link} Reply STOP to opt out, HELP for help.`
- delivered:
  `{biz}: your package {code} was delivered / colis remis. Track: {link} Reply STOP to opt out, HELP for help.`
- receipt: the existing `receiptSmsBody` (the receipt's own link).

## What is recorded

On the row (`containerUpdates/{id}`), in the same write that follows the
attempt:

`smsFallback: {status: "sent" | "failed" | "skipped", reason, twilioSid,
atMs}`. `reason` for `skipped`/`failed`: `not_us_number`, `not_configured`,
`switched_off`, `business_off`, `opted_out` (Twilio error 21610), `twilio_error`.
A `skipped` for `not_configured` / `switched_off` is NOT written (so the text
can still go once texting is on and the row fails again); the others are.

On the line's `lastCustomerUpdate` result for that role: `sms: "sent"` (or
`"failed"`), so the lists can say "Sent by text" instead of only
"failed to send". The WhatsApp failure itself stays recorded as it is.

## Where

- Pure rules in `functions/sms_fallback.js` (which rows qualify, the bodies,
  the US-number test, the record), with `test/sms-fallback.test.js`.
- `deliverContainerCustomerUpdate`: after a terminal WhatsApp failure.
- `whatsappWebhook`: when a delivery report marks a package row failed.
- Both functions take the three Twilio secrets.
- `sendTwilioSms` stays the one sender.

## Screens (console, then app)

Where a package shows "Customer: failed to send · {reason}" it also shows,
when the row was texted, **"Sent by text"** / **"Envoyé par texto"** (a
failed text: "The text could not be sent either" / "Le texto n'a pas pu être
envoyé non plus"). "Send again" stays. A business switch
"Text customers when WhatsApp fails" in Request settings (owner), on by
default.

## Consent

The counter question and the public page say it: "We'll message you on
WhatsApp, or by text if you don't have WhatsApp." The Twilio toll-free
registration has to describe these texts before the switch goes on.

## As built (2026-11-23, not deployed, switched off)

- `functions/sms_fallback.js` (rules, bodies, record) and one helper in
  `index.js`, `textAfterWhatsAppFailure`, called from
  `deliverContainerCustomerUpdate` (a terminal refusal, and the give-up after
  repeated failures) and from `recordWhatsAppUpdateDelivery` (Meta's `failed`
  report, via `whatsappWebhook`). Both functions list the Twilio secrets.
- While `SMS_FALLBACK` is not `on`, or Twilio is not configured, the helper
  returns at once: no read, no write, nothing recorded.
- One text per row: a transaction claims the row (`smsFallback.status:
  "sending"`) before anything is sent; a run that dies after the claim never
  sends a second text (the row then needs a manual clear).
- Extra recorded reason: `receipt_unavailable` (the receipt's PDF could not
  be made). The business name in a text is 40 characters without accents.
- Console: "Sent by text" / "The text could not be sent either" next to the
  failed WhatsApp mark (`package-staff.ts` `sms`, `line-update-failures.tsx`).
- Not built yet: the per-business switch in Request settings (the server
  already honours `packageTextFallback === false`), the app's mark, and the
  new counter wording / public page / Twilio registration text (see the
  order of steps in the owner's notes: the registration can only be changed
  after Twilio's first decision).
