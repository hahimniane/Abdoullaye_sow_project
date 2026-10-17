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
carYear?, quantity, description, ownerKind: 'customer', customerName,
customerPhone, receiverName, receiverPhone, notifyCustomer, notifyReceiver,
destinationCountryId, destinationCountryName, lengthIn?, widthIn?, heightIn?,
priceCents?: int|null, payOnArrival?: bool, payment?: {amountCents: int > 0,
method, receivedByStaffId, note?}}` -> `{success, lineId, trackingCode,
paidCents, paymentId}`.
Rules as `validateContainerLine` plus: `ownerKind` must be `customer`,
destination id required. `description` is stored for `other` only, `quantity`
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
