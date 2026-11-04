# Box sizes, the box designer, and Pay now

Owner design interview 2026-11-03/04. Builds on
[PACKAGE_PRICE_LIST.md](PACKAGE_PRICE_LIST.md) (price lists, requests,
WhatsApp form). Where they disagree, this document wins. All money is whole
cents (USD); every displayed date is US style (month first, 12-hour clock).

## 1. Decisions

1. **Sea boxes are priced by size, not weight or contents.** Laawol sets the
   sizes for every business; a business only prices them.

   | id | EN / FR | everyday example | fits inside (inches) |
   | --- | --- | --- | --- |
   | `small` | Small / Petite | shoebox | 18 × 18 × 18 |
   | `medium` | Medium / Moyenne | microwave box | 24 × 18 × 18 |
   | `large` | Large / Grande | TV box | 30 × 24 × 24 |
   | `xl` | Extra large / Très grande | bigger than Large | always quoted |

   Typed inches pick the **smallest size the box fits in, turned any way,
   with 1 inch of slack per dimension** (sort both triples descending; fits
   when each box dimension <= limit + 1). Bigger than Large = `xl`, which the
   business always quotes. Sizes are **Sea only**; Air stays per pound / ask.
   Staff confirm the size at the counter (today's price).
2. **Box info from the customer:** a size (picture cards), optional exact
   inches, optional photos (up to 3).
3. **Pictures** of each size, drawn in one style with a sneaker for scale,
   on the app, the website and the WhatsApp form.
4. **Box designer (app + website):** a 3D box the customer resizes by
   dragging/typing inches, live next to a sneaker and a person for scale,
   spinnable; a badge shows "Medium · $35" or "Extra large · the business
   will quote". The business sees the same box (read-only) on the request.
   WhatsApp gets the pictures + optional inches + photos (no 3D there).
5. **Pay now** is an optional card link, sent once the **exact** price is
   known; **one** charge; always optional (cash/Zelle at the counter still
   work). **Card only; the business always absorbs the card fee** (no
   surcharge).
6. **Off by default.** The business owner (or an admin of the business) or a
   Laawol platform admin switches it on. It is the existing card switch
   (`cardBarrelBooking`) extended to every priced item - one switch.
7. **Business with Stripe connected** (Express account, payouts enabled):
   direct charge on its account, money goes straight to it.
   **Business without Stripe:** Laawol charges on its own Stripe account and
   pays the business weekly.
8. **Weekly payout** (platform charges only): week = Monday-Sunday,
   America/New_York; paid the following Monday. Laawol owes = collected -
   Stripe fees - refunds - chargebacks (+ dispute fees) - the business's
   unpaid Laawol bill. A Laawol admin sends the rest by Zelle / bank and taps
   **Paid out**; the business sees every line in Bills and gets a WhatsApp
   receipt. A negative week goes onto the business's Laawol bill.
9. **Refunds:** staff with the **void** permission (or the owner/admins)
   refund all or part, up to what was paid. The card is refunded at once.
   Platform charge: taken from the next payout (or onto the bill). Stripe
   keeps its fee; the business absorbs it. Customer gets a WhatsApp, the
   business a line in Bills.

## 2. Pure rules - box sizes

In `functions/package_price_list.js`, mirrored by
`admin_web/src/lib/package-price-list.ts` and
`my_flutter_app/lib/services/package_price_list.dart`; all three run the
shared fixture `functions/test/fixtures/package-price-list-cases.json`
(new `boxSizes` cases).

```
BOX_SIZES = [
  {id: "small",  maxIn: [18, 18, 18], en: "Small",  fr: "Petite",
   exampleEn: "About a shoebox",      exampleFr: "Environ une boîte à chaussures"},
  {id: "medium", maxIn: [24, 18, 18], en: "Medium", fr: "Moyenne",
   exampleEn: "About a microwave box", exampleFr: "Environ un carton de micro-ondes"},
  {id: "large",  maxIn: [30, 24, 24], en: "Large",  fr: "Grande",
   exampleEn: "About a TV box",        exampleFr: "Environ un carton de télé"},
  {id: "xl",     maxIn: null,         en: "Extra large", fr: "Très grande",
   exampleEn: "Bigger than Large",     exampleFr: "Plus grande que Grande"},
]
BOX_SLACK_IN = 1
BOX_DIM_MAX_IN = 120          // a typed dimension is 1..120, rounded to a tenth
boxSizeFor({l, w, h}) -> "small" | "medium" | "large" | "xl" | null (invalid)
cleanDims(raw) -> {l, w, h} | null
```

Route (sea only) gains `boxPricesCents: {small?, medium?, large?}` (each
1..LIMIT cents; `xl` is never priced). `validateRoute` refuses
`boxPricesCents` on an air route with `box_sizes_sea_only`, and a bad value
with `box_price_invalid`.

A box piece: `{kind: "box", boxSize, dimsIn?: {l, w, h}, quantity,
photoPaths?}`. When `dimsIn` is present it wins: `boxSize =
boxSizeFor(dimsIn)`. `pricePiece` on a sea route with a price for that size
-> `price = {source: "box_size", boxSize, label: "Medium box", quantity,
unitCents}`; `xl` or no price -> unpriced (the business quotes it). Air ->
unchanged rules (a box is "ask" there). `PublicRoute` gains
`boxPricesCents`. The compare totals count priced boxes.

Request piece adds `boxSize`, `dimsIn` (stored), and `price.boxSize`.
`getPackageRequestByToken` returns them per piece.

## 3. Pay now

### Settings

`businesses/{id}.packageRequestSettings.payNow: bool` (default false).
`requestSettingsOf` reads `payNow ?? cardBarrelBooking`; a save writes both
to the same value. Saved through `setPackageRequestSettings` (owner / admin
of the business, or a platform admin). Settings response adds
`payNow`, `payNowChargeType: "direct" | "platform"` (what a charge would be
today) and `stripeConnected: bool`.

### When a link exists

Pure `payNowState(request, settings)` -> `{payable, amountCents, reason}`.
Payable when: `payNow` on, request open (`confirmed` or `received` not
closed), `estimate.totalCents > 0`, and the total is **exact**: no unpriced
piece, no per-pound piece still waiting for the counter scale, pickup fee
known. Checked when a request is confirmed (form or estimate accepted),
re-priced, or received.

On first payable: create `request.payNow` and send WhatsApp template
`package_pay_now_2lang` (submitted 2026-11-04, id 1150742010940875) to the
sender: `{{1}}` name, `{{2}}` business, `{{3}}` amount EN ("$130.00"),
`{{4}}` business, `{{5}}` amount FR ("130,00 $"), `{{6}}` request code;
button URL `https://laawoldigital.com/p?t={{1}}` with the pay token.
Until the template is approved, fall back to an interactive `cta_url`
message when inside the 24-hour window; else only the request page shows it.
Amount changes while unpaid -> amount updated, one new message. Paid and the
total goes up -> the difference is paid in person ("Balance due at the
counter"). Paid and the total goes down -> staff are prompted to refund the
difference.

### `packageRequests/{id}.payNow` (server writes only)

```
{status: "open" | "paid" | "partly_refunded" | "refunded" | "cancelled",
 token, linkUrl, amountCents,
 chargeType: "direct" | "platform", connectedAccountId,
 checkoutSessionId, paymentIntentId, chargeId, mintCount,
 paidAtMs, paidCents, stripeFeeCents, refundedCents,
 refunds: [{atMs, amountCents, byUid, byName, reason, refundId}],
 messages: [{atMs, amountCents, channel: "template" | "session", ok}],
 createdAtMs, updatedAtMs}
```

A request that closes unpaid (cancelled/expired/declined) -> `cancelled`.
`getPackageRequestByToken` adds `payNow: {status, amountCents, linkUrl,
paidCents, refundedCents} | null`. The request page shows an optional
**Pay now $X** button, or "Paid online $X".

### The link

`https://laawoldigital.com/p?t=<token>` - the existing durable link
(`parkingPaymentLink`, the `/p` rewrite) gains a third resolver for package
pay tokens: paid -> "Already paid"; cancelled -> "Link cancelled"; else a
fresh Stripe Checkout Session (product "<Business> shipment R-XXXXX",
metadata `paymentType: "package_request_pay"`, `requestId`, `businessId`,
`code`), on the connected account for `direct`. No application fee.

### Webhook

The existing Stripe webhook (`stripeCheckoutWebhook` /
`handleBusinessProStripeWebhook`) routes `package_request_pay`:
paid -> `payNow.status = "paid"`, `paidCents`, ids, `stripeFeeCents` (from
the balance transaction), history `paid_online`, staff push "Paid online".
Platform charges also write ledger rows. `charge.dispute.created` on a
platform charge -> ledger `chargeback` (-amount) and `dispute_fee` (-1500).

At **Received**, the line records the online payment (method `card_online`,
amount = paid - refunded) so the counter does not charge again.

### Staff actions (on `setPackageRequestSettings`, no new exports)

- `{action: "pay_refund", businessId, requestId, amountCents, reason}` - void
  permission or owner/admin. Reasons: `pay_not_paid`, `refund_too_much`,
  `refund_invalid`, `not_allowed`. Returns `{success, payNow}`.
- `{action: "pay_resend", businessId, requestId}` -> `{success, payNow}`.

### Ledger and weekly payouts (platform charges only)

`payNowLedger/{id}`: `{businessId, requestId, requestCode, type:
"payment" | "stripe_fee" | "refund" | "chargeback" | "dispute_fee" |
"bill_offset" | "payout" | "to_bill", amountCents (signed: + = Laawol owes
the business), weekKey ("YYYY-MM-DD", the Monday, America/New_York), atMs,
byUid, byName, note}`.

`payNowPayouts/{businessId}_{weekKey}`: `{businessId, businessName, weekKey,
collectedCents, feesCents, refundsCents, chargebacksCents, billOffsetCents,
netCents, status: "open" | "due" | "paid" | "nothing", paidAtMs, paidByUid,
paidByName, method: "zelle" | "bank" | "other", reference, receiptSent}`.

Actions on `setPackageRequestSettings`:
- `{action: "payouts", businessId?}` - platform admin (all businesses when
  no id) or the business's owner/admins (its own) -> `{weeks: [...],
  unpaidBillCents}` with each week's ledger lines.
- `{action: "payout_paid", businessId, weekKey, method, reference}` - platform
  admin only. Takes the unpaid Laawol bill out (recorded as a bill payment,
  method `pay_now_offset`), records `payout`, marks the week `paid`, sends
  `pay_now_payout_2lang` (submitted 2026-11-04, id 1100918009395447) to the
  owner: `{{1}}` name, `{{2}}` amount EN, `{{3}}` week EN ("Nov 2, 2026"),
  `{{4}}` amount FR, `{{5}}` week FR ("2 nov. 2026"), `{{6}}` method. A
  negative week -> a `to_bill` row and a charge on the Laawol bill.

## 4. Screens

**Pictures:** `admin_web/public/box-sizes/{small,medium,large,xl}.svg` (+
`.png`), `my_flutter_app/assets/box_sizes/{small,medium,large,xl}.png`,
`functions/box_size_images.js` (base64 PNGs for the WhatsApp form).

**Box designer** (web: CSS 3D transforms, no new dependency; app: Flutter
`Transform` / `CustomPainter`): length / width / height by slider + number
(1-60 in on the slider, typed up to 120); drag to spin (clamped tilt);
cardboard box with a tape stripe; a sneaker (12 × 4.5 × 5 in) beside it and
a 5 ft 6 in person behind for scale; a 1-ft floor grid; badge = size + price
for the chosen business (or "from $X" while comparing) or "Extra large ·
the business will quote". Read-only mode (still spinnable) for staff.
Respects reduced motion. Every string in English and French.

**Customer (app + website), Sea:** a box line = size picture cards (Small /
Medium / Large / Extra large) + quantity, "Know the inches?" opens the
designer (the size follows the inches), optional photos (up to 3). Request
page: optional **Pay now**.

**Business (console + app):**
- Shipping > Price list, Sea: "Box sizes" (pictures + 3 prices; "Extra large:
  you quote it").
- Request settings: **Pay now** switch ("Customers get an optional link to
  pay by card once the price is final. You pay the card fee (2.9% + 30¢).
  Without Stripe, Laawol collects and pays you every Monday.").
- Request detail: box size, inches, the read-only 3D box, photos; Pay now
  chip (Link sent / Paid online $X / Refunded $Y), Resend link, Refund.
- Bills: **Laawol owes you** (weeks, lines). Laawol admin Bills: **Pay now
  payouts** due per business with **Paid out** (method + reference).

**WhatsApp form (new Flow version):** Sea items offer "Small box",
"Medium box", "Large box", "Extra large box" with their pictures; a box
screen asks optional inches per chosen size ("20 x 16 x 14") and optional
photos (PhotoPicker, up to 3; decrypted on the endpoint and stored like the
web's request photos).
