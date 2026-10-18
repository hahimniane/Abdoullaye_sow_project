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
   for pieces/parts, tracking page. **Built 2026-10-18** (branch
   `feat/pieces`; contract and fields in docs/WAITING_PACKAGES.md "Pieces"
   and "Split across containers"; pure rules `functions/line_pieces.js`
   with console and app mirrors over one shared case file). Not yet
   deployed.
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
