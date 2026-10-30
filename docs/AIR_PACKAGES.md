# Air packages with proof at every step

A small business flies packages (phones, tablets, clothes) to Guinea. Today she
photographs every package, asks the sender to send photos on WhatsApp, and asks
the person in Guinea to send photos on WhatsApp when it arrives. All of it lands
in her personal WhatsApp, unmatched to packages. Decided with the owner on
2026-10-29 (18 decisions). The goal: **she does nothing more than today; the
proof comes from WhatsApp taps by the sender and the receiver, filed on the
package by itself.**

Rejected on the way (and not to be re-proposed): a Raspberry Pi counter camera
and USB scale, seal-and-weigh, an AI item list, a signature at handover, and a
"Something's wrong" button after delivery.

## 1. Decisions

1. **A flight is a container with `shipMode: "air"`** and an air waybill
   number. Same labels, loading by scan, statuses and WhatsApp updates as a sea
   container. Consoles and app say **"Shipment"** for an air container and
   "Container" for sea. No separate Flights page.
2. **Her own agent in Guinea hands packages over** with the app, using the
   existing free **Deliveries** permission (scan, enter the pickup code, record
   USD collected, mark delivered; never prices).
3. **Three switches in Business settings, all off by default:**
   *Photos required at drop-off*, *Ask the sender to confirm*, *Pickup code at
   delivery*. Air shipments, the pre-declaration link and the Deliveries login
   are available to every business.
4. **Sender confirmation right after drop-off:** a WhatsApp template with the
   first photo, the item list and two quick-reply buttons, **OK** /
   **Something's wrong**. No answer → the package ships as *Not confirmed*.
   *Something's wrong* → red flag on the package, a WhatsApp conversation opens
   with the business; loading the package **warns, never blocks**.
5. **Item list optional** (contents such as "2 phones, 1 tablet"), with an
   optional serial / IMEI per item. **Price typed by hand**; weight and
   declared value recorded. **The label prints code, QR, phones and weight —
   never the price or the declared value.**
6. **Handover = pickup code only.** The code is sent in the ready-for-pickup
   message. Without a code the agent can still deliver but must type who
   collected and take a photo; the package shows *Delivered without code*. The
   delivered message stays information-only.
7. **Photos:** private links in WhatsApp expire after 30 days; the public
   tracking page shows photos only to the signed-in sender or receiver; staff
   see them in the app and console. Photo files are deleted 12 months after
   delivery; the record, item list and serials are kept forever.
8. **Money: USD only.** The agent converts what they collect and enters USD.
9. **Pre-declaration:** the existing package-request link. The sender fills
   items, receiver and value before coming and gets a code (`R-XXXXX`); at the
   counter staff type or scan it and the package is pre-filled. The counter
   still works for walk-ins.
10. **Receivers can scan the label** → it opens WhatsApp with the code
    pre-filled → a photo they send files itself on the package.
11. **Three ticks per package:** drop-off photo · sender OK · delivered. One
    list shows the packages missing one.
12. **Customs list per flight**, printed from the declarations.
13. **Ships all at once:** server + console first, then the app build.

## 2. Data

### `containers/{id}` — new fields
| Field | Meaning |
|---|---|
| `shipMode` | `"sea"` (default when missing) \| `"air"` |
| `airWaybill` | air only. Digits and letters, `-` allowed, 6–20 chars, stored upper case. Required for an air container unless a `label` is given (same "one of" rule as sea: label / containerNumber / airWaybill). |
| `airline` | air only, optional, ≤ 60 chars |

Rules for air: `containerNumber` is ignored/cleared, no ISO check, no carrier
SCAC, **no Terminal49 tracking is ever started** (`shouldStartCarrierTracking`
returns false). Transitions are unchanged: loading → shipped → arrived. The
customer tracking page shows `shipping: {mode: "air", airline, airWaybill}`
instead of the ocean fields.

### `containerLines/{id}` — new fields
| Field | Meaning |
|---|---|
| `photoPaths` | `string[]`, ≤ 5, drop-off photos under `packagePhotos/{businessId}/{uid}/{fileId}` (the uploader's folder), or `.../req/...` copied from a request |
| `contents` | `[{label, quantity, serial}]`, ≤ 10 items; `label` ≤ 60, `quantity` 1–99, `serial` ≤ 40 (IMEI/serial, optional) |
| `weightLb` | number, 0.1–2000, one decimal. Printed on the label. |
| `declaredValueCents` | integer ≥ 0. Never printed. |
| `senderConfirmation` | `{status: "none"\|"asked"\|"confirmed"\|"problem", askedAtMs, answeredAtMs, wamid, note}` |
| `pickupCode` | 4 digits, minted with the line when the business switch is on (never `0000`) |
| `customerPhotos` | `[{path, phone, atMs, caseId}]`, ≤ 10, photos sent on WhatsApp with the code |
| `deliveredWithoutCode` | `true` when the override was used |
| `deliveredPhotoPath` | the override photo (same root, the agent's folder) |
| `collectedAtDeliveryCents` | USD collected at handover, also written as a `containerLinePayments` row (`method: "cash"`, `note: "At pickup"`) |

Derived (never stored): the three ticks — `photo` = `photoPaths.length > 0`,
`senderOk` = `senderConfirmation.status`, `delivered` = `deliveredAt`.

### `businesses/{id}.packageProofSettings`
`{photosRequired: bool, senderConfirm: bool, pickupCode: bool}`; missing = all
false (`package_proof.proofSettingsOf` / `validateProofSettings`). Saved by the existing owner-only `setPackageRequestSettings` callable
with an extra `proof` key (no new export: the CPU budget is full); a save
without `proof` keeps them; refusal `proof_settings_invalid`. Read back
from the business document itself (`businesses/{id}.packageProofSettings`,
readable by the business's managers under the existing rule) and echoed
as `proof` in the callable's answer.

### Storage
`packagePhotos/{businessId}/{uid}/{fileId}.(jpg|jpeg|png|webp)`, ≤ 2 MB,
`fileId` `[A-Za-z0-9_-]{8,64}`. Upload: the owner or staff with `containers`
or `deliveries`, into their **own uid folder** only (the line does not exist
yet when the photo is taken). Read: the same, plus platform ops admins.
Update/delete denied (the server deletes). The folders `wa` and `req` are
written by the server only. All rules are in `package_proof.js`
(`photoPathAllowed`, `photoMetadataValid`). **Add `deliveries` to `canReadBusinessContainers` in
storage.rules** — a deliveries-only agent must see the drop-off photos.

Customer WhatsApp photos are copied by the server from the support case media
to `packagePhotos/{businessId}/wa/{sha1(wamid)[0..24]}.{ext}`; request photos
to `packagePhotos/{businessId}/req/{requestId}_{n}.jpg`.

### Photo links (30-day expiry)
Served by the existing `/d` document endpoint (`parkingDocument`), new view:
`/d?view=photo&t={line.documentToken}&p={path}&e={expiresMs}&s={sig}` where
`sig = sha256(token + "|" + path + "|" + expiresMs).hex[0..24]`
(`package_proof.photoLink` / `photoLinkValid`). Expired or bad signature →
404; the endpoint streams the file with its content type and
`Cache-Control: private, max-age=3600`. The same link is the template image
header.

### Collections touched for messages
- `containerUpdates/{lineId}_sender_confirm` — the confirmation row,
  `update: "confirm"`, role `sender`. Queued **instead of** the sender's
  `received` row when `senderConfirm` is on (the receiver still gets
  `received`). Its wamid is stored as `whatsappMessageId` like every row.
- Button replies arrive as `type: "button"` with `button.payload`
  (`confirm_ok` / `confirm_problem`) and `context.id` = the confirm wamid.
  `parseWebhook` keeps `buttonPayload` as its own field.

## 3. WhatsApp templates (Utility, language `en`, bilingual body)
- **`package_confirm_2lang`** — header IMAGE (link), body 8 params:
  name · business · contents (EN) · weight (EN) · business · contents (FR) ·
  weight (FR) · tracking code. Quick replies: `OK ✓` (payload `confirm_ok`),
  `Something's wrong` (payload `confirm_problem`). No URL button.
  Body EN: "Hello {{1}}, {{2}} received your package: {{3}} ({{4}}). Is this
  right? Tap OK, or Something's wrong." FR: "Bonjour, {{5}} a reçu votre colis :
  {{6}} ({{7}}). Est-ce correct ? Appuyez sur OK ou Something's wrong."
  Footer: "Code {{8}}" is not allowed in footers → put the code in the body.
- **Pickup number:** Meta's classifier rejects any template that carries a
  "code to show" as an authentication message (two wordings tried on
  2026-10-29, both `INCORRECT_CATEGORY`). So there is no separate template:
  a line with a `pickupCode` sends the approved `shipment_ready_pickup_2lang`
  and the number rides in the address parameter — "Madina office · Pickup
  number / N° de retrait : 4821" (`container_updates.pickupAddressWithCode`).
  The receiver gets it; the sender only when the sender is the receiver.
- Reply text when the customer taps a button (free-form, inside the window):
  OK → "Thanks, noted. / Merci, c'est noté."; problem → "Sorry about that.
  {{business}} will reply here. / Désolé. {{business}} vous répondra ici."

## 4. Server behaviour (no new exports — action branches only)

1. **Containers:** `createContainer` / `updateContainer` accept `shipMode`,
   `airWaybill`, `airline`; `validateContainer` is mode-aware; `shouldStart
   CarrierTracking` is false for air; `guest_tracking.publicContainerShipping`
   returns the air variant; labels/manifest show "Shipment" for air.
2. **Lines:** `addWaitingPackage`, `addContainerLine`, `updateContainerLine`,
   `receivePackageRequest` accept `photoPaths`, `contents`, `weightLb`,
   `declaredValueCents`. Each `photoPaths` entry is checked against Storage
   metadata (size, content type, path belongs to this business and, on
   update, to this line) → refusal `photo_invalid`. When
   `packageProofSettings.photosRequired` and `source === "counter"` and no
   photo → refusal `photo_required`. `receivePackageRequest` copies the
   request's piece photos into `packagePhotos/{biz}/req/{requestId}_{n}.{ext}`
   (the source extension kept) and fills `photoPaths` ahead of what staff
   attached, 5 at most; the requirement never applies to a received request
   (its source is `request`, not `counter`). On an edit a path already on
   the line is kept without re-reading Storage (server folders included);
   a new path must be the caller's own upload.
3. **Pickup code:** minted on every new line of a business with
   `pickupCode` on (4 digits, crypto random, not `0000`), the part a split
   leaves waiting included (it also keeps the root's `photoPaths`: the
   drop-off photos show the whole drop-off). Not shown to the
   sender; shown to staff with the `containers` permission only; sent in the
   ready-for-pickup message to the **receiver** (and the sender when the
   sender is the receiver).
4. **Sender confirm:** on line creation, when `senderConfirm` is on and the
   line has a sender phone, queue `update: "confirm"` for the sender instead
   of `received` and set `senderConfirmation.status = "asked"`. The message is
   built at send time (`whatsappUpdateMessage`) with the first photo link as
   header (no photo → template without header is not allowed → fall back to
   the plain `received` row and leave status `none`).
5. **Inbound buttons:** in `handleInbound`, before routing, when
   `buttonPayload` is `confirm_ok` / `confirm_problem` and `replyToWamid` maps
   to a `containerUpdates` row with `update: "confirm"` → write
   `senderConfirmation` (`confirmed` / `problem`, `answeredAtMs`, `wamid`),
   append a system note on the line's `lastCustomerUpdate` is **not** needed;
   send the short free-form thanks; on `problem` also open (or reopen) the
   business's conversation for that phone with a system note "Sender reported
   a problem with package CL-…" so the thread shows up as *needs reply*.
   `confirm_ok` does **not** open a conversation.
6. **Inbound photos with a code:** after `appendInbound`, if the text (or
   caption) contains a tracking code (`scanCodeFrom` / `normalizeTracking
   Code`) that resolves to a line, copy the stored media to `packagePhotos`
   and append to `customerPhotos` (cap 10, oldest dropped from the array
   only, files kept until the sweep). Also use that line's business as the
   routing candidate when the number is otherwise unknown.
7. **Deliver action** (`updateContainerLine action: "deliver"`): new params
   `pickupCode` (string), `override {collectedBy, photoPath}`, and
   `collectedCents` (integer ≥ 0). When the business has `pickupCode` on and
   the line has one: a matching code → normal delivery; no/wrong code without
   override → refusal `pickup_code_invalid`; override → `deliveredWithoutCode:
   true`, `collectedBy` required (≥ 2 chars), `deliveredPhotoPath` required
   and validated. `collectedCents > 0` writes a `containerLinePayments` row in
   the same transaction (`deliveries` staff may do this; it is the one money
   action that permission allows), on the line's root, judged by the same
   rules as `recordContainerLinePayment` (`payment_exceeds_balance`,
   `price_required`), and sets `collectedAtDeliveryCents`. Balance warning
   rules unchanged, counted after the money collected now; `undo_delivery`
   clears `deliveredWithoutCode` / `deliveredPhotoPath` (the file stays)
   and never reverts the payment (the owner does, with the existing
   callable). The answer carries `deliveredWithoutCode`, `collectedCents`
   and `paymentId`.
8. **Loading warning:** `assignContainerLines` (`scan` and list) returns
   `warnings: [{lineId, reason: "sender_problem"}]` for lines with
   `senderConfirmation.status === "problem"`; the client confirms with
   `acknowledgeProblems: true` (same shape as the balance acknowledgement:
   until confirmed the call is refused `failed-precondition` with
   `reason: "sender_problem"`, `lineIds` and `warnings`; confirmed, the
   package goes on and the answer still carries `warnings`). Never a
   refusal of the package itself; a counted scan of a package already on
   warns no more.
9. **Customs list:** `getContainerDocumentUrl` with `view: "customs"` → the
   `/d` endpoint renders one table per container: code, sender, receiver,
   contents (with serials), weight, declared value. Letter portrait, printable.
   Needs the `containers` permission (money is on it).
10. **Request lookup by code:** `receivePackageRequest` (there is no
    `packageRequestAction` callable) gets `action: "lookup_code"`
    `{businessId, code}` → `{request: {id, ...the stored document without
    `token`}}` (the shape the Expected list reads straight from Firestore),
    whatever its status, or `not_found` (also for another business's code).
    The code is normalised (`package_requests.normalizeRequestCode`: upper
    case, spaces and dashes dropped, with or without `R-`). Staff with
    `containers` or `deliveries`. The console/app counter uses it to open
    the existing receive sheet pre-filled.
11. **Sweep:** `sweepPackageRequests` also deletes `packagePhotos` files of
    lines with `deliveredAt` older than 365 days, clearing `photoPaths`,
    `customerPhotos[].path` and `deliveredPhotoPath` and setting
    `photosDeletedAtMs`. ≤ 100 lines per run, visited in `deliveredAt`
    order from a cursor kept in `platformConfig/packagePhotoSweep`
    (`afterDeliveredAt`), so no composite index is needed and a cleaned
    line is never read again; a delivery undone and redone moves past the
    cursor and is visited again.
12. **Phone sign-in on the tracking page:** `lookupGuestTracking` returns
    `photos: [{url, kind: "dropoff"|"customer"|"delivered"}]` **only** when the
    caller is signed in as the line's sender or receiver (30-day links).

Refusal codes added (`package_proof.REFUSAL` holds the texts of the first
seven): `photo_invalid`, `photo_required`, `pickup_code_invalid`,
`override_incomplete`, `contents_invalid`, `weight_invalid`,
`declared_value_invalid`, `proof_settings_invalid`, `air_waybill_invalid`. Mirror them in the console and app
refusal maps (parity tests).

## 5. Clients

**Console** (`admin_web`): container form with Sea / Air choice, waybill +
airline fields, "Shipment" wording; line forms (waiting package, container
line, receive request) with photos (camera on phones, file picker on desktop,
compressed like request photos), contents, weight, declared value; three ticks
on Waiting rows, container line rows and the package staff view, plus a
"Missing proof" filter; Proof settings in the Requests settings dialog
(three switches); Mark delivered dialog with pickup code / override (name +
photo) / USD collected; counter "Enter the customer's code" lookup; Customs
list button on an air or sea container; tracking page air variant and photos
for the signed-in sender/receiver; `french-dom.ts` entries for every string.

**App** (`my_flutter_app`): the same, plus the Deliveries home for the agent
(today's arrivals, scan, code, collected, delivered) and camera capture at
drop-off. ARB keys in both languages.

## 6. Why these shapes
- No new Cloud Functions: the project sits at its 1000-CPU reserved budget
  (`test/scaling-contract.test.js`); every feature is an `action` on an
  existing callable or a new `view` on `/d`.
- `pieces[]` stay what they are (physical pieces with sizes and prices);
  `contents[]` is what is inside, for the sender's confirmation and customs.
- The confirmation replaces the sender's `received` message rather than adding
  one, so the sender gets one message at drop-off, not two.
- The pickup code goes to the receiver because the receiver collects.

## 7. Ships by: Sea · Air (owner, 2026-10-29, decision A)

The proof fields were shown on every package, even a barrel going by sea,
because a waiting package did not know whether it would fly or sail. Now
each package says how it ships.

- **`containerLines.shipMode`** — `"sea"` | `"air"`; missing = sea (every
  line from before). `addWaitingPackage` and `receivePackageRequest` take
  the chosen value (default sea; anything else is refused
  `ship_mode_invalid`). A line added straight onto a container
  (`addContainerLine`) takes the container's mode — no choice is shown.
  A split part keeps its line's mode.
- **Edit:** `updateContainerLine` (edit) changes `shipMode` only while the
  package waits; on a container it is refused `ship_mode_locked`. Clients
  never send `shipMode` for a line on a container.
- **`businesses/{id}.shipsByAir: true`** — set by `createContainer` /
  `updateContainer` the first time the business has an air container;
  never unset. There is no backfill: a business that created an air
  container before this field needs one more air create/update (or a
  one-off write) before its forms show the choice.
- **Forms** (console waiting form, receive-request dialog; app waiting
  sheet, receive sheet): with `shipsByAir`, a segmented **Ships by: Sea ·
  Air** on top (default Sea). Sea = the form without Photos / What's inside
  / Weight / Declared value; Air = the proof section. Without the flag: no
  choice, sea form. The container-line form shows the proof section only
  for an air container.
- **Photos required** (`packageProofSettings.photosRequired`) applies only
  to air counter drop-offs (`package_proof.photoRequirementRefusal` takes
  the line's `shipMode`). Sender confirmation needs a photo, so it follows;
  the pickup code is unchanged (any mode).
- **Loading:** `assignContainerLines` (list and scan), `moveContainerLine`
  and a scan move refuse a package whose mode differs from the container's:
  `ship_mode_mismatch`, `details: {reason, lineIds, shipMode}` (`shipMode`
  = the package's). Texts: sea package → "This package is marked to go by
  sea; this is a flight. Change the package's Ships by first."
  (`CONTAINER_MESSAGES.ship_mode_mismatch`); air package → "…by air; this
  is a sea container…" (`ship_mode_mismatch_air`). Checked after the
  destination. On a move, a line's mode is its container's.
- **Container mode change** (`updateContainer`, while loading): the lines
  on it take the new mode. A line sent back to waiting
  (`unassignContainerLine`, an undone scan) keeps its box's mode.
- **Lists:** waiting rows show an "Air" badge (plane) for air packages; the
  Waiting list has an Air/Sea filter only with `shipsByAir`. Labels and the
  customs list are unchanged.
