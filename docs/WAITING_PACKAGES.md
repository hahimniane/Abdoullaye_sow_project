# Waiting packages: contract and data model

A package can be dropped off before anyone knows which container it will
ride. It is a `containerLines` document with **no container**
(`containerId: ""`, `containerStatus: "waiting"`) and keeps its tracking code
(`CL-xxxxxx`), its label and its VIN lock through the wait and after it is
added to a container. Backend: `my_flutter_app/functions`
(`container_manifest.js`, `container_payments.js`, `index.js`).

Rules of the road
- **Nobody is messaged** at drop-off or when a package is put on a container.
  The first WhatsApp message is still the "shipped" one. These callables write
  no `trackingEvents` and no `containerUpdates`.
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
`amountCents`, `method`, `note`, `receivedByStaffId`, `createdAt`,
`reverted`, and once reverted `revertedByStaffId`, `revertedAt`.
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
`payment_exceeds_balance`, `payment_not_found`, `payment_already_reverted`,
`vin_already_waiting` (message only; see VIN below).

## Callables

### `addWaitingPackage`
`{businessId, kind: 'car'|'barrels'|'other', vinNumber?, carMake?, carModel?,
carYear?, quantity, description, ownerKind: 'customer', customerName,
customerPhone, receiverName, receiverPhone, notifyCustomer, notifyReceiver,
destinationCountryId, destinationCountryName, lengthIn?, widthIn?, heightIn?,
priceCents?: int|null, payOnArrival?: bool}` -> `{success, lineId, trackingCode}`.
Rules as `validateContainerLine` plus: `ownerKind` must be `customer`,
destination id required. `description` is stored for `other` only, `quantity`
is 1 for cars. `paidCents` in the request is ignored.

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
`{businessId, lineId, amountCents, method, note?}` -> `{success, paymentId,
paidCents}`. Needs a price (`price_required`), amount > 0 and <= balance
(`payment_exceeds_balance`). Transactional: the paid total is recomputed from
the line's live payments, so concurrent payments cannot overpay.

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

## Labels
Per package label: QR (unchanged public tracking link), code, what, VIN,
receiver name + **full phone**, sender name + **full phone** (not for business
stock), destination (the package's, else its container's) and `L x W x H in`
when all three are set. **Price and payments are never printed.**

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
