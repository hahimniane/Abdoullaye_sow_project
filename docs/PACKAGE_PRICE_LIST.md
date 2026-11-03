# Send a package: price lists, comparison, drop-off times

Owner design interview 2026-11-03 (12 decisions). Builds on
[PACKAGE_REQUESTS.md](PACKAGE_REQUESTS.md) (the request flow, statuses,
estimates, Received) and [AIR_PACKAGES.md](AIR_PACKAGES.md) (Sea/Air, proof).
Where this document and PACKAGE_REQUESTS.md disagree, this one wins.

Goal: a customer sees real prices, compares businesses, says when they will
bring it (or asks for a pickup with an instant fee), and sends - no card. The
old customer "Freight" flow folds into this one.

## 1. Decisions

1. **Compare.** The Laawol app, website and WhatsApp list every business that
   ships to the country, with the total for the customer's items. A
   business's own link / QR / WhatsApp QR shows only that business.
2. **Prices** per destination country, separately for **Sea** and **Air**:
   - a fixed price per item ("Phone $40"), optionally covering only up to
     `includedLb` pounds each; the extra pounds are charged at the item's
     category rate per pound (else the route's General rate; with neither,
     staff type the price) - only after the counter scale, customer present;
   - a price **per pound** per category ("Clothes $6/lb");
   - anything else is "Ask me": that piece waits for a staff estimate.
   Barrels keep the destination's barrel price (`barrelShippingPrice`).
   Categories are the shared list (General goods, Clothes and fabric, Food,
   Documents, Cosmetics and liquids, Electronics, Fragile items) so totals
   compare across businesses.
3. **Order** of the list: default **Best match** = every piece priced first,
   then fewest pieces left to quote, then lowest total, then rating, then
   name. The customer can sort by Lowest price / Highest rated / Soonest
   departure and filter Picks up / Pays back if lost / Has a rating.
4. **Found via.** Every request records `foundVia: "laawol" | "business"`
   (comparison vs the business's own link/QR/WhatsApp QR). Monthly volume
   counts both. No extra fee now.
5. **Next departure.** A weekly schedule per route (`departure {weekdays,
   everyWeeks, anchorDate}`); a container/flight's `plannedDepartureDate`
   wins; a planned date that passed while the shipment is still loading
   shows "Departure date not confirmed".
6. **Drop-off time.** A day + a 2-hour window inside the location's opening
   hours; no capacity limit. Staff see **Coming today**. WhatsApp reminder
   that morning; a missed day gets one "Still coming?" with a link to pick a
   new time.
7. **WhatsApp ordering** (a WhatsApp Flow on the Laawol number) launches
   together with the app and website, same prices and rules.
8. **Pickup fee** is instant from the business's pickup pricing (per NYC
   borough or by distance, Google Maps), with a day + 2-hour window.
9. **Weight** for per-pound items: size buttons fill in pounds (Small bag
   10 lb, Suitcase 50 lb, Big box 70 lb), editable; the total reads "about".
10. **Today's prices** apply at the counter. If a business raises a price
    that an open request uses, that request gets a new estimate version and
    the customer one WhatsApp with the new total (the existing estimate
    message; price up on a confirmed request -> back to waiting for their
    OK, as PACKAGE_REQUESTS.md §2 already says).
11. **Who fills price lists:** the owner (or an admin of the business), or a
    Laawol platform admin on its behalf; a list set by Laawol shows "Laawol
    set up your prices - please check them" until the business taps
    **Looks right**. History records every save.
12. **Freight folds in.** The customer Freight button goes away (app and
    website); new freight quote requests / bookings are refused with
    `freight_moved`; old freight records stay readable; nothing is deleted.
    The business's old freight pricing (pickup pricing, departure days,
    "pays back if lost") is reused by this flow.

No card is required anywhere in this flow; payment stays at drop-off or
pickup (cash, Zelle, later Tap to Pay).

## 2. Pure rules

`my_flutter_app/functions/package_price_list.js`, mirrored by
`admin_web/src/lib/package-price-list.ts` and
`my_flutter_app/lib/services/package_price_list.dart`. All three run the
shared fixture `functions/test/fixtures/package-price-list-cases.json`
(baskets, counter prices, departures, ranking, route validation).

- `validateRoute(raw)` / `validatePriceList({routes}, countryIds)`
- `routeOf(list, countryId, mode)`
- `pricePiece(route, piece, {barrelPriceCents})`,
  `priceBasket(route, pieces, {barrelPriceCents, pickupFeeCents})`
- `counterPriceCents(price, weighedLb)` - the price after the scale
- `nextScheduledDate(departure, todayKey)`, `nextDeparture({departure,
  planned, todayKey})`
- `rankOptions(options, sort)` with sorts `best | price | rating | soonest`
- `foundVia(value)`; `SIZE_PRESETS`; `CATEGORIES` (en + fr labels)

Money is whole cents; weight is pounds rounded to a tenth.

## 3. Data

### `packagePriceLists/{businessId}` (server writes only)

| field | type | notes |
| --- | --- | --- |
| `businessId` | string | |
| `routes` | `{[countryId]: {sea?: Route, air?: Route}}` | only priced modes are stored |
| `needsCheck` | bool | true after a Laawol admin saved it, until the business taps Looks right |
| `updatedAtMs`, `updatedByUid`, `updatedByName`, `updatedByLaawol` | | last save |
| `checkedAtMs`, `checkedByName` | | last Looks right |
| `history[]` | `{atMs, byUid, byName, byLaawol, action: "saved" \| "checked", countries: string[]}` | newest last, capped at 50 |
| `createdAt`, `updatedAt` | Timestamp | |

`Route = {items: [{id, categoryId, label, priceCents, includedLb}],
perLbCents: {[categoryId]: cents}, departure: {weekdays: ["mon".."sun"],
everyWeeks: 1..8, anchorDate: "YYYY-MM-DD" | ""} | null}`. Item ids are
`i_<slug of the name>`; a saved id is kept when the name changes so open
requests still find it.

Read by: the business's people with the containers section, platform
admins. Customers never read it directly (they get it through
`listPackageRequestOptions`).

### Containers

`plannedDepartureDate: "YYYY-MM-DD" | ""` on `containers/{id}`, set by
`createContainer` / `updateContainer` (`planned_departure_invalid` when not a
real day). A container counts as departed once `status` is `shipped` or
`arrived`.

### Request additions (`packageRequests/{id}`)

| field | type | notes |
| --- | --- | --- |
| `shipMode` | `sea` \| `air` | what the customer chose; carried onto the line at Received |
| `plannedWindow` | `{from: "HH:MM", to: "HH:MM"}` \| null | bring_in: the 2-hour window |
| `pickup.window` | also `"HH:MM-HH:MM"` | collect: a 2-hour window (old values morning/afternoon/evening still read) |
| `pickup.feeCents`, `pickup.quote` | int \| null, `{model, distanceMiles?, borough?}` | the instant fee at submit |
| `foundVia` | `laawol` \| `business` | decision 4 |
| `channel` | `web` \| `app` \| `whatsapp` | where it was sent from |
| `pieces[].price` | snapshot \| null | `{source: item\|per_lb\|barrel, itemId, label, categoryId, quantity, unitCents, includedLb, excessPerLbCents, perLbCents, weightLb}` |
| `pieces[].quantity`, `pieces[].weightLb`, `pieces[].sizePreset` | | as the customer sent them |
| `confirmedVia` | also `form` | every piece priced at submit: the customer agreed in the form |
| `reminders.dropoffTodayAt`, `reminders.stillComingAt` | | decision 6 |

A request from a newer client (it sends `channel`) whose pieces are all
priced (items, per pound, barrels) and whose pickup fee (collect) is known
is created **`confirmed`** with an automatic
estimate v1 (`auto: true`) and `confirmedVia: "form"`: it is Expected at
once. Otherwise it is created `new` with the priced pieces' `estimateCents`
prefilled; staff estimate the rest as today.

The line created at Received carries `shipMode`, `foundVia` and, per piece,
`price` (so the counter can show `counterPriceCents` from the weight).

### Monthly volume

Rollups gain `laawolLines` / `laawolPieces` (root customer lines whose
`foundVia == "laawol"`); the Volume and Bills views show "Found on Laawol"
next to the totals.

## 4. Callables (no new exports: CPU budget is 999/1000)

### `setPackageRequestSettings` gains actions

- `{action: "price_list", businessId, routes}`: owner/admin of the business
  or a platform admin. Validates with `validatePriceList` against the
  business's active destination countries; writes the doc and history; a
  platform admin's save sets `needsCheck: true` and notifies the owner.
  Then re-prices open requests that use the list (decision 10).
  Returns `{success, priceList}`.
- `{action: "price_list_checked", businessId}`: owner/admin; clears
  `needsCheck`.
- Reasons: the `PRICE_LIST_MESSAGES` codes.

### `listPackageRequestOptions`

Input gains `{mode?: "sea"|"air", countryId?}`. Each `Option` gains:
```
routes: {sea: PublicRoute | null, air: PublicRoute | null},
departures: {sea: Departure, air: Departure},   // nextDeparture()
rating: number | null, reviewCount: int,
coversLoss: bool,
pickupPricing: {model: "borough"|"distance"|"flat"|"", summary} | null,
shipsByAir: bool
```
`PublicRoute = {items, perLbCents}`. An option is offered for Air only when
it has an air route or `shipsByAir`.

`departures[mode] = {dateKey: "YYYY-MM-DD" | "", source: "planned" |
"schedule" | "unconfirmed" | "none", approximate}`. `pickupPricing =
{mode: "flat"|"distance"|"borough", flatFeeCents, baseFeeCents,
perMileCents, minimumFeeCents, maxPickupMiles, boroughPricesCents} | null`
(the business's `pickupPlan` for service `packages`, which inherits the
shared plan). `routes[mode] = {items, perLbCents} | null`.

Action `{action: "pickup_quote", address, businessIds: string[] (<= 20)}`
-> `{quotes: [{businessId, available, priced, feeCents, distanceMiles,
borough, reason}]}`: `priced: false` = the business picks up but has no
pickup plan (its staff set the fee); `available: false` with `reason`
(`collect_unavailable`, `pickup_out_of_area`, `pickup_out_of_range`,
`pickup_origin_missing`).

### `submitPackageRequest`

Input gains `shipMode`, `foundVia`, `channel`, `plannedWindow` (bring_in),
`pickup.window` as `"HH:MM-HH:MM"`, and per piece `priceItemId`,
`quantity`, `categoryId`, `weightLb`, `sizePreset`, `label`. The server
prices with today's list (`priceBasket`), quotes the pickup fee itself, and
creates `confirmed` (all priced) or `new`. Pieces from the list need no
`description` (it is "2 × Phone" / "Clothes and fabric · 50 lb"); their
`kind` defaults to `other`. Windows: 30 min to 2 h; bring_in inside that
day's hours; pickup between 07:00 and 21:00, sent as `pickup.window =
"HH:MM-HH:MM"`. New reasons: `ship_mode_invalid`, `air_unavailable`
(precondition), `window_invalid`, `quantity_invalid`, `weight_invalid`,
`category_invalid`, `channel_invalid`, `pickup_out_of_area`,
`pickup_out_of_range`, `pickup_origin_missing`. Received uses the
request's `shipMode` unless staff choose another.

### Request page (`/e/<token>`)

- `getPackageRequestByToken` adds `plannedWindow {from,to} | null`,
  `shipMode`, `pickup.feeCents`, and per piece `price {source, label,
  quantity, unitCents, includedLb, perLbCents, weightLb} | null`.
- `confirmPackageEstimate {token, action: "reschedule", plannedDate,
  plannedWindow: {from,to}}` -> `{success, plannedDate, plannedWindow}`:
  "Pick a new time" (bring_in, open requests). Reasons `request_closed`,
  `handoff_invalid`, `planned_date_invalid`, `planned_day_closed`,
  `window_invalid`. The day's reminders start over.

### Reminders

- `dropoff_today` (8 AM on `plannedDate`, only if confirmed before then)
  and `still_coming` (10 AM the day after) for a confirmed bring_in with a
  `plannedWindow`; both use the approved `package_dropoff_reminder_2lang`
  (`{{4}}` = "today, 2:00 PM–4:00 PM" for the morning one, the opening
  hours for Still coming; the button opens `/e/<token>` where the customer
  picks a new time). Requests without a window keep the old +3 days
  reminder.

### Freight

`createFreightQuoteRequest`, `selectFreightQuote`,
`createFreightShipmentPaymentIntent` refuse new work with
`failed-precondition` `freight_moved` ("Freight is now part of Send a
package."). Running shipments continue.

## 5. WhatsApp

- Keyword ("send a package", "envoyer un colis", "colis", "package", a
  business's `SEND <slug>`) on the Laawol number -> an interactive Flow
  message. Per-business QR = `wa.me/13475596214?text=SEND%20<slug>`.
- The Flow uses a data-exchange endpoint on the existing `whatsappWebhook`
  (branch before `parseWebhook`; RSA key secret `WHATSAPP_FLOW_PRIVATE_KEY`)
  for countries, comparison, prices and pickup quotes; completion
  (`nfm_reply`) creates the request through the same helper as
  `submitPackageRequest` (`channel: "whatsapp"`, sender phone = the
  WhatsApp number, already verified).
- Reminders: morning-of drop-off and "Still coming?" use the request
  templates (`package_dropoff_reminder_2lang` family); a new template is
  submitted where the wording does not fit.

## 6. Screens

- Customer (app + website): country -> Sea/Air -> items (price list of the
  businesses that ship there, size buttons) -> compare (sort + filters) ->
  bring in (location, day, 2-hour window) or pick up (address -> instant
  fee, day, window) -> sender/receiver -> send.
- Business (console Shipping > Price list, app): per country, Sea | Air tabs,
  items, per-pound rates, departure days; "Laawol set up your prices" banner
  + Looks right; History.
- Coming today (Shipping > Waiting, top): Expected bring_in requests for
  today with their window.
- Laawol admin: open any business's price list and save on its behalf.
- Containers: "Planned departure" date.
- Received: per piece, weight -> price via `counterPriceCents`.
