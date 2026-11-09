# Parking: "car left" on WhatsApp, Send on WhatsApp, fix the number

Decided by the owner on 11/9/2026. This builds on `docs/PARKING_WHATSAPP.md`,
which is already live: a "parked" message, a receipt with every payment, and
monthly invoices. Read that doc first; everything here follows its rules
unless this doc says otherwise. The same business switch applies
(`businesses.parkingWhatsApp.enabled`), and so does the same "who is
messaged" rule (`carIsMessageable`). Team members' own cars (`forStaffId`)
are never messaged, by owner decision.

## 1. Car left → invoice or receipt (automatic)

When staff mark a parked car as left, the customer gets one WhatsApp message
with a PDF. "Marked as left" means the write sets `parkingEndDate`, or changes
it to a different day, and that end day is today or earlier (by
`parkingBalanceNow`'s day numbers). An end date in the future sends nothing
now; staff use the button (§2) once the car has actually left.

- **Template `parking_left_2lang`** (Utility, document header = the PDF).
  The body, in English then French, has these variables:
  1. name
  2. business
  3. car EN
  4. left-on date EN (US: "Nov 9, 2026")
  5. days EN ("12 days" / "1 day")
  6. total EN
  7. paid EN
  8. closing line EN
  9. business
  10. car FR
  11. left-on date FR ("9 nov. 2026")
  12. days FR ("12 jours" / "1 jour")
  13. total FR
  14. paid FR
  15. closing line FR
  16. business phone
  - **Closing lines when a balance is owed:** EN "Balance due: $X. How to pay: <paymentInstructions>", FR "Solde à payer : X $. Comment payer : <paymentInstructions>". With no instructions, the "How to pay" part is left out.
  - **Closing lines when paid in full:** EN "Paid in full. Thank you!" / FR "Payé en totalité. Merci !"
  - The numbers come from `parkingBalanceNow(car, now)`: `days`, `accruedCents`, `paidCents`, `balanceCents`.
- **Proposed body text** (for submitting to Meta; keep it close to the existing parking templates' tone):
  > Hello {{1}}, your car at {{2}} has left.
  > 🚗 {{3}} · Left on {{4}} · {{5}}
  > Total: {{6}} · Paid: {{7}}
  > {{8}}
  >
  > Bonjour {{1}}, votre voiture chez {{9}} est sortie.
  > 🚗 {{10}} · Sortie le {{11}} · {{12}}
  > Total : {{13}} · Payé : {{14}}
  > {{15}}
  >
  > Questions: {{16}}
- **PDF:** a stay statement drawn like the existing receipt PDF (`parking_receipt_pdf.js`): same header, teal rule, pill, rows, amount box and footer. Reuse the renderer and add a model; don't fork it.
  - **Title:** "Invoice / Facture" while a balance is owed, else "Receipt / Reçu".
  - **Rows:** car, tracking code, parked on, left on, days, daily rate, total, paid, balance due.
  - **Balance owed:** add the payment instructions.
  - **Link:** served the same signed 30-day way as the receipt PDF (`/d?view=...`).
- **Row:** `parkingMessages/{carId}_left_{endDayKey}`. It's idempotent, so the same end day never sends twice, and a corrected end day sends once more.
- **Trigger:** the same `syncParkedCarOccupancy` step that already plans the parked message and receipts. Add `left` to `plannedMessages`. Don't add a new exported function: the CPU quota is near its limit.
- `switchAllows(business, eventMs)` applies as it does today.

## 2. "Send on WhatsApp" button (staff, any time)

A new action on the existing parking callable: `updateBusinessParkingEntry`
with `{action: "send_whatsapp", businessId, carId}`.

- **Who can use it:** any staff with the `parking` permission, not only the owner.
- **Refused when:**
  - the switch is off: `parking_whatsapp_off`, with the existing message;
  - the car isn't messageable: `car_not_messageable`, "This car's customer can't be messaged (a team member's car, a voided car, or an online booking).";
  - there's no usable number: `no_phone` / `needs_country_code`, with the messages already used elsewhere, or "Add the customer's WhatsApp number first." / "Add the country code to the number.";
  - more than 5 manual sends for this car today: `send_limit`, "This car's message was sent 5 times today. Try again tomorrow."
- **What it sends:**
  - while the car is on the lot: the existing `parking_parked_2lang` message (parked date, rate, Track button);
  - once it has left: the `parking_left_2lang` message with today's PDF.
- **Row:** `parkingMessages/{carId}_manual_{epochMs}`, with `manual: true` and `sentByUid`.
- **Answer:** `{success, kind: "parked"|"left", status: "sent"|"failed"|"stopped", error}`. A failure from Meta is not an exception: the console and app show it.

## 3. Fix the number → automatic resend

Staff can already edit a parked car's customer phone through
`updateBusinessParkingEntry` (check this; if the parking staff permission
can't change `customerPhone`, allow it). When `customerPhone` changes on a
messageable car, the switch is on, and the new number is reachable, the
trigger resends the car's current message to the new number:
- the left message if the car has left (§1);
- otherwise the parked message.

- **Row:** `parkingMessages/{carId}_phone_{newDigits}`, sent once per new number.
- Nothing is sent when the old number was empty and the car was just created. The parked message already covers that.

## 4. Showing it to staff (console + app)

On each parked car's detail view, when the business switch is on:
- **A "Send on WhatsApp" button** (FR "Envoyer sur WhatsApp") calling §2. It shows the result: EN "Sent on WhatsApp." / FR "Envoyé sur WhatsApp.", or the refusal or failure message.
- **A line with the last WhatsApp message for this car,** read from the `parkingMessages` rows for this `carId`. For example: EN "WhatsApp: sent Nov 9, 2026, 2:05 PM" or "WhatsApp: not delivered. Check the number."; FR "WhatsApp : envoyé le 9 nov. 2026 à 14 h 05" or "WhatsApp : non distribué. Vérifiez le numéro." If the security rules don't let staff read `parkingMessages`, return the last status from the callable's read path instead. Don't open the rules wide.
- **The customer's phone is editable** by parking staff. After saving a changed number: EN "Saved. The last message will be resent to the new number." / FR "Enregistré. Le dernier message sera renvoyé au nouveau numéro."
- Hide all of this for team members' cars and voided cars.

Every string is in English and French (console: `french-dom.ts`; app: both
ARB files). Dates are US style, month first, 12-hour.

## 5. Not in scope

- Package messages.
- Monthly invoices (unchanged).
- Customer-side screens.

## Appendix A. Meta template submission (`parking_left_2lang`)

Submitted 11/9/2026 (id 2248445102380316, PENDING) with
`~/laawol-deploy-logs/create_parking_left_template.py --apply` (dry run by
default, modelled on `create_parking_invoice_template.py`). The §1 "proposed
body" was adjusted to follow the live parking templates: it opens with
"Hello / Bonjour {{1}}" (the name is variable 1 once, as in the other
templates, so the 16 variables are all distinct), has `*ENGLISH*` and
`*FRANÇAIS*` blocks, and **ends on plain text** (Meta rejected bodies that
end on a variable). There is no button (§1 names none) and no footer (the
other parking templates have none).

```json
{
  "name": "parking_left_2lang",
  "language": "en",
  "category": "UTILITY",
  "components": [
    {"type": "HEADER", "format": "DOCUMENT",
     "example": {"header_handle": ["<uploaded sample PDF handle>"]}},
    {"type": "BODY",
     "text": "Hello / Bonjour {{1}} 👋\n\n*ENGLISH*\nYour car at {{2}} has left.\n🚗 {{3}} · Left on {{4}} · {{5}}\nTotal: {{6}} · Paid: {{7}}\n{{8}}\n\n—————\n*FRANÇAIS*\nVotre voiture chez {{9}} est sortie.\n🚗 {{10}} · Sortie le {{11}} · {{12}}\nTotal : {{13}} · Payé : {{14}}\n{{15}}\n\n📞 Questions / Des questions : {{16}}\n\nThank you / Merci.",
     "example": {"body_text": [[
       "Fatou", "Dala Parking", "2014 Toyota Corolla", "Nov 9, 2026",
       "12 days", "$120.00", "$20.00",
       "Balance due: $100.00. How to pay: Zelle 347-555-0100",
       "Dala Parking", "2014 Toyota Corolla", "9 nov. 2026", "12 jours",
       "120,00 $", "20,00 $",
       "Solde à payer : 100,00 $. Comment payer : Zelle 347-555-0100",
       "+1 347 555 0100"]]}}
  ]
}
```

Server side: `PARKING_TEMPLATE.LEFT` and its 16 variables in
`whatsapp_templates.js` (shape: document header, no button, file name
`Invoice.pdf` unless the message carries one).
