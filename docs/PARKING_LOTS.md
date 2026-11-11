# Parking lots: several lots for one business

Keren Auto Sales, 2026-11-11: the business opened a second lot. "When
parking a car they should be able to select where it is parked. And they
should be able to filter by lot as well and see analytics on it."

## 1. Decisions (owner, one question at a time)

| # | Decision |
|---|---|
| 1 | **Same prices in every lot.** A lot is only where a car stands. Bills, invoices and money messages do not change, and moving a car never changes what is owed. |
| 2 | **The owner manages a list of lots** in the parking settings: name, its own address when it has one. A closed lot is switched off, never deleted. |
| 3 | **Each lot has its own spaces.** Staff are stopped when a lot is full. Customers online still see one combined total and do not pick a lot. |
| 4 | **Every car already in the system starts in the first lot** ("Lot 1"); staff move the ones that are elsewhere. |
| 5 | **Picking a lot is required** on the park-a-car form when the business has two or more open lots; the form opens on the lot that person used last (on that device) when it has room. A one-lot business never sees the question. |
| 6 | **Anyone who can edit a parked car can move it.** History records who and when; nobody is messaged. |
| 7 | **Online bookings go to the lot the owner chose** (the first lot to start), or the next lot with room. |
| 8 | **The customer sees the lot's name and address** (receipt, their page). |
| 9 | **Numbers per lot**: cars in the lot and spaces free, arrived and left this month, collected this month, still owed. Tapping a lot filters the list. |
| 10 | Lot ledger expenses and jobs get a lot **as a second step**, not in this release. |
| 11 | **No staff restriction**: all parking staff work every lot. |
| 12 | **Server and website first**, the phone app in its next build; until then a car parked from the phone goes to the first lot. |

## 2. Data

`parkingLots/{lotId}`: `businessId`, `name`, `addressLine1`, `city`,
`state`, `zipCode`, `totalSpaces`, `blockedSpaces`, `active` (absent means
open), `isMain`, `sortOrder`. Read by the business's own people
(`firestore.rules`), written only by the server.

- **The first lot** has the id `{businessId}_main`. It is created from the
  business's own parking settings the first time a lot is saved
  (`parking_lots.mainLotFromBusiness`), under the name "Lot 1", with a blank
  address: it stands at the business's parking address and follows it.
- **A car with no `parkingLotId` stands in the first lot**
  (`parking_lots.lotIdOfCar`). Nothing is backfilled: cars parked before
  lots existed, cars the old phone app parks and the app's "Print receipt
  only" records all read as Lot 1.
- **A car in a lot** carries `parkingLotId`, `parkingLotName` and the lot's
  address in `parkingAddress` / `parkingCity` / `parkingState`
  (`parking_lots.carLotFields`), copies written on create, on a booking and
  on a move.
- **The business's two numbers stay the sum over its open lots**
  (`businesses.parkingTotalSpaces`, `parkingBlockedSpaces`;
  `parking_lots.businessSpaceTotals`), with `parkingLotsEnabled: true`. The
  customer search, Today and the totals keep reading one combined figure,
  and `updateBusinessProfile` no longer accepts the two numbers once lots
  exist. `businesses.parkingBookingLotId` is where online bookings go.

## 3. Server

The actions ride on `updateBusinessParkingEntry` (no new export: the
reserved-CPU budget):

| Action | Who | What |
|---|---|---|
| `lot_save {businessId, lotId?, lot}` | owner | Add or edit a lot. Refuses a missing or repeated name, bad numbers, closing a lot with cars in it or the last open lot. |
| `lot_booking {businessId, lotId}` | owner | The lot online bookings go to. |
| `lot_move {entryId, parkingLotId}` | parking staff | Move one car. Refuses an unknown, closed or full lot; the same lot changes nothing. One History line: "Moved from Lot 1 to Lot 2". |

- `createBusinessParkingEntry` takes `parkingLotId`. With lots: the chosen
  lot must be open and have room for the stay (`lot_full` though the
  business as a whole has room); with none asked (the old app) the car goes
  to the first open lot. The combined space check still runs.
- `createParkingReservation` puts a booking in the owner's booking lot, or
  the next lot with room (`parking_lots.pickBookingLot`).
- `getParkingTotals` answers `parking.lots`: for each lot the same figures
  as the business (the same math over the lot's own cars, so the lots add
  up), its usable spaces, and the month's arrivals, departures and money
  collected. The cached "ended stays" part is keyed by the lot ids.

Refusals carry `details.reason` (`parking_lots.LOT_MESSAGES`): `lot_full`,
`lot_closed`, `lot_not_found`, `lot_has_cars`, `lot_last_open`,
`lot_name_required`, `lot_name_taken`, `lot_spaces_invalid`,
`lot_blocked_invalid`, `lot_limit`.

## 4. Website

- **Settings → Services & coverage → Car parking**: "Parking lots" lists the
  lots, with Add a lot / Edit lot and "Online bookings go to". With lots
  set up the two typed numbers (total and blocked spaces) are gone.
- **Parking page**: a card per lot (fill, the month's arrivals and
  departures, collected this month, still owed); tapping one narrows the
  list and the totals to that lot. Each row shows its lot. "Record a parked
  car" asks "Which lot?" and marks a full lot. "Edit parking" has "Move to
  another lot".
- Code: `admin_web/src/lib/parking-lots.ts` (held to the server's rules by
  its test) and `admin_web/src/components/business/parking-lots.tsx`.

## 5. Not in this release

- The phone app (lot picker, filter, move): next build.
- Per-lot figures on Today.
- The lot on Lot ledger expenses and jobs (decision 10).
- The lot's name in the "parked" WhatsApp: the receipt and the customer's
  page carry it; the template itself has no slot for it.
