# Package requests, pieces and monthly volume

Owner decisions from the 2026-10-18 design interview. Screens:
https://claude.ai/artifact/QaVWBW2HvVzhsWSJQgxC6A (12 artboards, Laawol's
current look). This document is the contract; build against it.

Laawol charges shipping businesses per piece handled, not a cut of payments,
so customer requests never require online payment, and every physical piece
is counted.

## 1. Pieces on lines (the foundation)

- A **line** (`containerLines`) is one customer's load: one sender, one
  receiver, one destination country, **one tracking code** (`CL-…`).
- A line holds **pieces**: each physical thing handed over (a barrel, a box,
  a loose TV). Several things packed in one box are ONE piece.
- Each piece: `kind` (`barrel` | `box` | `other`; cars stay their own line
  kind `car`, always 1 piece), `description` (optional for barrels),
  optional size, `priceCents` (per piece, optional until staff set it).
- The line total = sum of piece prices. Payments stay per line (existing
  `containerLinePayments`, partial payments, received-by, methods).
- Labels: one per piece, "CL-K7M4P2 · 1 of 3", "2 of 3"… (thermal 4×6 and
  Letter sheets). One set of WhatsApp messages per line.
- **Existing data**: a legacy line `{kind:"barrels", quantity:4}` reads as 4
  barrel pieces; `{kind:"other", quantity:2, description}` as 2 `other`
  pieces with that description; `car` as 1 car piece. Read-compat in every
  reader; no bulk migration needed. New writes store `pieces[]` (and keep
  `kind`/`quantity` summary fields filled for old app versions:
  `kind` = "barrels" if all pieces are barrels, else "other"; `quantity` =
  piece count).
- **Counter form** (console + app): "+ Add another piece", price per piece,
  total; "Save & add another" is only for a different receiver/country.
- **Split across containers**: when adding a line to a container staff pick
  how many pieces go ("2 of 4"). The rest stay waiting as a linked part
  with the same code + "-2" (`CL-K7M4P2-2`, then -3…), same customer,
  receiver, payments stay on the original line (balance shown on both),
  new labels for the part that stays. Each part gets its own
  departed / ready-for-pickup messages; the "what" variable reads
  "2 of your 4 pieces" / "2 de vos 4 colis". The tracking page for either
  code shows all parts.
- **receivedAt**: set when the pieces are physically received (counter
  registration = now; a request = when staff tap Received). Monthly counts
  use it (§5). Legacy lines: `createdAt`.

## 2. Customer requests

- Two kinds, named "Bring it in" (FR "Je l'apporte") and "Collect from me"
  (FR "Venez le chercher"). Page/app text is in ONE language chosen by the
  existing language picker; only WhatsApp messages are bilingual.
- Where: website `customer.laawoldigital.com` (no account; name + WhatsApp
  number) and the Laawol app (signed-in customers also see their requests).
  Per-business link `laawoldigital.com/r/<slug>` (+ printable QR) opens the
  form with that business chosen.
- Flow: country first → businesses that ship there and accept requests →
  bring/collect → sender (name, WhatsApp) → receiver (name, phone) →
  pieces (kind, description, optional photos up to 5) → send.
- Bring it in: choose the business location (if several) and a planned day
  (a plan, not an appointment; any time in opening hours).
- Collect from me: pickup address, preferred day, time window
  (morning / afternoon / evening), optional note. The business sets the real
  time and any pickup fee in its estimate. Only businesses with "We pick
  up" on (with the areas they cover) offer it.
- A request goes ONLY to the chosen business.
- Which businesses appear: "Accept package requests" ON, destination
  country active, and opening hours set (bring) or "We pick up" ON (collect).

### Estimates
- Barrels: the business's per-barrel price for that destination is the
  estimate (no quote step needed, but staff may still edit it).
- Other pieces: staff write an estimate per piece in the business app or
  console. All staff with the Containers permission are alerted (push + bell).
- Lock: one person writes an estimate at a time ("Mariama is writing the
  estimate"); the lock expires after 15 minutes of inactivity or on send.
- History records who sent each estimate version.
- Estimates are editable any time. If the total goes UP after the customer
  confirmed, the request returns to "waiting for your confirmation" and the
  customer must confirm again; if it goes down, the customer is only told.
- The final price is set by staff at the counter (or at pickup); the
  estimate never binds the business.

### Confirmation
- New WhatsApp template (bilingual, UTILITY, URL button
  `https://customer.laawoldigital.com/e/{{1}}` with a request token):
  "your estimate is ready". The page shows pieces, prices, total, where to
  bring it / pickup time, phone, and a Confirm button (+ "No thanks").
- Reminder WhatsApp after 24 h unconfirmed (same template or a reminder
  template), once.
- Staff can confirm on the customer's behalf ("Customer agreed by phone",
  recorded in History with who).
- Confirmed requests appear in the Waiting list as **Expected**
  (bring: "planned Sat, Oct 24"; collect: "Tue morning, address").
- One WhatsApp reminder 3 days after the planned day if not received; the
  request **expires after 30 days**. Staff can cancel any time. Expired /
  cancelled / declined requests are never counted.

### Payment
- The customer pays at drop-off or when the business collects; staff record
  it on the line as today. No online payment in this flow.
- Exception: a business that keeps card booking for barrels (setting) lets
  the customer choose pay-now-by-card for barrels; those orders also land
  in the Waiting list as "Expected — paid online" (today's barrelOrders
  flow feeds the same list instead of its separate one).
- The tracking page shows final price, paid and balance.

### Photos
- Optional, up to 5 per piece (images only, compressed client-side, max
  ~1.5 MB each after compression), visible only to that business's staff,
  deleted 90 days after the line is ready for pickup or the request is
  cancelled/expired/declined.

### Received
- Staff tap "Received" on an Expected request: they confirm the final price
  per piece (prefilled from the estimate), optionally record payment; this
  creates/updates the line with `receivedAt`, prints labels, and sends the
  bilingual "received" WhatsApp.

## 3. Business settings
- "Accept package requests" on/off.
- Opening hours per location (days + from/to; closed days).
- "We pick up" on/off + areas covered (free text or borough/city list).
- Card payment for barrels on/off (default off).
- Request link slug (auto from business name, unique, editable once).

## 4. Edge cases (must be handled and tested)
- Two staff estimate at once → second sees the lock; lock steals after 15
  min idle; sending re-checks the lock in a transaction.
- Customer confirms an estimate that was just changed → confirm applies
  only to the version shown (version id in the confirm link/request);
  a stale version shows "This estimate changed — see the new one".
- Customer confirms twice / after expiry / after cancel → idempotent; clear
  message on the page.
- Price goes up after confirm → back to awaiting confirmation; down → stays
  confirmed, customer told.
- Customer's WhatsApp number not on WhatsApp / message fails → request
  still visible to staff with "Customer not reachable on WhatsApp"; staff
  can call and confirm by phone.
- Business turns off "Accept requests" or deactivates the destination while
  requests are open → existing requests continue; no new ones.
- Business has no opening hours → not listed for "Bring it in".
- Spam / abuse: rate limit per phone and per IP (e.g. 5 requests/hour/phone),
  App Check, max 20 pieces per request, text length limits, photo type/size
  checks; unconfirmed requests expire.
- Phone numbers: E.164 via the shared country-code picker (sender usually
  +1, receiver the destination's code); the picker bug fix applies.
- Split line: payments and balance stay on the original line; cancelling a
  part; a part shipped while the original still waits; tracking page shows
  all parts; counts count pieces once.
- Line edited after receipt (pieces added/removed): counts follow current
  pieces; History records the change.
- Legacy lines without pieces[] everywhere (labels, counts, tracking page,
  WhatsApp "what").
- Request for a destination the business no longer ships to at estimate
  time → staff can decline with a reason.
- Time zones: planned days and reminders use the business's local time
  (America/New_York default); display dates month-first, 12-hour (US).
- Language: page language from the picker; WhatsApp always bilingual.
- Barrel price missing for a destination → treat barrel like other (needs
  estimate).
- Deleted business / staff → History keeps names.

## 5. Monthly volume
- Counted unit: **pieces** (all kinds), split barrels / packages (box +
  other) / cars, plus customer lines as a secondary number.
- A piece counts in the month its line was **received** (`receivedAt`,
  business time zone). Containers count in the month they **shipped**
  (`sailedAt`).
- Admin console: month picker, totals, per-business table (barrels,
  packages, cars, pieces, containers shipped, avg pieces/container),
  click a business → its containers that month with pieces by kind,
  12-month trend, CSV download.
- Each business console (and app summary) shows its own monthly numbers.
- Implementation: server-side callable(s) with count/aggregate queries or a
  per-business monthly counter doc maintained transactionally on
  receive/ship/edit (preferred for cost); new indexes as needed.

## 6. Build phases
1. Pieces on lines: model + read-compat, counter form (console + app),
   labels "1 of N", split across containers, `receivedAt`, WhatsApp "what"
   for pieces/parts, tracking page.
2. Requests: business settings, customer request page + app, photos,
   estimates + lock + history, estimate template + confirm page + reminders
   + expiry, Expected in Waiting list + Received, request link + QR, card
   barrels into the Waiting list.
3. Monthly volume: counters + admin view + business view + CSV.

## 7. Addenda (2026-10-18, after the screens were approved)

Where this section and the sections above disagree, the sections above win
(cars are their own line kind; lock 15 min; ≤20 pieces; photos ≤5 per piece).

### Line fields (phase 1)
- `pieces[] {id, kind: barrel|box|other, description, sizeIn?: {l,w,h}, priceCents|null}`;
  cars keep `kind: car` lines with one implicit piece.
- Denormalized counts for cheap counting: `pieceCount`, `barrelPieces`,
  `packagePieces` (box + other), `carPieces`.
- `source: counter | request | card_order`, `requestId`, `receivedAt`.
- Split groups: `rootLineId` (root: its own id), `partIndex` (root 1).
  Payments stay on the ROOT line; paid/balance are shown for the whole group.
  A part can be split again (`-3`…); moving a part back to waiting never
  re-merges. Container tallies count the pieces actually in that container.

### Request document (`packageRequests/{id}`, server-only writes)
`businessId`, `code` (R-XXXXX, unique), `token` (≥128-bit; the `/e/<token>`
link — never the code alone), `handoff: bring_in|collect`, `locationId` +
`plannedDate` | `pickup {address, date, window, note}`,
`sender {name, phoneE164, uid?}`, `receiver {name, phoneE164}`,
`destinationCountryId`, `pieces[] {id, kind, description, sizeIn?, photoPaths[], estimateCents|null}`,
`status: new | estimate_sent | confirmed | received | declined | customer_declined | cancelled | expired`,
`estimate {version, totalCents, pieces[{id,cents}], pickupFeeCents?, note, sentByUid, sentByName, sentAt}`,
`estimateHistory[]`, `confirmedVersion`, `confirmedAt`,
`confirmedVia: link | staff_phone | card`, `lock {uid, name, until}`,
`reminders {estimate24hAt?, dropoff3dAt?}`, `expiresAt`, `lineId`,
`payment {timing: at_handoff | card, paidCents?}`, `language`,
`idempotencyKey` (same key within 10 min returns the first request),
`declineReason`, `createdAt`, `updatedAt`.

### Timers
- Unconfirmed estimate: one reminder at 24 h; expires 14 days after the last
  version was sent.
- Never estimated (`new`): staff alert at 3 days; expires at 30 days.
- Confirmed bring_in: one drop-off reminder 3 days after `plannedDate`;
  expires 30 days after `plannedDate` (or confirmation, whichever later).
- Collect: no customer reminder (the business owes the pickup).
- Decline/cancel: reason required; no WhatsApp (no template) — shown on the
  `/e/` page and in the app.
- Card barrel orders: Stripe refund/cancel → request `cancelled`.
- Anonymous web requests are not merged into an app account by phone.
- `requestSlug`: unique, `[a-z0-9-]{3,40}`.

### WhatsApp templates (submitted 2026-10-18, pending review)
- `package_estimate_2lang`: 1 name, 2 business, 3 total EN, 4 pieces EN,
  5 destination EN, 6 business, 7 total FR, 8 pieces FR, 9 destination FR,
  10 request code; button `https://customer.laawoldigital.com/e/{{1}}`
  (token). Used for the first estimate, every new version, and the 24 h
  reminder.
- `package_dropoff_reminder_2lang`: 1 name, 2 business, 3 pieces EN,
  4 hours EN, 5 business, 6 pieces FR, 7 hours FR, 8 request code; button
  `/e/{{1}}`.
- Sends wait (waiting_for_template on Meta 132001) until approved.

## 8. API contract (phase 2)

The contract every client (customer website, business console, Flutter app)
builds against. Server: `my_flutter_app/functions` — pure rules in
`package_requests.js`, the line the "Received" tap writes in
`request_receive.js`, callables and the sweep in `index.js`. If this section
and the code disagree, the code is wrong: fix it, or change both together.

### 8.1 Conventions

- Every callable is an `onCall` with `{enforceAppCheck, cors: true,
  invoker: "public"}` (App Check enforced in production; the emulator skips
  it). `listPackageRequestOptions`, `getPackageRequestByToken`,
  `confirmPackageEstimate` and `declinePackageEstimate` need no sign-in (the
  token is the capability; they are rate-limited per address). Every other
  callable needs a signed-in caller (`unauthenticated` otherwise); a web
  customer with no account signs in **anonymously** before uploading photos
  and submitting (`signInAnonymously`), exactly as guest checkout does.
- Money is US dollars in **whole cents** (int). Dates a person picks are
  `"YYYY-MM-DD"` strings in the **business's time zone**
  (`America/New_York` unless the business's settings say otherwise).
  Timestamps in callable responses are ISO-8601 strings; in Firestore they
  are Timestamps.
- Phones are E.164 (`^\+[1-9]\d{7,14}$`), entered with the shared country
  picker (`customer-phone-field.tsx` / `country_phone_field.dart`).
- Refusals are `HttpsError`s with an English `message` and
  `details.reason` (one code). Validation failures are `invalid-argument`
  with `details.reasons: string[]` (every problem at once) and
  `details.reason` = the first one. Clients map the code to their own copy
  (both languages); never show `message` raw to a French reader.
- Staff callables take `{businessId, requestId, ...}` and need the
  **containers** section (`requireBusinessPermission`; owners and admins
  hold every section). `permission-denied` otherwise; a request of another
  business is `not-found` `request_not_found`.

### 8.2 Statuses

| status | meaning | open? |
| --- | --- | --- |
| `new` | sent by the customer, no estimate yet (some piece has no price) | yes |
| `estimate_sent` | an estimate version is waiting for the customer | yes |
| `confirmed` | the customer (or staff by phone, or a card payment) agreed: **Expected** in the Waiting list | yes |
| `received` | staff tapped Received; `lineId` names the `containerLines` line | no |
| `declined` | the business declined (`declineReason`) | no |
| `customer_declined` | the customer said "No thanks" | no |
| `cancelled` | staff cancelled (`declineReason`), or the card order was refunded/cancelled | no |
| `expired` | a timer ran out (§7 Timers) | no |

A request whose pieces are **all barrels with a barrel price** for the
destination is created already `estimate_sent` with an automatic version 1
(`estimate.auto: true`, `sentByName: ""`), and its estimate WhatsApp is
queued at once. A barrel with no price for the destination is a piece that
needs an estimate (`estimateCents: null`).

### 8.3 Firestore

`packageRequests/{requestId}` — **server writes only** (`allow write: if
false`). Read by: the business's people with the containers section
(`canManageBusinessSection(uid, businessId, 'containers')`, so a staff query
must filter `where businessId == b`), platform admins, and the signed-in
customer who sent it (`sender.uid == auth.uid`; anonymous web senders have
no `sender.uid` and read through `getPackageRequestByToken`). Fields:

| field | type | notes |
| --- | --- | --- |
| `businessId`, `businessName` | string | name is a snapshot for lists |
| `code` | string | `R-XXXXX` (5 of `23456789BCDFGHJKMNPQRSTVWXYZ`), unique |
| `token` | string | 43-char base64url (256 bits); the `/e/<token>` link |
| `handoff` | `bring_in` \| `collect` | |
| `locationId`, `location` | string, `{id, label, address}` | bring_in only; snapshot of the drop-off |
| `plannedDate` | `"YYYY-MM-DD"` \| `""` | bring_in only |
| `pickup` | `{address, date, window, note}` \| null | collect only; `window`: `morning` \| `afternoon` \| `evening` |
| `sender` | `{name, phoneE164, uid?}` | `uid` only for a non-anonymous caller |
| `receiver` | `{name, phoneE164}` | |
| `submittedByUid` | string | the session that sent it (owner of its photo uploads) |
| `destinationCountryId`, `destinationCountryName` | string | |
| `pieces[]` | `{id, kind, description, sizeIn, photoPaths[], estimateCents}` | `id` `p1`…`p20`; `kind` `barrel` \| `box` \| `other`; `sizeIn` `{l,w,h}` inches or null; `estimateCents` int \| null (prefill: barrel price) |
| `pieceCount`, `barrelPieces`, `packagePieces` | int | box + other = packages |
| `status` | §8.2 | |
| `estimate` | `{version, totalCents, pieces[{id,cents}], pickupFeeCents, pickupSchedule, note, sentByUid, sentByName, sentAt, sentAtMs, auto}` \| null | latest version; `pickupSchedule` `{date, window}` \| null (collect) |
| `estimateHistory[]` | same shape | every version ever sent, oldest first |
| `confirmedVersion`, `confirmedAt`, `confirmedVia` | int \| null, Timestamp \| null, `link` \| `staff_phone` \| `card` \| "" | |
| `confirmedTotalCents` | int \| null | total of the confirmed version |
| `priceDropped` | bool | a version at or below the confirmed total was sent after confirmation (request stayed confirmed; the `/e/` page says so) |
| `lock` | `{uid, name, untilMs}` \| null | estimate lock; live while `untilMs > now` |
| `reminders` | `{estimate24hAt?, dropoff3dAt?, staffAlert3dAt?}` | each sent at most once |
| `expiresAt` | Timestamp \| null | when an open request expires (§7 Timers) |
| `nextAction`, `nextActionAt` | string, Timestamp \| null | server timer bookkeeping (ignore in clients) |
| `lineId`, `trackingCode`, `receivedAt` | string, string, Timestamp | set by Received |
| `payment` | `{timing: at_handoff \| card, paidCents}` | card = paid online (card barrel order) |
| `cardOrder` | `{orderId, shipmentId}` \| null | card barrel orders only |
| `language` | `en` \| `fr` | the page language the customer used |
| `idempotencyKey` | string | |
| `declineReason` | string | decline / cancel / customer's "No thanks" note |
| `whatsapp` | `{update, status, error, atMs}` \| null | the last request message's state (`containerUpdates` statuses) |
| `whatsappUnreachable` | bool | the last request message failed for good: show "Customer not reachable on WhatsApp" |
| `history[]` | `{atMs, action, byUid, byName, version?, totalCents?, reason?, piecesAdded?, piecesRemoved?}` | newest last, capped at 100; `action`: `submitted`, `estimate_sent`, `confirmed_link`, `confirmed_phone`, `confirmed_card`, `customer_declined`, `declined`, `cancelled`, `expired`, `pieces_changed`, `received`, `lock_taken_over`, `reminder_sent` |
| `closedAt` | Timestamp \| null | when it left the open statuses |
| `createdAtMs`, `confirmedAtMs`, `receivedAtMs`, `closedAtMs`, `expiresAtMs` | int | epoch ms twins of the Timestamps (0 when unset), so pure code and clients can compare without a Timestamp |
| `timeZone` | string | the business's zone when the request was sent |
| `photosDeletedAt` | Timestamp \| null | |
| `createdAt`, `updatedAt` | Timestamp | |

Queries the clients run (indexes in `firestore.indexes.json`):
- Console/app Requests and Expected: `packageRequests where businessId == b and status in ["new","estimate_sent","confirmed"] orderBy createdAt desc` (index `businessId, status, createdAt desc`).
- App "My requests": `packageRequests where sender.uid == uid orderBy createdAt desc` (index `sender.uid, createdAt desc`).

Business settings live on `businesses/{id}` (already server-write only;
read by the business's people) and are written only by
`setPackageRequestSettings`:

| field | type |
| --- | --- |
| `requestSlug` | string, `[a-z0-9-]{3,40}`, unique (claim doc `packageRequestSlugs/{slug}` = `{businessId}`) |
| `requestSlugEdits` | int, 0 or 1 (the owner may change the slug once) |
| `packageRequestSettings.acceptRequests` | bool |
| `packageRequestSettings.openingHours` | `{[locationId]: {mon..sun: {open: bool, from: "HH:MM", to: "HH:MM"}}}`; location ids are active `officeLocations` ids, or `default` for the headquarters address when the business has none |
| `packageRequestSettings.pickup` | `{enabled: bool, areas: string}` (areas ≤ 300 chars, required when enabled) |
| `packageRequestSettings.cardBarrelBooking` | bool, default false |
| `packageRequestSettings.timeZone` | IANA zone, default `America/New_York` |

Server-only bookkeeping (no client access): `packageRequestSlugs/{slug}`,
`packageRequestCodes/{code}`, `packageRequestKeys/{hash}` (idempotency).

WhatsApp rows for requests use the existing queue,
`containerUpdates/req_{requestId}_{update}`, with `requestId`, `lineId: ""`,
`role: "sender"`, `update` = `estimate_v{n}` | `estimate_reminder` |
`dropoff_reminder`, and the same statuses (`queued` → `sent`,
`waiting_for_whatsapp`, `waiting_for_template` until Meta approves, …).
Readable by the business's people as today.

### 8.4 Storage (photos)

Path: `packageRequestPhotos/{businessId}/{uploaderUid}/{fileId}` where
`fileId` is `[A-Za-z0-9_-]{8,64}` plus `.jpg`/`.jpeg`/`.png`/`.webp`.
- **Upload** (before submitting): the customer's own session — an anonymous
  one on the website, the account on the app — uploads each compressed
  image (≤ 1.5 MB target; the rule refuses ≥ 2 MB; `image/jpeg`,
  `image/png` or `image/webp` only) to its own `uploaderUid` folder.
  `create` only (no overwrite, no delete).
- **Submit** passes the paths per piece (`photoPaths`, ≤ 5 per piece). The
  server refuses (`photo_invalid`) a path outside
  `packageRequestPhotos/{businessId}/{callerUid}/`, a missing file, or a
  wrong type/size, then tags each file with `metadata.requestId`.
- **Read**: the uploader, the business's owner and staff with the
  containers section (token claims), operations admins.
- **Deleted** by the server 90 days after the line is ready for pickup, or
  after the request was declined / customer-declined / cancelled / expired.

### 8.5 Customer callables

#### `listPackageRequestOptions`
`{slug?: string}` → `{business: Business | null, options: Option[]}`.
Without `slug`: every eligible business × destination. With `slug`: only
that business (`business` filled for the preselected header; `not-found`
`business_not_found` for an unknown slug; a business that stopped accepting
returns `business` with `options: []` and `business.acceptRequests: false`).
Eligible: business `approved`, `acceptRequests` on, destination
`isActive == true`, and at least one handoff available.
```
Business = {businessId, name, phone, profileImageUrl, slug, acceptRequests}
Option = {businessId, businessName, businessPhone, profileImageUrl, slug,
  country: {id, name},
  barrelPriceCents: int | null,          // null: barrels need an estimate
  cardBarrelBooking: bool,               // offer "pay now by card" (barrels only)
  bringIn: {available: bool, locations: [{id, label, address,
    hours: {mon..sun: {open, from, to}}}]},   // only locations with hours
  collect: {available: bool, areas: string},
  timeZone: string}
```

#### `submitPackageRequest`
```
{businessId, destinationCountryId, handoff: "bring_in"|"collect",
 locationId?, plannedDate?,                       // bring_in
 pickup?: {address, date, window, note?},         // collect
 sender: {name, phoneE164}, receiver: {name, phoneE164},
 pieces: [{kind: "barrel"|"box"|"other", description?, sizeIn?: {l,w,h},
           photoPaths?: string[]}],               // 1..20
 language: "en"|"fr", idempotencyKey: string}     // key: 8..80 [A-Za-z0-9_-]
```
→ `{success, requestId, code, token, status, totalCents | null, replayed}`.
The same `idempotencyKey` from the same session within 10 minutes returns
the first request (`replayed: true`) and writes nothing. Limits: 5 requests
per hour per sender phone, 20 per hour per address (IP), App Check.
Refusals:
- `failed-precondition`: `business_unavailable` (missing / not approved),
  `requests_off`, `destination_unavailable`, `bring_in_unavailable` (no
  location with hours), `collect_unavailable`.
- `invalid-argument` (`details.reasons`): `handoff_invalid`,
  `location_invalid`, `planned_date_invalid` (not today..+60 days in the
  business's zone), `planned_day_closed` (the location is closed that
  weekday), `pickup_address_required`, `pickup_date_invalid`,
  `pickup_window_invalid`, `sender_name_required`, `sender_phone_invalid`,
  `receiver_name_required`, `receiver_phone_invalid`, `pieces_required`,
  `too_many_pieces` (> 20), `piece_kind_invalid`,
  `piece_description_required` (box/other), `text_too_long` (name 80,
  description 120, address 200, note 300), `size_invalid` (0 < n ≤ 600, all
  three or none), `too_many_photos` (> 5 per piece), `photo_invalid`,
  `language_invalid`, `idempotency_key_invalid`.
- `resource-exhausted` `rate_limited`.

#### `getPackageRequestByToken`
`{token}` → `{request: PublicRequest}`; `not-found` `request_not_found`.
Rate-limited per address. The projection holds no phone numbers of the
customer:
```
PublicRequest = {id, code, status, handoff, language,
  business: {id, name, phone},
  destination: {id, name},
  location: {id, label, address, hours} | null, plannedDate,
  pickup: {address, date, window, note} | null,
  sender: {name}, receiver: {name},
  pieces: [{id, kind, description, sizeIn, photoCount}],
  estimate: {version, totalCents, pieces: [{id, cents}], pickupFeeCents,
    pickupSchedule, note, sentAt} | null,
  confirmedVersion, confirmedAt, confirmedVia, priceDropped,
  declineReason, expiresAt,
  payment: {timing, paidCents}, trackingCode, receivedAt, timeZone}
```
Page states: `estimate_sent` (Confirm / No thanks), `new` (waiting for the
estimate), `confirmed` (+ `priceDropped` info), `received` (tracking code
link `/t/<code>`), `declined` / `cancelled` (+ reason), `customer_declined`,
`expired`.

#### `confirmPackageEstimate`
`{token, version: int}` → `{success, status: "confirmed", confirmedVersion,
alreadyConfirmed: bool}`. `version` is the version the page showed.
- Already `confirmed` → success with `alreadyConfirmed: true` (nothing is
  written).
- `estimate_sent` and `version != estimate.version` → `failed-precondition`
  `estimate_changed` with `details.currentVersion` ("This estimate changed —
  see the new one").
- `new` (nothing to confirm) → `failed-precondition` `estimate_missing`.
- Closed → `failed-precondition` `request_closed` with `details.status`.

#### `declinePackageEstimate`
`{token, reason?}` (reason ≤ 300) → `{success, status: "customer_declined"}`.
Open requests only (`request_closed` otherwise; idempotent when already
`customer_declined`). Card-paid requests: `card_order` (cancel the card
order instead).

### 8.6 Business callables

#### `setPackageRequestSettings` (owner or admin only)
`{businessId, acceptRequests: bool, openingHours, pickup: {enabled, areas},
cardBarrelBooking: bool, requestSlug?: string}` → `{success, requestSlug,
requestLink, settings}`. The slug is assigned from the business name on the
first save when none exists; sending a different `requestSlug` changes it
once. `permission-denied` for staff. Reasons (`invalid-argument` unless
noted): `slug_invalid`, `slug_taken` (`already-exists`), `slug_locked`
(`failed-precondition`, already changed once), `hours_invalid`,
`location_unknown`, `pickup_areas_required`, `text_too_long`.
Turning `acceptRequests` off (or deactivating a destination) never touches
open requests: they continue; only new submissions are refused.
`requestLink` = `https://laawoldigital.com/r/<slug>` (redirects to
`https://customer.laawoldigital.com/r/<slug>`).

#### `getPackageRequestLinkQr`
`{businessId}` → `{url, pngDataUrl}` (a 1024 px PNG QR of the link). Needs
the containers section. `failed-precondition` `slug_missing` before the
first settings save.

#### `startPackageEstimate`
`{businessId, requestId, takeover?: bool}` → `{success, lock: {uid, name,
untilMs}, version}` (current estimate version, 0 when none). Takes or
extends the lock for 15 minutes; call again (heartbeat, e.g. every 5
minutes while the editor is open) to keep it. Another person's live lock:
`failed-precondition` `estimate_locked` with `details.lockedByName`,
`details.untilMs`. An expired lock (15 minutes idle) is simply taken, and
the takeover is recorded in History. Closed requests: `request_closed`;
card-paid: `card_order`.

#### `releasePackageEstimate`
`{businessId, requestId}` → `{success}`. Drops the caller's own lock (no-op
otherwise).

#### `sendPackageEstimate`
`{businessId, requestId, baseVersion: int, pieces: [{id, cents: int}],
pickupFeeCents?: int, pickupSchedule?: {date, window}, note?: string}` →
`{success, version, status, totalCents, reconfirmRequired, priceDropped}`.
One transaction: nobody else may hold a live lock (`estimate_locked`);
`baseVersion` must equal the current version (`estimate_stale`,
`details.currentVersion`); status must be open and not card-paid
(`request_closed`, `card_order`). Every piece needs a price
(`estimate_piece_missing`; unknown ids `estimate_piece_unknown`; cents 0 ..
10,000,000 `amount_invalid`; `pickup_fee_invalid` (collect only);
`pickup_schedule_invalid`; note ≤ 300 `text_too_long`). Writes version + 1,
appends `estimateHistory` and History, releases the lock, and queues
`package_estimate_2lang`. Status after: `estimate_sent`, except a
`confirmed` request whose new total is **≤ the confirmed total** stays
`confirmed` (`priceDropped: true`; the message still goes so the customer
is told); a higher total sends it back to `estimate_sent`
(`reconfirmRequired: true`).

#### `confirmPackageRequestByPhone`
`{businessId, requestId, version: int}` → `{success, status: "confirmed",
alreadyConfirmed}`. "Customer agreed by phone": `estimate_sent` with
`version == estimate.version` (`estimate_changed` otherwise,
`estimate_missing` for `new`). `confirmedVia: "staff_phone"`, History names
who.

#### `declinePackageRequest` / `cancelPackageRequest`
`{businessId, requestId, reason}` (1..300 chars, `reason_required`) →
`{success, status}`. Decline: `new` / `estimate_sent` → `declined`
(`request_closed` for others). Cancel: any open status → `cancelled`.
Card-paid requests: `card_order` (refund the barrel order instead; that
cancels the request). No WhatsApp; the reason shows on the `/e/` page and
in the app.

#### `receivePackageRequest`
`{businessId, requestId, pieces: [{id, priceCents?: int | null} |
{kind, description?, priceCents: int | null}], payOnArrival?: bool,
payment?: {amountCents, method, receivedByStaffId, note?}}` → `{success,
lineId, trackingCode, paidCents, paymentId, alreadyReceived}`. Any open
status (a customer may walk in before confirming).
`pieces` is the load as it arrived: the request's pieces by `id` (a missing
`priceCents` keeps the estimate's price), pieces brought on top without an
id (`{kind: barrel|box|other, description, priceCents}`; the server gives
them the next ids, `p3`, `p4`, …), and request pieces left out did not come.
An absent or empty `pieces` keeps every request piece at its estimate. At
least one piece, at most 20. Refusals: `estimate_piece_unknown` (an id not
on the request, or twice), `price_invalid`, `piece_kind_invalid`,
`piece_description_required`, `text_too_long`, `too_many_pieces`,
`price_required`. Any change is written to History as `pieces_changed`
with `piecesAdded` / `piecesRemoved`, before the `received` entry. One transaction creates ONE `containerLines` line, waiting
(`containerId: ""`, `containerStatus: "waiting"`), with the counter's
fields plus `pieces[] {id, kind, description, sizeIn, priceCents}`,
`pieceCount`, `barrelPieces`, `packagePieces`, `carPieces: 0`,
`source: "request"` (`"card_order"` for card-paid), `requestId`,
`receivedAt`, `rootLineId` = its own id, `partIndex: 1`; `priceCents` = sum
of the piece prices (null when none is priced; `price_required` when some
but not all are); summary `kind` `barrels` when every piece is a barrel,
else `other`, `quantity` = piece count. The optional payment follows
`addWaitingPackage`'s rules and reasons. A card-paid request records its
online payment as a `containerLinePayments` row (`method: "other"`, note
"Paid online by card") and cannot also take `payment`. A second tap returns
the same line (`alreadyReceived: true`). Then the bilingual `received`
WhatsApp is queued for sender and receiver as for any new package.

### 8.7 Notifications (bell + push)

To the business owner (`ownerUid`) and every staff member of the business
with the containers section, through `sendPreferenceNotification`
(`preferenceKey: "businessActivity"`, push + inbox, no email/SMS):
`users/{uid}/notifications/{id}` = `{title, body, read: false, createdAt,
data}` with
```
data = {type: "package_request", event, requestId, businessId, code,
        relatedCollection: "packageRequests", relatedId: requestId}
event = "new" | "confirmed" | "customer_declined" | "stale_new" | "card_paid"
```
Title/body in the recipient's language (`recipientLanguage`). A tap opens
the Requests view (console: Containers → Requests) on that request.

### 8.8 Links and pages

- `https://laawoldigital.com/r/<slug>` → 302 to
  `https://customer.laawoldigital.com/r/<slug>` (public_site/.htaccess).
  The customer host rewrites `/r/<slug>` to `/?service=package-request&r=<slug>`
  and `/e/<token>` to `/?service=package-estimate&t=<token>`
  (admin_web/public/.htaccess, like `/t/`), and the iOS app claims `/e/*`
  and `/r/*` (admin_web/public/.well-known/apple-app-site-association).
- `https://customer.laawoldigital.com/r/<slug>`: the request form with that
  business chosen (also `?service=package-request&r=<slug>`).
- `https://customer.laawoldigital.com/?service=package-request`: the form
  from the country step.
- `https://customer.laawoldigital.com/e/<token>`: the estimate page (also
  `?service=package-estimate&t=<token>`); the WhatsApp button's URL.
- The web router reads both the path forms and the query forms; the
  not-found page also forwards `/r/<slug>` and `/e/<token>` to the query
  forms, for a host without the rewrite.
- Clients read the estimate page's data (business phone, opening hours of
  the drop-off location) through `getPackageRequestByToken`: the request
  document itself carries neither.

### 8.9 Scheduled work

`sweepPackageRequests` (every 60 minutes, America/New_York) processes
requests whose `nextActionAt` has passed (ordered, paged, under a deadline):
the 24 h estimate reminder (once), expiry 14 days after the last version,
the 3-day staff alert for `new` (once), expiry 30 days after creation for
`new`, the drop-off reminder (`package_dropoff_reminder_2lang`, bring_in,
3 days after `plannedDate` in the business zone, once), expiry of
`confirmed` 30 days after `plannedDate` / pickup date or confirmation,
whichever is later (card-paid requests do not expire), and photo deletion
(§8.4). Expiry writes `status: "expired"`, `closedAt`, History.

### 8.10 Card barrel orders

For a business with `cardBarrelBooking` on, the customer may pay barrels by
card through the existing barrel order (`createBarrelOrderPaymentIntent`).
When a `barrelShipments` record of that business becomes paid
(`paymentStatus` → `succeeded`), the server creates
`packageRequests/card_{shipmentId}`: `status: "confirmed"`,
`confirmedVia: "card"`, `payment {timing: "card", paidCents}`, the barrels
as pieces priced at the paid unit price, `cardOrder {orderId, shipmentId}`
— it shows in Expected as "Paid online". When that shipment is cancelled or
refunded (`status` or `paymentStatus` `cancelled`/`refunded`), the request
(if still open) becomes `cancelled`.
