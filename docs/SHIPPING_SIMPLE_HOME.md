# Simple shipping home, Send packages, kilos, counter price fill

Owner decisions 2026-11-09 (Keetah Wayz: ships by air, charges per kg, sends
packages together per flight, "she doesn't need Containers at all", "make it
very straight forward"). Ships in app 1.0.29; the kilo part also touches the
server and the consoles.

Four parts. Each is independent to build and to test.

| Part | Where | Server change |
| --- | --- | --- |
| H. Simple home | app | none |
| S. Send packages | app | none (three existing callables) |
| K. Kilos | server + consoles + WhatsApp + app | yes |
| P. Counter price fill | app | none |

Nothing here deletes or rewrites a stored record. Existing businesses (pounds,
sea, parking) must see no change at all.

---

## H. Simple home (app)

### H1. Who gets it

A pure function beside `shopHomeLayout` (`lib/services/shipping_home.dart`):

```dart
enum ShippingHomeLayout { standard, simple }

ShippingHomeLayout shippingHomeLayout({
  required bool isAdmin,
  required bool hasBusinessDashboardAccess,
  required bool canUseContainers,   // auth.hasContainersAccess && businessId
  required bool canUseInventory,    // inventoryAvailable(...)
  required Iterable<String> services, // auth.effectiveBusinessServices
});
```

`simple` only when: not a platform admin, has business dashboard access, can
use containers, cannot use inventory, the service list is not empty, and
**every** enabled service is a package-shipping one (`barrelShipping`,
`freight` — not `sharedBarrels`, which has its own pool screens).
Anything else (parking, car sales, car transport, inventory, a destination
clerk holding only Deliveries) keeps today's home untouched. No switch.

`shopHomeLayout` is asked first; the shipping layout is only consulted when it
answers `standard`.

### H2. Air only

```dart
bool airOnlyBusiness({required bool shipsByAir, required bool hasSeaContainer});
// shipsByAir && !hasSeaContainer
```

`shipsByAir` is `businesses/{id}.shipsByAir`. `hasSeaContainer` is whether the
business has any container that is not air (deleted ones do not count). The
word "Container" never appears on the simple home of an air-only business.

### H3. What is on it

Top to bottom, inside the same header row the standard home has (back button,
bell, language switch):

1. Business name. The approval note (`ShopApprovalNote`) when the business is
   not approved.
2. **Register a package** — the one loud button (`_PrimaryAction`, key
   `register-package`). Opens "Packages here" with the register form already
   open; after Save the package is on the list behind it and the label sheet
   is offered as today.
3. Rows (`_DestinationGroup`):
   - **Requests** (key `open-package-requests`) — only while customers have
     open requests waiting on the business, with the count. Opens the existing
     `BusinessRequestsScreen`.
   - **Packages here** (key `open-packages-here`) — "Dropped off, waiting to
     leave." Opens the waiting list.
   - air only: **On the way** (key `open-on-the-way`) — "Sent, until they
     arrive." Opens the shipments list (H4).
   - otherwise: the existing **Containers** row, unchanged.
   - **Deliveries** (key `open-deliveries`) — when the person holds the
     deliveries access. Existing `DeliveriesHomeScreen`.
4. A quiet **Money** group: the existing Invoices and Staff balances rows,
   same gates, same keys.
5. The existing tail of the services card: more tools, Open business console,
   assistant. Shared with the standard home, not copied.

No service tiles. The activity list (online barrel orders and old freight
orders the home already listens to) is shown under the rows, exactly as today,
**only when it has records** — a business with none sees a clean screen, and a
business that takes online orders loses nothing.

Today (2026-11-10) the rule selects Keetah Wayz and one test business; every
other business has parking, cars or inventory and keeps its home.

While `shipsByAir` / `hasSeaContainer` are still loading, the row that depends
on them (On the way / Containers) is simply not there yet; the rest is. A
failed read falls back to the Containers row (today's behaviour).

### H4. Entry points into the containers screen

`ContainersScreen` owns the feeds every package screen needs (containers,
lines, staff, customers, destinations, proof settings, requests). It gains

```dart
enum ContainersEntry { containers, waiting, shipments, requests }
ContainersScreen({required businessId, entry = containers, registerOnOpen = false})
```

- `containers`: today's screen, byte for byte.
- `waiting`: its `build` returns the `WaitingPackagesScreen` directly (no
  Containers screen underneath; Back goes home). `registerOnOpen` opens the
  register form once after the first frame.
- `shipments`: today's list restricted to what has left — the status filter
  offers only Shipped (default) and Arrived — titled "On the way"; tapping one
  opens the existing `ContainerDetailScreen`. No create button, no
  Waiting/Requests shortcuts, no scan-to-load. Empty state: "Nothing on the
  way. Send packages from Packages here."
- `requests`: returns `BusinessRequestsScreen` directly.

For an air-only business (`airOnlyBusiness` over the screen's own feed):
- the waiting list is titled **Packages here**;
- the register form starts on Air and does not offer "Ships by: Sea · Air".

---

## S. Send packages (app)

She sends several packages together on one flight. On the waiting list, for a
business that ships by air with at least one waiting air package of a
customer: a **Send packages** button (key `send-packages`).

### S1. The sheet

1. Destination: packages go one country per shipment (the server refuses a
   mix). One country waiting → no question. Several → pick one first.
2. The waiting air packages for that country, each with a tick, all ticked to
   start (sender → receiver, code, pieces, weight). "Select all / none".
3. **Flight date** — today by default, month first.
4. **Airway bill number (optional)** — 6 to 20 letters/digits when given
   (server rule `AIR_WAYBILL`).
5. **Send N packages**.

### S2. What it does

A pure plan (`lib/services/send_packages.dart`, unit-tested) and three
existing callables, in order:

1. `createContainer({businessId, shipMode: 'air', airWaybill?, label?,
   destinationCountryId, destinationCountryName, plannedDepartureDate})` —
   `label` is "Flight MM/DD/YYYY" ("Vol MM/DD/YYYY") only when no airway bill
   was typed; `plannedDepartureDate` is the flight date as `YYYY-MM-DD`.
2. `assignContainerLines({businessId, containerId, lineIds})` — when it
   answers with sender-problem warnings, the sheet shows them and "Send
   anyway" repeats the call with `acknowledgeProblems: true`.
3. `setContainerStatus({businessId, containerId, status: 'shipped'})` — this
   is what sends customers their "left" WhatsApp, exactly as a container does.

**Resume, never duplicate.** The sheet remembers the `containerId` from step 1
for as long as it is open. A failure at step 2 or 3 shows the server's reason
and a **Try again** that continues from the failed step with the same
shipment (assign leaves lines already on it alone; repeating a status
repairs). If the sheet is closed after step 1 the shipment exists as a
loading air shipment; it is visible under Containers on the console and is
picked up again by the next Send for the same country and date only if it is
still empty — otherwise staff finish it from the console. (No silent delete.)

On success: "N packages sent" and the list refreshes from the feed.

Arrival is unchanged: open the shipment from **On the way** → Mark arrived.

---

## K. Kilos

No per-business switch. **The unit comes from the price list.**

### K1. Price list

`packagePriceLists/{businessId}` gains `weightUnit: "lb" | "kg"`. Absent means
`lb`; a pounds list is stored exactly as before (no new field written on its
routes), so every existing fixture case stays byte-identical.

- `validatePriceList(raw, countryIds)` reads `raw.weightUnit`; anything other
  than `lb`/`kg`/absent is `unit_invalid`. It answers `{routes, weightUnit,
  errors}`.
- A kilo list stamps `unit: "kg"` on every stored route, so a route is
  self-describing wherever it travels (`routeOf` callers need nothing new).
  `unitOf(route)` answers `"kg"` or `"lb"`.
- Field names do not change: `perLbCents`, `includedLb`, `excessPerLbCents`,
  `weightLb` on a route or price snapshot are **in the route's unit**. This is
  written in the header comment of each mirror. No migration.
- Changing the unit keeps the numbers and changes what they mean. The editor
  asks once ("Your prices are now per kg. The amounts did not change — check
  them.").
- Limits: rates and included weight keep their numeric limits in either unit;
  a weight is 0.1–2000 lb or 0.1–900 kg. Messages name the unit.
- `SIZE_PRESETS` gain `kg`: small bag 5, suitcase 23, big box 32.

### K2. Pricing

- `pricePiece(route, piece, ctx)`: a by-weight piece is `{categoryId,
  weightLb, weightUnit?}` — the number typed and the unit it was typed in
  (absent = the route's unit). When the typed unit differs from the route's,
  the weight is converted (1 kg = 2.20462 lb) and rounded to a tenth **before**
  pricing; the price is `rate × weight in the route's unit`
  ($25/kg × 10 kg = $250.00 exactly). The snapshot stores that weight in
  `weightLb`, plus `unit: "kg"` when the route is kilos (absent = lb), and
  the description says "· 10 kg".
- `counterPriceCents(price, weighed)`: `weighed` is in the snapshot's unit.
  Callers holding a line weight in the other unit convert first
  (`weightIn(unit, {weightLb, weightKg})`).
- `repricePieces` carries the unit through; a request priced in pounds and
  re-priced against a list that moved to kilos converts its stored weight.
- The compare page prices each business in its own unit and compares totals.
  The customer types a weight once, with a lb/kg choice (default: the
  business's unit on a single-business link, lb when comparing).

The three mirrors (`functions/package_price_list.js`,
`admin_web/src/lib/package-price-list.ts`,
`lib/services/package_price_list.dart`) move together; new cases go into
`functions/test/fixtures/package-price-list-cases.json` and run in all three
suites.

### K3. A package's weight (proof)

`containerLines.weightLb` stays **pounds, always** — every reader that was
never told about kilos stays correct. New optional `weightKg` (0.1–900, one
decimal) is what staff typed when they typed kilos:

- A write carrying `weightKg` stores it and derives
  `weightLb = max(0.1, round1(weightKg × 2.20462))`.
- A write carrying `weightLb` and no `weightKg` (an older app) clears
  `weightKg`.
- `weightText(line, lang)` says "10 kg" when `weightKg` is there, else
  "22 lb" as today. Labels, the package page, customer WhatsApp updates and
  the customs sheet use it. A customs total is in kilos only when every
  weighed line is; otherwise pounds.

### K4. Which unit a screen shows

`businessWeightUnit`: the price list's `weightUnit` when the business has a
price list with at least one route; otherwise the last unit this person
picked on this device (a small lb/kg choice on the weight field, shown only
while there is no price list), default lb.

Follows it: the price list editor (the choice lives beside the first
by-weight rate and reads "per lb / per kg"), the counter weight field, labels,
the customer request form and prices ("$25/kg", "up to 2 kg each"), the
WhatsApp form and its texts, the compare page.

Every new or changed string exists in English and French.

---

## P. Counter price fill (app)

On the register form, each piece gets **From the price list** (shown when the
business has a route for the package's destination and ship mode):

- pick an item ("New phone — $110") → the piece's description (when empty)
  and price are filled; quantity multiplies;
- pick a by-weight kind ("General goods — $25/kg") → asks the weight in the
  list's unit → price = rate × weight, description "General goods · 10 kg";
  on an air package with an empty weight field, the package weight is filled
  with the sum of the weights typed this way.

The price stays editable; nothing new is stored on the line — the fill is a
calculator over `pricePiece`, so the counter and the customer's estimate can
never disagree on the arithmetic. Console parity is a follow-up.

---

## W. Air-only on the website console

The business console (`admin_web`) keeps its Shipping page and its steps; an
air-only business only reads different words on it. Send packages and the
counter price fill stay app-only for now (follow-up).

### W1. Who gets it

The same rule as H2: `shipsByAir && !hasSeaContainer`
(`admin_web/src/lib/air-only.ts`, mirror of the app's `airOnlyBusiness`).
`hasSeaContainer` comes from two `count()` reads on `containers`, equalities
only: every container of the business, and those with `shipMode == "air"`
(an old sea container carries no `shipMode`); sea = all > air. It is asked
only for a business that flies and a person who can open the lists, and asked
again when the container count changes. While it loads, and when it fails,
the console is the one every business has today. A sea container among the
rows the panel already holds overrules the count at once.

### W2. Words

One table, `shippingCopy(airOnly)`, two fixed sets. For an air-only business
the word "container" (French "conteneur") never appears in:

| Place | Others read | Air-only reads |
| --- | --- | --- |
| Sidebar, under Shipping | Requests, waiting list, containers, deliveries | Requests, packages, shipments, deliveries |
| Steps | Waiting · Containers | Packages here · Shipments |
| Waiting list title | Waiting list | Packages here |
| Container list | Containers · New container · Container | Shipments · New shipment · Shipment |
| A package not loaded | Waiting for a container | Not sent yet |
| Today | Containers in progress · Sailed | Shipments in progress · Sent |
| Today tiles / needs attention | Packages waiting for a container · Containers loading · Containers sailed | Packages not sent yet · Shipments loading · Shipments sent |

The ledes, the register form's subtitle and its WhatsApp hint follow the same
table. A container marked Air reads "shipment" on its own page for every
business. Every string has its French in `french-dom.ts`.

### W3. Register a package

- Starts on **Air**; "Ships by" is not asked. It shows only when correcting an
  old sea package, so that package can be moved to air.
- Where the question would be, the form says **"Ships by air"** (plane icon,
  `ShipsByAirLine` in `ships-by.tsx`), so the staff see how the package goes
  without being asked (2026-11-10).
- The first piece is a **box** (and so is each piece added after it).
- "A car" is not asked; it shows only when correcting a package that is a car.
- The Air / Sea filter above the list shows only while a sea package is still
  in the list.
- A new shipment ("New shipment") starts on Air.

Not in this pass: the dialogs that add or move packages, the staff view of a
package, the price list panel and the label dialog still say "container".

---

## Tests (definition of done)

- H: unit tests for `shippingHomeLayout` and `airOnlyBusiness`; widget tests
  for the simple home (rows, keys, air-only vs sea, a parking business
  unchanged, a pending business shows the note), and for each
  `ContainersEntry`.
- S: unit tests for the plan (label vs airway bill, date key, country split);
  widget tests for the sheet with a fake caller: happy path, warning → Send
  anyway, failure at each step → Try again continues with the same shipment
  and never calls `createContainer` twice.
- K: shared fixture cases (kg list validates; lb list unchanged byte for byte;
  $25/kg × 10 kg; typed lb priced on a kg route and the reverse; counter price
  in kg; reprice across a unit change; invalid unit); server tests for
  `weightKg` on add/update/receive incl. the old-app clear; label/WhatsApp text.
- P: widget tests for item fill, by-weight fill, quantity, editing after fill.
- W: `admin_web/src/lib/air-only.test.ts` - the rule and the counts; no
  air-only string says container in English or French and each has French;
  the standard strings unchanged; the form's Air / box / no-car start.
- No real customer names or phone numbers in any test.
- EN and FR on the simulator for every changed app screen before a store build.
