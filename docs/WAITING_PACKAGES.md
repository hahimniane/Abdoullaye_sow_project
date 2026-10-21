# Waiting packages: contract and data model

A package can be dropped off before anyone knows which container it will
ride. It is a `containerLines` document with **no container**
(`containerId: ""`, `containerStatus: "waiting"`) and keeps its tracking code
(`CL-xxxxxx`), its label and its VIN lock through the wait and after it is
added to a container. Backend: `my_flutter_app/functions`
(`container_manifest.js`, `container_payments.js`, `index.js`).

Rules of the road
- **One message at drop-off, none when a package is put on a container.**
  `addWaitingPackage` (like `addContainerLine`) queues the `package_received`
  WhatsApp message (`containerUpdates/{lineId}_{role}_received`, see
  docs/WHATSAPP_CONTAINER_UPDATES.md). Assigning and unassigning write no
  `trackingEvents` and no `containerUpdates`; the next message is the
  "shipped" one.
- **Destination is a hard block.** A package only rides a container going to
  the same `destinationCountryId`. The server enforces it (assign, move, edit,
  add, and changing a container's destination under its packages).
- Prices are US dollars in whole cents, never converted. Payments are rows;
  `paidCents` on the line is always the sum of the payments not reverted and
  never exceeds the price.
- Every callable needs the `containers` section (`requireBusinessPermission`)
  and writes `lotLedgerAudit` rows with who and when. History entity: the
  **container id** for a package on a container, the **line id**
  (`entityType: "container_line"`) for a waiting one. Price, payment and
  assignment changes are always also written under the line id, so a package's
  own history is `where businessId == b and entityId == lineId`.

## New fields on `containerLines`

| field | type | notes |
| --- | --- | --- |
| `containerId` | string | `""` while waiting |
| `containerStatus` | string | `"waiting"` \| `"loading"` \| `"shipped"` \| `"arrived"` |
| `destinationCountryId`, `destinationCountryName` | string | older lines have `""` and ride anywhere |
| `lengthIn`, `widthIn`, `heightIn` | number \| null | inches, 0 < n <= 600, all three or none; volume in cubic feet is L*W*H/1728 |
| `priceCents` | int \| null | `null` = not priced yet |
| `paidCents` | int | server-kept, default 0 |
| `payOnArrival` | bool | the Guinea team will record the money |
| `documentToken` | string | secret behind the labels link (minted on first `getContainerDocumentUrl` with `lineIds`) |

`containerLinePayments/{id}` (server-write only): `businessId`, `lineId`,
`amountCents`, `method`, `note`, `receivedByStaffId` (who held the money,
chosen in the payment sheet, as for parking and lot payments),
`recordedByStaffId` (who typed it in: the signed-in uid, which differs when
one person enters another's cash), `createdAt`, `reverted`, and once reverted
`revertedByStaffId`, `revertedAt`. Payments written before `recordedByStaffId`
existed carry only `receivedByStaffId` (then the uid who typed it).
Methods: `cash, zelle, cashapp, venmo, check, card_in_person, other`
(`INVOICE_PAYMENT_METHODS`).

Reads (rules: `lotLedgerRead(businessId)`, writes `false`)
- Waiting list: `containerLines where businessId == b and containerStatus == "waiting"` (existing composite index).
- A package's payments: `containerLinePayments where businessId == b and lineId == l`
  (**both** equalities - the rule authorises by business; no composite index needed).

## Errors

Every refusal is an `HttpsError` whose `message` is the text in
`CONTAINER_MESSAGES` and whose `details.reason` is the code. Validation
failures are `invalid-argument` with `details.reasons: string[]` (every
problem at once); state refusals are `failed-precondition` with
`details.reason`; a missing line/payment is `not-found`. Refusals about lines
add `details.lineIds`.

New codes: `package_destination_required`, `destination_mismatch`,
`container_destination_required`, `size_invalid`, `line_not_waiting`,
`line_is_waiting`, `line_not_in_container`, `line_ids_invalid`,
`line_has_payments`, `price_invalid`, `price_below_paid`, `price_required`,
`amount_required`, `amount_too_large`, `payment_method_invalid`,
`received_by_required`, `received_by_invalid`, `payment_exceeds_balance`,
`payment_not_found`, `payment_already_reverted`,
`vin_already_waiting` (message only; see VIN below).

## Callables

### `addWaitingPackage`
`{businessId, kind: 'car'|'barrels'|'other', vinNumber?, carMake?, carModel?,
carYear?, quantity, description, ownerKind: 'customer', customerName?,
customerPhone?, receiverName, receiverPhone, notifyCustomer, notifyReceiver,
senderIsReceiver?: bool, destinationCountryId, destinationCountryName, lengthIn?, widthIn?, heightIn?,
priceCents?: int|null, payOnArrival?: bool, payment?: {amountCents: int > 0,
method, receivedByStaffId, note?}}` -> `{success, lineId, trackingCode,
paidCents, paymentId}`.
Rules as `validateContainerLine` plus: `ownerKind` must be `customer`,
destination id required.

**Sender and receiver (owner, 2026-10-21).** On every customer line (a
container's or a waiting one) the sender (`customerName`/`customerPhone`) is
optional and the receiver's name is required (`receiver_name_required`,
"Enter the receiver's name."); business stock keeps the receiver optional.
`senderIsReceiver: true` ("Sender is the receiver" on both clients' forms,
off by default) makes the server store the receiver's name and phone as the
sender's too, write `senderIsReceiver: true`, use the receiver's WhatsApp
switch for both, send each update once (role `receiver`), and print the
person once on labels. With no sender the receiver is the line's customer
wherever one is named: `lineCustomer` / `lineCustomerName` /
`lineCustomerPhone` (functions `container_manifest.js`, mirrored in
`container-manifest.ts` and `container_manifest.dart`) - the sender when any
sender detail was given, else the receiver, name and phone always from the
same person. Lines saved before the rule keep working: the receiver's name is
only demanded when a line is created or its people (contacts or owner) are
edited (`lineContactsEdited`); a price, payment, pieces, destination or move
edit of an old line with no receiver is not refused. Older app versions that
send a sender and no receiver are refused with the English message above. `description` is stored for `other` only, `quantity`
is 1 for cars. `paidCents` in the request is ignored.

**Money received at drop-off** (`payment`, optional). Absent or `null`: nothing
changes (`paidCents: 0`, `paymentId: ""`). Present: judged by the same
`validateLinePayment` as `recordContainerLinePayment`, against the price in the
**same request** and nothing paid - `amount_required`, `amount_too_large`,
`price_required` (no price sent), `payment_exceeds_balance` (more than the
price), `payment_method_invalid` (`method` is one of the invoice methods:
`cash`, `zelle`, `cashapp`, `venmo`, `check`, `card_in_person`, `other`), `received_by_required`. These are reported with
the package's own problems in one `invalid-argument` (`details.reasons`), then
`received_by_invalid` (its own `invalid-argument`) when the person is not one
of the business's people. All refusals happen **before anything is written**.
On success the line (`paidCents` = amount) and its `containerLinePayments` row
(`{businessId, lineId, amountCents, method, note, receivedByStaffId,
recordedByStaffId: caller, reverted: false, createdAt}`) are written in the
same transaction as the line and its VIN lock, and the package's history gets a
`payment` entry worded as `recordContainerLinePayment`'s. A part payment is
fine; the rest is taken later with `recordContainerLinePayment`.

**Who may be named as having taken money** (`received_by_invalid` otherwise),
for both callables: a person whose `users/{uid}.businessId` is this business
(the team list the console's "Received by" select reads), or the business's
`ownerUid`.

### `assignContainerLines`
`{businessId, containerId, lineIds: string[] (1..100, deduplicated)}` ->
`{success, assigned}`. One transaction, all or none. Refuses (nothing changes):
container not open (`container_locked`); a line missing or another business's
(`line_not_found`, not-found, `lineIds`); a line not waiting
(`line_not_waiting`); container with **no destination** while a line has one
(`container_destination_required` - set the container's destination first);
any line to a different country (`destination_mismatch`,
`details.lineIds` = every offending line). Moves lines to the container
(`containerStatus` = the container's, `loading`), moves the cars' VIN locks
(`containerId`), increments the container's tallies once. Writes no timeline
moment and no WhatsApp row.

### `unassignContainerLine`
`{businessId, lineId}` -> `{success}`. Only while the container is loading
(`container_locked`); line must be on a container (`line_not_in_container`).
Back to `containerId: ""`, `containerStatus: "waiting"`, tallies decremented,
the VIN lock keeps holding (now with `containerId: ""`).

### `removeContainerLine`
Unchanged with `containerId`. **Without `containerId`** it removes a waiting
package (`{businessId, lineId}`), releasing its VIN lock; a package that is on
a container is `not-found` this way. Refused with `line_has_payments` while
payments stand (revert them first) - on a container too.

### `updateContainerLine`, `updateContainerLineContacts`
`containerId` may be omitted (or `""`) for a waiting line. Substance fields -
kind, VIN/car, quantity, description, owner, **destination, size** - editable
while waiting or while the container is loading (`container_locked` after).
Contacts, `priceCents`, `payOnArrival` are editable in every state; a price
below what was paid is `price_below_paid`. `paidCents` can never be edited.
On a container, a changed destination must still match it.

### `moveContainerLine`
A waiting line is `line_is_waiting` (add it with `assignContainerLines`).
Moving to a container going elsewhere is `destination_mismatch`.

### `updateContainer`
Changing `destinationCountryId` while lines on it carry a different
destination is `destination_mismatch` with `lineIds`.

### `setContainerLinePrice`
`{businessId, lineId, priceCents: int|null, payOnArrival: bool}` ->
`{success, lineId, priceCents, payOnArrival}`. Any time. `price_invalid` for a
non-positive/non-integer price, `price_below_paid` for a price under what was
paid (or clearing it after a payment). Both fields are written every call.

### `recordContainerLinePayment`
`{businessId, lineId, amountCents, method, receivedByStaffId, note?}` ->
`{success, paymentId, paidCents}`. Needs a price (`price_required`), amount > 0
and <= balance (`payment_exceeds_balance`), and **who took the money**
(`receivedByStaffId`, trimmed, required: `received_by_required`, the same rule
and wording as parking) who must be one of the business's people
(`received_by_invalid`, checked after the payment's own checks; see
`addWaitingPackage`). The row stores `receivedByStaffId` = the chosen person
and `recordedByStaffId` = the caller. The audit summary reads
`Received $X (method) by <receiver> (entered by <caller>) for <package>`, with
"entered by" only when it is someone else. Transactional: the paid total is
recomputed from the line's live payments, so concurrent payments cannot
overpay.

### `revertContainerLinePayment`
`{businessId, paymentId}` -> `{success, paidCents}`. Soft revert; recomputes
`paidCents`. `payment_already_reverted`, `payment_not_found`.

### `getContainerDocumentUrl`
With `containerId`: unchanged. **Without it**, `{businessId, lineIds: [...]}`
(or one `lineId`; 1..100, any state) -> `{success, url}`: a labels link
(`view=labels`; `format`, `copies` honoured; `code` set for a single line).
Each line has its own `documentToken`; the link's `t` is the tokens joined with
`.`, and `/d` (`parkingDocument`) serves exactly those lines' labels. No
container footer when printing this way.

### `getPackageLabels` (labels as data, for the phone to print itself)
`{businessId, containerId?: string ("" or absent for waiting packages),
lineIds?: string[] (1..100), lineId?: string, copies?: 1|2 (default 2)}` ->
`{labels, reference, hasContainer, businessName, businessPhone}`.
Same gate (containers section) and the same line loading and tracking-code
assignment as `getContainerDocumentUrl` (shared helpers `looseLabelLines` /
`containerLabelLines`):
- **No container**: `lineIds` (or one `lineId`) required - empty, over 100 or
  not strings is `invalid-argument` `line_ids_invalid`; a line missing or
  another business's is `not-found` `line_not_found` with `details.lineIds`.
- **With `containerId`**: the container must be this business's
  (`not-found` otherwise); the whole box, or only `lineId` / `lineIds` that are
  on it (others: `not-found` `line_not_found` with `details.lineIds`).
- Permission: `permission-denied` without the containers section or for
  another business.

`labels` is exactly `containerLabelsModel(...).labels` - one entry per copy per
package, oldest drop-off first, each `{code, link, what, vin, packageNumber,
packageCount, receiver, receiverPhone, sender, senderPhone, destination, size,
place}` (`link` is the public tracking link the QR encodes). `reference` is the
container number / label / booking reference, `""` without a container. No
logo, no price.

## Labels
Per package label: QR (unchanged public tracking link), code, what, VIN,
receiver name + **full phone**, sender name + **full phone** (not for business
stock), destination (the package's, else its container's) and `L x W x H in`
when all three are set. **Price and payments are never printed.**

One label per piece, `CL-K7M4P2 · 1 of 3` (`packageNumber` / `packageCount`),
naming that piece (`Barrel`, the box's or item's description) and its own
size. A legacy line prints its quantity the same way. The copies switch reads
"per piece".

## Pieces (docs/PACKAGE_REQUESTS.md §1, phase 1)

A line is one customer's load (one sender, one receiver, one destination,
one code). It holds **pieces**: each physical thing handed over. Several
things packed in one box are one piece. Pure rules: `functions/line_pieces.js`,
mirrored by `admin_web/src/lib/line-pieces.ts` and
`my_flutter_app/lib/services/line_pieces.dart`; all three run the shared cases
in `functions/test/fixtures/line-pieces-cases.json`.

| field | type | notes |
| --- | --- | --- |
| `pieces` | `[{id, kind, description, sizeIn, priceCents}]` \| null | `kind`: `barrel` \| `box` \| `other`; `description` up to 120 chars, required for box/other; `sizeIn` `{l,w,h}` inches (0 < n <= 600, all three) or null; `priceCents` int >= 0 or null. `null` on cars and on lines in the old kind/quantity form |
| `pieceCount`, `barrelPieces`, `packagePieces`, `carPieces` | int | denormalized on every write; packages = box + other; a car line is 1 car piece |
| `kind`, `quantity`, `description` | | summaries for older app versions: `barrels` when every piece is a barrel else `other`; quantity = piece count; description names the pieces ("Barrel, Clothes, TV") |
| `priceCents` | int \| null | = sum of the priced pieces + `pickupFeeCents` (`lineTotalCents`; null while no piece is priced) |
| `pickupFeeCents` | int >= 0, absent | a collected request's pickup fee, the line's own amount beside the pieces (owner decision 2026-10-18: never spread into piece prices). Present (0 allowed) only on the line Received makes from a "Collect from me" request; absent on counter lines, bring-in requests, cars, legacy lines and split parts (absent reads as 0). `lineHasPickupFee` says whether the edit forms show the field |
| `lengthIn`/`widthIn`/`heightIn` | | the piece's size for a one-piece line, else null |
| `source` | `counter` \| `request` \| `card_order` | `counter` for `addWaitingPackage` / `addContainerLine`; `request` / `card_order` for `receivePackageRequest` (docs/PACKAGE_REQUESTS.md §8.6) |
| `requestId` | string | the `packageRequests` id a received request came from; `""` for counter lines |
| `receivedAt` | timestamp | server time when the pieces were received (counter: creation; a request: when staff tap Received). Legacy lines: read `createdAt` |
| `rootLineId`, `partIndex` | string, int | a new line is its own root, part 1. A split part points at the root |
| `lastPartIndex` | int | on the root: the highest part number ever used (a cancelled part's code is never reused) |
| `splitFromLineId` | string | on a part: the line it was split from |

**Reading old lines** (`linePieces`): `{kind: "barrels", quantity: 4}` is 4
barrel pieces; `{kind: "other", quantity: 2, description}` 2 `other` pieces
with that description; a car 1 `car` piece. A legacy price is spread evenly
over its pieces (odd cents on the first ones) so totals still read the same.
Every reader (counts, labels, WhatsApp, tracking, lists) goes through it.

**Writing**: `addWaitingPackage`, `addContainerLine` (`line.pieces`) and
`updateContainerLine` (`line.pieces`) take `pieces` (1-60). When `pieces` is
present on a line that is not a car, `kind`/`quantity`/`description`/size/
`priceCents` in the request are ignored and recomputed from the pieces (plus
`pickupFeeCents` when the request carries one; whole cents >= 0, else
`pickup_fee_invalid`). A
request without `pieces` (older app versions) still writes the old form.
Both add callables answer with `pieceCount` too, and money received at
drop-off is judged against the sum of the pieces.
New refusal codes (`invalid-argument`, `details.reasons`): `pieces_required`,
`pieces_too_many`, `piece_kind_invalid`, `piece_description_required`,
`piece_description_too_long`, `piece_size_invalid`, `piece_price_invalid`.
Piece ids are kept when they are `[A-Za-z0-9_-]{1,40}` and unique; others get
the first free `p<n>`.
`receivePackageRequest` (a customer's request handed over) writes its line
with the same writer (`containerLineRecord` in pieces mode) and the same
receipt fields (`lineReceiptFields` in `container_manifest.js`: `source`,
`requestId`, `receivedAt`, `rootLineId`, `partIndex`), so waiting, labels,
split, payments and monthly volume treat it like a counter line; it holds at
most 20 pieces (the request's cap).

**Editing** (`updateContainerLine`): what the pieces are (count, kind,
description, size) changes while waiting or loading (`container_locked`
after); their prices change in every state (edit key `piecePrices`). The
counts follow the current pieces and the History says "Edited 2 barrels, 1
box (was 3 barrels): pieces for Fatou". An edit that leaves
`pickupFeeCents` out keeps the stored fee; sending it changes it (edit key
`pickupFeeCents`, open in every state like the prices, History "pickup
fee"). The console and app line edit forms show a "Pickup fee" field only
for a line that has one (`lineHasPickupFee`), and the price call an edit
makes carries pieces + fee, so nothing is spread. `setContainerLinePrice` on
a line with pieces spreads a changed total evenly over its pieces (the same
rule as reading a legacy price) - only what is above the line's pickup fee:
the fee stays as it is, and a total below it is refused
(`price_below_pickup_fee`, beside any `price_below_paid`); an unchanged
total only toggles pay on arrival.

## Split across containers

`assignContainerLines` takes `pieceCounts: {[lineId]: n}` (optional). For a
line whose `n` is below its piece count, the first `n` pieces ride on the
line itself (its code, its labels); the rest become a **part**: a new waiting
line coded `<root code>-<k>` (`CL-K7M4P2-2`, then -3; `k` is one past the
group's highest part), `rootLineId` = the root, `partIndex` = k, the same
customer, receiver, phones, WhatsApp switches, destination, pay-on-arrival,
`source`, `requestId` and the root's `receivedAt`; `paidCents: 0`; the pieces
moved with their prices (each line's `priceCents` is the sum of its own
pieces). A pickup fee stays on the line that goes (the root keeps it, inside
its `priceCents`); the part gets no `pickupFeeCents`, so the group's total
holds the fee once. All in the one transaction that moves the lines. `n` must be a whole
number from 1 to the line's piece count (`piece_count_invalid`,
`invalid-argument`, `details.lineIds`); a car is never split. A line already
on this container is skipped, so retrying a request that landed changes
nothing (`alreadyAssigned`). Answer: `{success, assigned, alreadyAssigned,
parts: [{lineId, partLineId, trackingCode, pieceCount}]}`. A part can be split
again. No WhatsApp is sent by a split; each part later gets its own departed
and ready-for-pickup messages. Container tallies count only the pieces on
that container (`barrelCount` = barrel pieces, `otherCount` = box + other
pieces, `carCount` = cars).

Sending a part back to waiting (`unassignContainerLine`) never re-merges it.

**Money stays on the root.** Payments are rows on the root line; `paidCents`
lives there. Paid and balance are read for the whole group
(`lineGroupSummary`: sum of the parts' prices, the root's paid, and
`pickupFeeCents` - the part of that sum that is a pickup fee, told apart and
never added again):
- `recordContainerLinePayment` with a part's id records on the root, against
  the group's balance (answer `lineId` = the root).
- A price change on any part (`setContainerLinePrice`, a piece price in
  `updateContainerLine`) may not take the group below what the root was paid
  (`price_below_paid`).
- `removeContainerLine`: a root with other parts is refused
  (`line_has_parts`); removing (cancelling) a part is refused while the rest
  of the group would be priced below what was paid (`line_has_payments`).

**WhatsApp "what"** for a line with pieces: "2 of your 4 pieces" / "2 de vos
4 colis" when its group has more than one part, else the piece summary
("2 barrels, 1 box" / "2 barils, 1 carton"). Legacy lines read as before.

**Tracking page** (`lookupGuestTracking`, container records): `pieceCount`,
`parts: [{trackingCode, stage, pieceCount, priceCents}]` (the whole group,
part order, at least the line itself) and `payment: {priceCents,
pickupFeeCents, paidCents, balanceCents}` for the group (`pickupFeeCents` is
inside `priceCents`; the page shows it as its own "Pickup fee" row when above
zero). Volume counts are pieces only: a fee never changes them. Either code of a group finds it; part codes
also match typed without the dash (`clk7m4p22`).

## VIN
A waiting car holds its VIN lock like a loaded one. A conflicting add/edit
(`addContainerLine`, `addWaitingPackage`, `updateContainerLine`) fails with
`details.reason: "vin_already_loaded"`, `details.conflictContainerId` = the
container id, or the string `"waiting"` when the holder is a waiting package,
and `details.conflictWaiting: bool` (the message then reads "already waiting
for a container"). Do not offer "jump to container" for `"waiting"`.

## Public tracking
`guest_tracking.js`: a container line with `containerStatus: "waiting"` has
stage `waiting_container` (text: "Received, waiting for a container";
`WAITING_STAGE_LABEL`). Clients that do not know the stage should treat it as
before-booked; `loading` is still `booked`.

## Zelle bank check

A package payment recorded as Zelle (`method: "zelle"`) can be checked against the owner's connected bank (docs/ZELLE_BANK_CHECK.md, kind `container_line_payment`, needs the `containers` section). The server writes `bankCheck` on the `containerLinePayments` row: `{status: "confirmed", creditId, amountCents, atMs, timeKnown, senderName, institutionName, checkedByUid, checkedAt}` or `{status: "not_found", checkedByUid, checkedAt}`.
