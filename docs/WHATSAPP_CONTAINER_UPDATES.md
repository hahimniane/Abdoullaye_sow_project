# WhatsApp container updates

Everyone with goods on a container hears about them on WhatsApp: the
customer who handed the goods in (the **sender**) and the person collecting
them at the other end (the **receiver**). Each person gets at most four
messages per package, each **one bilingual message** (an English block, then
a French block):

| Moment | Template | Fires when |
| --- | --- | --- |
| `received` | `shipment_received_2lang` | The package is registered: dropped off to wait for a container (`addWaitingPackage`) or added straight onto one (`addContainerLine`). Assigning a waiting package to a box, or taking it off one, sends nothing. |
| `shipped` | `shipment_departed_2lang` | Staff mark the container **Shipped**, or the carrier feed reports it on the vessel — whichever comes first. |
| `arrived` | `shipment_ready_pickup_2lang` | Staff mark the container **Ready for pickup**. Only staff: the carrier's "discharged / available at the port" is recorded on the timeline and sends nothing, because a box at the port cannot be collected yet. |
| `confirm` | `package_confirm_2lang` | **Instead of** the sender's `received` when the business has *Ask the sender to confirm* on and the line has a drop-off photo (docs/AIR_PACKAGES.md §4.4): the first photo, the item list and weight, and two quick replies, **OK ✓** / **Something's wrong**. The receiver still gets `received`. Row `{lineId}_sender_confirm`; on the line's `lastCustomerUpdate` it counts as `received`. |
| `delivered` | `shipment_delivered_2lang` | Destination staff mark the **package** delivered (*Mark delivered*: the `deliver` action of `updateContainerLine`; docs/WAITING_PACKAGES.md "Delivered at destination"). Per line, like `received`. Undoing a delivery sends nothing, and a delivery repeated after an undo finds the rows already there, so nobody hears twice. |

### Delivered (2026-10-21)

`queuePackageDelivered` (index.js) queues one
`containerUpdates/{lineId}_{role}_delivered` row per person right after the
delivery transaction, through `queueContainerLineUpdate` and
`recipientsForLine` like every other update: the sender and the receiver,
once each (same number on both sides, or *Sender is the receiver*, is one
person), a US business's 10-digit local numbers messaged as +1, a person
switched off or with no country code skipped. A failure to queue is logged
and never fails the delivery. The message is built at send time from the
line: the day (`deliveredAt`, written "October 21, 2026" / "21 octobre
2026", read in UTC) and who collected it (`collectedBy`). A row whose line
is no longer delivered when its turn comes (the delivery was undone first)
is marked `failed` and says so. There is no legacy version: with
`WHATSAPP_TEMPLATE_SET=legacy` the delivered message is still
`shipment_delivered_2lang`. `delivered` ranks after `arrived` on the line's
`lastCustomerUpdate`.

### "Arrived" now means ready for pickup (2026-10-18)

The container's last status is still stored as `arrived` (no data
migration), but it now means **ready for pickup**: staff mark it only when
the goods can be collected. Every staff-facing label says so — "Ready for
pickup" / "Mark ready for pickup" in English, "Prêt à récupérer" /
"Marquer prêt à récupérer" in French — in the console, the app and the
public tracking page's last stage. For the same reason the carrier feed no
longer moves a container to `arrived` by itself; it only moves a loading box
to `shipped` when the vessel sails (`containerStatusFromCarrier` in
`container_updates.js`). The server writes the moment as "Ready for pickup"
and the History entry as "Marked ready for pickup" (older entries keep
"Marked arrived").

### Template set switch

The legacy one-language-per-message templates (`package_received`,
`container_departed`, `container_arrived`, below) are kept in the code as a
fallback. One environment variable picks the set, read at send time:

```
WHATSAPP_TEMPLATE_SET=bilingual   # default (unset or anything else)
WHATSAPP_TEMPLATE_SET=legacy      # the old per-language templates
```

To flip, put the line in `my_flutter_app/functions/.env` (or the
function's runtime environment) and redeploy `deliverContainerCustomerUpdate`,
`sendContainerCustomerUpdates` and `sendContainerCurrentStatus`. In the
legacy set the carrier's "at the port" sends `container_arrived` again, as
it did before. Rows waiting for a template are rebuilt at send time, so
after a flip the next sweep sends them with the other set.

Nothing is sent until the setup below is done. Until then every update is
recorded in `containerUpdates` with status `waiting_for_whatsapp`, so the
business can see who *would* have been told.

## How it works

1. **Received.** When a package is registered, `queuePackageReceived`
   queues one `containerUpdates/{lineId}_{role}_received` row per person,
   right after the line is written. A failure to queue is logged and never
   fails the registration (the client would register the package twice).
2. **Container moments.** A moment is written to
   `containers/{id}/trackingEvents`:
   - staff mark the container **Shipped** or **Ready for pickup** (`setContainerStatus`), or
   - the Terminal49 carrier feed reports it on the vessel, discharged, or
     available (`pollContainerTracking`, every 4 hours). Tracking starts by
     itself as soon as the container has a real ISO number
     (`startContainerCarrierTracking`); see *Carrier tracking and the
     shipping line* below.
3. Moments customers care about carry `customerUpdate` (`shipped`,
   `at_port`, `arrived`). The timeline keeps `at_port` as its own moment.
   With the bilingual templates it sends nothing (`messageUpdateFor` returns
   null); with the legacy ones it is the arrival's message. For each
   message `sendContainerCustomerUpdates` **queues** one row per person per
   line; it sends nothing itself.
4. Each message is one `containerUpdates/{lineId}_{role}_{update}` document
   (`update` is `received`, `shipped` or `arrived`), created only if it does
   not exist yet. Staff tapping Shipped and the carrier reporting `on_ship`
   are the same update: whoever comes first queues it and the other finds
   it already there.
5. `deliverContainerCustomerUpdate` sends each row on its own, as soon as the
   row becomes `queued` (see *The send queue* below). It builds the message
   at send time from the line, its container (for the destination), the
   business (for its name, address and phone) and, for ready for pickup,
   the business's destination record (for the pickup city, address and
   phone; see *Pickup details per destination* below).
6. A person is skipped (and the line says why) when they have no phone,
   staff switched them off, or the number has no country code.

Rows written before the arrival merge may still carry `update: "at_port"`;
in the legacy set they are sent (if ever re-queued) as `container_arrived`;
in the bilingual set they have no message (a box at the port is not ready
for pickup).

Each line carries `lastCustomerUpdate` — the latest update and, per person,
`queued`, `sent`, `retrying`, `failed`, `waiting_for_whatsapp` or `skipped`
(with the reason). The queue and the sender both update it, in the same
transaction as the row.

Rules live in `my_flutter_app/functions/container_updates.js` and are tested
in `test/container-updates.test.js` (pure rules and wiring) and
`test/container-callables.test.js` (against the Firestore emulator:
`npm run test:containers`).

## Carrier tracking and the shipping line

Terminal49 follows a container only when it knows the shipping line (its
SCAC). `startContainerCarrierTracking` uses the line staff chose
(`carrierScac` on the container) and otherwise asks Terminal49 to guess it
from the number. The guess fails for leasing-company prefixes (TCKU, TGHU,
CAIU…), which belong to no shipping line. The container is then stamped
`carrierTrackingError: "carrier_unknown"`.

- **Choosing the line.** The container form in the console and the app has
  an optional **Shipping line** picker. It lists the ocean carrier catalog
  (`admin_web/src/lib/ocean-carrier-catalog.ts`, mirrored by
  `functions/ocean_carrier_catalog.js` and the app's
  `lib/data/ocean_carrier_catalog.dart`). The empty choice is *Not sure —
  guess from the container number*. `createContainer` and `updateContainer`
  take `carrierScac`. It must be a catalog SCAC, or `""` to clear it;
  anything else is refused with `carrier_invalid`. A change is checked only
  when the value actually changes: a line Terminal49 filled in itself may be
  outside the catalog, and sending it back unchanged is fine. The line is
  not part of the declared list, so it stays editable after the container
  ships (that is when tracking matters most). A change is written to the
  container's History as `Changed carrierScac`.
- **When tracking is retried.** Every failed attempt records
  `carrierTrackingFailedFor` (the number) and `carrierTrackingFailedScac`
  (the line chosen at the time; `""` when it was guessed). The trigger
  skips a container only when **both** still match: the same number and the
  same chosen line. A new number, or a line chosen or changed after a
  failure, gets a new attempt. So choosing the line on a `carrier_unknown`
  container starts tracking. Failures recorded before this field existed
  read as "guessed", so they are not retried until someone chooses a line.
  A container already followed under its number (`trackingProvider:
  "carrier_api"` and `trackedContainerNumber` equal to the number) or one
  that has arrived is never retried. The rule is `shouldStartCarrierTracking`
  in `functions/container_manifest.js`, unit-tested in
  `test/container-manifest.test.js`.
- **What staff see.** While a container's tracking failed with
  `carrier_unknown` and no line is chosen, the console and the app show
  *Tracking couldn't find the shipping line — choose it to start tracking.*
  on the container and in its form. The public tracking page names the
  chosen line as soon as it is saved (`guest_tracking.js`, via
  `oceanCarrierName`), even before Terminal49 has found the container.

## The send queue

A `containerUpdates` row moves through:

| Status | Meaning |
| --- | --- |
| `waiting_for_whatsapp` | Recorded while WhatsApp was not connected. Never sent by itself. |
| `queued` | Waiting for the sender. Writing this status is what triggers a send. |
| `sending` | Claimed by one sender, with a lease (`leaseUntilMs`, 5 minutes). |
| `retrying` | The last try hit the network, a timeout, 429 or a 5xx; the platform delivers the event again with backoff. |
| `sent` | WhatsApp accepted it; `whatsappMessageId` is set. Never sent again. |
| `failed` | Meta refused it (any other 4xx; Meta's text is in `error`), or 5 tries were used up, or the event was more than 6 hours old. |

- The sender claims a row in a transaction (`queued`/`retrying` → `sending`),
  so two deliveries of the same event never both send.
- A sender that dies mid-send leaves `sending` behind. Once its lease has run
  out the row can be claimed again (by the platform's retry, or by
  `sendContainerCurrentStatus` below). The worst case is one duplicate
  message, never a row stuck for good.
- Each WhatsApp request gives up after 15 seconds, so a hung connection
  becomes a retry instead of holding the lease.
- `attempts` counts sends; after 5 the row is `failed`.

## Updates sent before WhatsApp was connected

They stay `waiting_for_whatsapp` and are **not sent automatically**. A
message about a container that sailed weeks ago is usually noise, so
customers start hearing from the next moment after connection onward.

When a business does want to catch everyone up on a container, the callable
`sendContainerCurrentStatus({businessId, containerId})` sends each person
the container's **current** update — the furthest one along its timeline
(`arrived` beats `shipped`; in the legacy set the carrier's `at_port`
counts as `arrived`), not every update it missed:

- It refuses (`failed-precondition`, `reason: whatsapp_not_configured`)
  until WhatsApp is connected, and (`reason: no_customer_update`) when the
  container has no customer news yet (it has not shipped). The drop-off
  `received` messages are per package, not a container moment, so this
  never re-sends them.
- For each person on each line: a `sent` row is left alone (nobody hears
  the same news twice); a `waiting_for_whatsapp` or `failed` row, or a
  `sending` row whose lease ran out, is queued again; a person with no row
  (a number added after the update) gets one; a row already `queued`,
  `retrying` or live `sending` is left to finish. Rows are refreshed with
  the line's current name and number.
- It returns `{update, queued, alreadySent, inFlight, skipped, waiting}`
  and writes a `customer_update_sent` entry to the container's history.
- Permission: the business's **containers** section (owners, and staff
  with that permission), like every other container callable.

There is no button for it in the console or the app yet.

## Pickup details per destination

Each business destination (`businesses/{id}/destinationCountries/{country}`)
has three optional fields, set by the owner (or staff with the
**destinations** permission) in the destination form of the console
(*Destinations* → edit a country → *Pickup in this country*) and of the app
(*Destination countries* → edit):

| Field | Example | Rule |
| --- | --- | --- |
| `pickupCity` | `Conakry` | One line, at most 80 characters. |
| `pickupAddress` | `Madina, near the market` | One line, at most 200 characters. |
| `pickupPhone` | `+224620000000` | E.164 (a plus, the country code, digits); entered with the shared country phone picker. |

They are written only by the callable
`setDestinationPickup({businessId, countryId, pickupCity, pickupAddress,
pickupPhone})` (permission: **destinations**; blank clears a field;
refusals `pickup_city_too_long`, `pickup_address_too_long`,
`pickup_phone_invalid`, `pickup_field_invalid`, `destination_not_found`).
The rules are in `functions/destination_pickup.js`, tested in
`test/destination-pickup.test.js` and against the emulator in
`test/container-callables.test.js`. The forms save the coverage first and
then call it, so a new destination exists before its pickup details.

The ready-for-pickup message reads them at send time from the destination
the line goes to (its own, else its container's):

| Variable | Source | Fallback |
| --- | --- | --- |
| pickup place (EN / FR) | `pickupCity` + the country's name ("Conakry, Guinea" / "Conakry, Guinée"); the country alone when no city | `the destination country` / `destination` |
| pickup address | `pickupAddress` | the business's own address (its headquarters, then `address`), else `—` |
| pickup phone | `pickupPhone` (re-checked: only an E.164 value is used) | the business phone, else `—` |

## Templates still in review

A template that Meta has not approved yet answers every send with error
`132001` ("template name does not exist in the translation"). Meta gives the
same code for a name that is still in review and for one that does not
exist, so this also covers the three bilingual templates submitted on
2026-10-18 and `shipment_delivered_2lang` (2026-10-21) — the check is by
error code, not by template name. Such a row is not failed: it becomes `waiting_for_template`, the
try does not count towards the 5-attempt limit, and the scheduled function
`requeueTemplateWaitingUpdates` (every 30 minutes) puts every waiting row back
to `queued`, which sends it again. The first sweep after Meta approves the
template sends everything that was waiting, with nobody re-queueing by hand.
A row that has waited more than 14 days is marked `failed` ("not approved
within 14 days"). `sendContainerCurrentStatus` treats a waiting row as on its
way. The console and the app show "waiting for WhatsApp to approve the
message". Rules: `container_updates.js` (`whatsappSendOutcome`,
`statusAfterAttempt`, `templateWaitDecision`), tested in
`test/container-updates.test.js`.

## One-time setup (platform admin)

### 1. Meta business verification

Status (2026-10-07): business portfolio **Laawol Digital LLC** (id 4527476690814512), Meta app **Laawol** (id 1850257899484218), test WhatsApp Business Account 3377183529120403.

Status (2026-10-16): the three legacy templates below, in English and French (six in all), are submitted in WhatsApp Business Account **992521863149970**.

Status (2026-10-18): the three bilingual templates (`shipment_received_2lang`, `shipment_departed_2lang`, `shipment_ready_pickup_2lang`; language `en`, category Utility) are submitted and **pending** review in the same account. A first submission with flag emojis (`*_bilingual`) was deleted; those names no longer exist and nothing sends them.

WhatsApp only lets a business start a conversation with a template Meta has
approved, and only after the Meta Business account is verified.

### 2. The templates

#### The bilingual templates (default)

Three templates, each registered **once, under language `en`**, category
**Utility**, whose body holds the English text, then a separator, then the
French text. Each has one button: *Visit website*, text `Track · Suivre`,
URL type **Dynamic**, `https://customer.laawoldigital.com/t/{{1}}`, whose
only parameter is the tracking code. Every person gets the same message,
whatever their phone's country. The French values (what, destination,
place) are built server-side in French, the English ones in English.

**What** (`describeLine` in `container_updates.js`, pieces rules in
`line_pieces.js`): a line with pieces names them ("2 barrels, 1 box" /
"2 barils, 1 carton"; items sharing one description as "2 × TV"); a part of a
package split across containers names its share of the whole, "2 of your 4
pieces" / "2 de vos 4 colis", read at send time from its group
(`rootLineId`). Each part gets its own departed and ready-for-pickup
messages (rows are keyed by line); a split itself sends nothing. Lines from
before pieces read as they always did ("3 barrels", "2 × tires", the car).

### `shipment_received_2lang`

Sent once per person when the package is registered (`received`).
Variables: {{1}} name, {{2}} business, {{3}} what (EN), {{4}} destination
(EN), {{5}} business, {{6}} what (FR), {{7}} destination (FR), {{8}}
tracking code.

```
Hello / Bonjour {{1}} 👋

*ENGLISH*
{{2}} has received your shipment of {{3}} going to {{4}}. We will message you here when it leaves and when it is ready for pickup.

—————
*FRANÇAIS*
{{5}} a bien reçu votre envoi de {{6}} à destination de {{7}}. Nous vous écrirons ici quand il partira et quand il sera prêt à récupérer.

🔎 Tracking code / Code de suivi : {{8}}

Tap the button below to follow it.
Appuyez sur le bouton ci-dessous pour le suivre.
```

Sample values: `Fatou`, `Dala Shipping`, `3 barrels`, `Guinea`,
`Dala Shipping`, `3 fûts`, `Guinée`, `CL-K7M4P2`.

### `shipment_departed_2lang`

Sent once per person when the container sails (`shipped`). Variables:
{{1}} name, {{2}} what (EN), {{3}} business, {{4}} destination (EN), {{5}}
what (FR), {{6}} business, {{7}} destination (FR), {{8}} tracking code.

```
Hello / Bonjour {{1}} 👋

*ENGLISH*
Your shipment of {{2}} from {{3}} has left and is on its way to {{4}}. We will message you again when it is ready for pickup.

—————
*FRANÇAIS*
Votre envoi de {{5}} confié à {{6}} est parti et fait route vers {{7}}. Nous vous écrirons quand il sera prêt à récupérer.

🔎 Tracking code / Code de suivi : {{8}}

Tap the button below to follow it.
Appuyez sur le bouton ci-dessous pour le suivre.
```

Sample values: `Fatou`, `3 barrels`, `Dala Shipping`, `Guinea`, `3 fûts`,
`Dala Shipping`, `Guinée`, `CL-K7M4P2`.

### `shipment_ready_pickup_2lang`

Sent once per person when staff mark the container ready for pickup
(`arrived`). Variables: {{1}} name, {{2}} what (EN), {{3}} business, {{4}}
pickup place (EN), {{5}} what (FR), {{6}} business, {{7}} pickup place
(FR), {{8}} pickup address, {{9}} pickup phone, {{10}} tracking code.

```
Hello / Bonjour {{1}} 👋

*ENGLISH*
Good news: your shipment of {{2}} from {{3}} is ready for pickup in {{4}}.

—————
*FRANÇAIS*
Bonne nouvelle : votre envoi de {{5}} confié à {{6}} est prêt à être récupéré à {{7}}.

📍 Pickup address / Adresse : {{8}}
📞 Phone / Téléphone : {{9}}
🔎 Tracking code / Code de suivi : {{10}}

Tap the button below to follow it.
Appuyez sur le bouton ci-dessous pour le suivre.
```

Sample values: `Fatou`, `3 barrels`, `Dala Shipping`, `Conakry, Guinea`,
`3 fûts`, `Dala Shipping`, `Conakry, Guinée`,
`Madina, near the market, Conakry`, `+224 620 00 00 00`, `CL-K7M4P2`.

Blanks in the bilingual templates: name → `Client` ("Hello / Bonjour
Client"), business → `Laawol`, what → `goods` / `marchandises`, destination
→ `its destination country` / `son pays de destination`, the pickup
fallbacks are in *Pickup details per destination* above, tracking code →
`-`.

### `shipment_delivered_2lang`

Sent once per person when destination staff mark the package delivered
(`delivered`). Variables: {{1}} name, {{2}} business, {{3}} what (EN),
{{4}} day (EN), {{5}} collected by, {{6}} business, {{7}} what (FR), {{8}}
day (FR), {{9}} collected by, {{10}} tracking code. A custom template (not
Meta's library), so no 30-character limit; blanks still fall back (name →
`Client`, business → `Laawol`, what → `goods` / `marchandises`, day → `the
day it was collected` / `le jour de son retrait`, collected by → `the
receiver` / `le destinataire`, code → `-`). Same button as the others:
*Visit website*, `Track · Suivre`, Dynamic,
`https://customer.laawoldigital.com/t/{{1}}` (the tracking code).

```
Hello / Bonjour {{1}} 👋

*ENGLISH*
{{2}} delivered your shipment of {{3}} on {{4}}. It was collected by {{5}}.

—————
*FRANÇAIS*
{{6}} a remis votre envoi de {{7}} le {{8}}. Il a été récupéré par {{9}}.

🔎 Tracking code / Code de suivi : {{10}}

Tap the button below to see its details.
Appuyez sur le bouton ci-dessous pour voir les détails.
```

Sample values: `Fatou`, `Dala Shipping`, `3 barrels`, `October 21, 2026`,
`Mamadou Bah`, `Dala Shipping`, `3 barils`, `21 octobre 2026`,
`Mamadou Bah`, `CL-K7M4P2`.

Created with `~/laawol-deploy-logs/create_delivered_template.py` (dry run
by default, `--submit` sends; language `en`, category **Utility**). Status
(2026-10-21): written, **not submitted**. Until Meta approves it every
delivered send answers `132001` and the row waits as `waiting_for_template`
(see *Templates still in review*): it does not use up an attempt, the
half-hourly `requeueTemplateWaitingUpdates` sweep retries it, and the first
sweep after approval sends every delivered message that was waiting (up to
14 days old). Nothing has to be re-queued by hand.

### `package_confirm_2lang`

The sender's confirmation (docs/AIR_PACKAGES.md §3–4), sent once to the
sender at drop-off **instead of** `shipment_received_2lang` when the
business has *Ask the sender to confirm* on and the line has a photo
(`queueContainerLineUpdate`: `askSenderToConfirm`). Header: **IMAGE**, the
first drop-off photo as a 30-day signed link to the `/d?view=photo`
endpoint (`package_proof.photoLink`, signed with the line's
`documentToken`, minted with the row when the line has none). Variables:
{{1}} name, {{2}} business, {{3}} contents (EN), {{4}} weight (EN), {{5}}
business, {{6}} contents (FR), {{7}} weight (FR), {{8}} tracking code.
Contents are `contentsText(line.contents)` in both blocks (serials left
out), or what the line is when there is no item list; weight is "4.2 lb" /
"4,2 lb", or "—". Buttons: two **quick replies**, `OK ✓` and `Something's
wrong`, sent with the payloads `confirm_ok` / `confirm_problem`
(`package_proof.CONFIRM_PAYLOAD`). **No URL button.**

```
Hello / Bonjour {{1}} 👋

*ENGLISH*
{{2}} received your package: {{3}} ({{4}}). Is this right? Tap OK, or Something's wrong.

—————
*FRANÇAIS*
{{5}} a reçu votre colis : {{6}} ({{7}}). Est-ce correct ? Appuyez sur OK ou Something's wrong.

🔎 Tracking code / Code de suivi : {{8}}
```

Sample values: `Fatou`, `Dala Shipping`, `2 phones, 1 tablet`, `4.2 lb`,
`Dala Shipping`, `2 phones, 1 tablet`, `4,2 lb`, `CL-K7M4P2`.

The request body (`whatsapp_templates.templateComponents`): a `header`
component `{type: "image", image: {link}}`, the `body` with eight texts,
then `{type: "button", sub_type: "quick_reply", index: "0", parameters:
[{type: "payload", payload: "confirm_ok"}]}` and the same with index `"1"`
and `confirm_problem`.

**The reply.** The tap comes back through the webhook as `type: "button"`
with `button.payload` and `context.id` = the confirmation's wamid
(`parseWebhook` keeps it as `buttonPayload`). `handleInbound`
(whatsapp_conversations.js) matches `context.id` to the `containerUpdates`
row by `whatsappMessageId`, writes the line's `senderConfirmation`
(`confirmed` / `problem`, `answeredAtMs`, `wamid`) and answers inside the
window, in the customer's language: OK → "Thanks, noted." / "Merci, c'est
noté." (no conversation is opened); Something's wrong → the business's
conversation opens (or reopens) as *needs reply* with a system note
"Sender reported a problem with package CL-… (contents)", the button text
in the thread, and "Sorry about that. {business} will reply here." /
"Désolé. {business} vous répondra ici.". In `laawol_only` mode the thread
lands with Laawol, suggesting the business, like any inbound.

**Photos with a code.** A photo a customer sends whose text or caption
names a package code ("CL-K7M4P2", loosely typed, or the label's link:
`codeInText`) is copied from the conversation's media to
`packagePhotos/{businessId}/wa/{sha1(wamid)[0..24]}.{jpg|png|webp}` and
appended to the line's `customerPhotos` (at most 10; the oldest entry
leaves the list, the file stays until the sweep), with a system note "Photo
filed on package CL-…" in the thread. The package's business is also the
routing candidate for a number nothing else knows.

Created with `~/laawol-deploy-logs/create_proof_templates.py` (dry run by
default, `--apply` submits both templates below; language `en`, category
**Utility**, with a placeholder header image uploaded for Meta's review).
Status (2026-10-29): written, **not submitted**. Until Meta approves it a
confirm send answers `132001` and waits as `waiting_for_template` like any
other template in review.

### `shipment_ready_pickup_code_2lang`

Ready for pickup **with the pickup code** (docs/AIR_PACKAGES.md §3, §4.3):
sent in place of `shipment_ready_pickup_2lang` for a line that has a
`pickupCode` (minted when the business has *Pickup code at delivery* on).
The code goes to the **receiver**, and to the sender only when the sender
is the receiver (the switch, or the same number on both sides;
`pickupCodeFor`); a sender-only row keeps the old template. Variables:
{{1}}–{{10}} as `shipment_ready_pickup_2lang`, then {{11}} the pickup code.
Same button: *Visit website*, `Track · Suivre`, Dynamic,
`https://customer.laawoldigital.com/t/{{1}}` (the tracking code).

```
Hello / Bonjour {{1}} 👋

*ENGLISH*
Good news: your shipment of {{2}} from {{3}} is ready for pickup in {{4}}. Show the pickup code below when you collect it.

—————
*FRANÇAIS*
Bonne nouvelle : votre envoi de {{5}} confié à {{6}} est prêt à être récupéré à {{7}}. Présentez le code de retrait ci-dessous pour le récupérer.

📍 Pickup address / Adresse : {{8}}
📞 Phone / Téléphone : {{9}}
🔎 Tracking code / Code de suivi : {{10}}
🔑 Pickup code / Code de retrait : {{11}}

Tap the button below to follow it.
Appuyez sur le bouton ci-dessous pour le suivre.
```

Sample values: `Fatou`, `3 barrels`, `Dala Shipping`, `Conakry, Guinea`,
`3 fûts`, `Dala Shipping`, `Conakry, Guinée`,
`Madina, near the market, Conakry`, `+224 620 00 00 00`, `CL-K7M4P2`,
`4821`. The legacy set has no code variant (`container_arrived` as before).

### `staff_account_setup`

A business inviting a person as staff by their WhatsApp number
(docs/STAFF_PHONE_INVITES.md). Not a shipment update: sent once per
invitation (and again on Resend) by `inviteBusinessMember` /
`resendAccessInvitation`, built by `staffInviteTemplateMessage`.

This is **Meta's own Template Library template**
`account_creation_confirmation_3`, created as `staff_account_setup` in
`en_US` and `fr` (category **Utility**, pre-approved; the wording is Meta's
and cannot be edited, only the parameters and the button URL are ours). The
invitation's language (the console's language when it was sent) picks the
version; anything not French is English. Button: URL, *Verify account* /
*Confirmer le compte*, `https://customer.laawoldigital.com/j/{{1}}`, whose
only parameter is the invitation's link token. Variables: {{1}} the invited
person's name, {{2}} `your <business> access` / `accès chez <business>`.
**Every value is capped at 30 characters by Meta** for library templates
(longer answers "(#100) Invalid parameter ... exceeds the length limit of 30
characters"), so when the business name does not fit {{2}} falls back to
`your staff access` / `accès employé`, and names are cut at 30.

```
EN  Hi {{1}}, Your new account has been created successfully.
    Please verify {{2}} to complete your profile.
FR  Bonjour {{1}}, Votre nouveau compte a été créé correctement.
    Veuillez confirmer votre {{2}} pour terminer la configuration de votre profil.
```

Why not our own wording: `staff_invite_2lang` ("{{2}} invited you to join
{{3}} on Laawol...") was submitted as Utility and **re-categorized Marketing**
by Meta (2026-10-20); Meta does not deliver marketing templates to US (+1)
numbers, so invites were accepted by the API and then silently dropped. A
reworded "account notice" (`staff_access_2lang`) was rejected outright.
Library templates avoid both. Created with
`~/laawol-deploy-logs/create_staff_setup_template.py` (dry run by default,
`--submit` sends). Until Meta approves a language a send answers `132001`:
the invitation stays pending and the owner sees "WhatsApp message not sent
yet - share this link" (Resend tries again).

#### The legacy templates (fallback, `WHATSAPP_TEMPLATE_SET=legacy`)

In WhatsApp Manager → Message templates there are **three templates**, each
in two languages (`en` and `fr`), category **Utility**. Every one has the
same button: *Visit website*, text `Track shipment` (English) /
`Suivre l'envoi` (French), URL type **Dynamic**:

```
https://customer.laawoldigital.com/t/{{1}}
```

The button's only parameter is the tracking code. It opens the public
tracking page (or the app, where it is installed), which shows the
shipping line, container number and booking number once the box has
sailed.

Meta numbers variables in the order they appear in the body, so the order
below is the order the code fills them in. Template names and variable
order live in one module, `my_flutter_app/functions/whatsapp_templates.js`
(tested in `test/whatsapp-templates.test.js`, which also checks this file's
variable counts). If an approved wording changes, change that module with
it. The French body of each template has the same variables as the English
one, in the same order.

The old single template `container_status_update` is **retired**: nothing
sends it any more, and it can be deleted in WhatsApp Manager.

### `package_received`

Sent once per person when the package is registered (`received`).
Variables: {{1}} name, {{2}} business, {{3}} what, {{4}} destination
country, {{5}} tracking code.

English (`en`):

```
Hello {{1}}, {{2}} has received your shipment of {{3}} going to {{4}}. Your tracking code is {{5}}. We will message you here when it leaves and when it arrives. Tap the button below to follow it at any time.
```

French (`fr`):

```
Bonjour {{1}}, {{2}} a bien reçu votre envoi de {{3}} à destination de {{4}}. Votre code de suivi est {{5}}. Nous vous écrirons ici quand il partira et quand il arrivera. Appuyez sur le bouton ci-dessous pour le suivre à tout moment.
```

### `container_departed`

Sent once per person when the container sails (`shipped`).
Variables: {{1}} name, {{2}} what, {{3}} business, {{4}} destination
country, {{5}} tracking code. The ship, container and booking details are
on the tracking page the button opens, not in the message.

English (`en`):

```
Hello {{1}}, your shipment of {{2}} from {{3}} has left and is on its way to {{4}}. Your tracking code is {{5}}. Tap the button below to follow it, with the ship, container and booking details.
```

French (`fr`):

```
Bonjour {{1}}, votre envoi de {{2}} confié à {{3}} est parti et fait route vers {{4}}. Votre code de suivi est {{5}}. Appuyez sur le bouton ci-dessous pour le suivre, avec les informations du navire, du conteneur et de la réservation.
```

### `container_arrived`

Legacy set only. Sent once per person when the container reaches the
destination (`arrived`: the carrier's "at the port" or staff's "Ready for
pickup", whichever is first). Variables: {{1}} name, {{2}} what, {{3}} business, {{4}}
destination country, {{5}} business phone, {{6}} tracking code.

English (`en`):

```
Hello {{1}}, good news: your shipment of {{2}} from {{3}} has arrived at its destination, {{4}}. The team will let you know when it is ready to collect; you can reach them on {{5}}. Your tracking code is {{6}}. Tap the button below to see its details.
```

French (`fr`):

```
Bonjour {{1}}, bonne nouvelle : votre envoi de {{2}} confié à {{3}} est arrivé à destination ({{4}}). L'équipe vous préviendra quand il sera prêt à récupérer ; vous pouvez la joindre au {{5}}. Votre code de suivi est {{6}}. Appuyez sur le bouton ci-dessous pour voir les détails.
```

### Where each value comes from, and what fills a blank (legacy set)

WhatsApp refuses an empty parameter, so every variable has a fallback that
still reads inside the sentence:

| Variable | Source | Fallback (en / fr) |
| --- | --- | --- |
| name | the line's customer or receiver name | `there` / `à vous` ("Hello there," / "Bonjour à vous,") |
| business | the business's name | `Laawol` |
| what | the line: "3 barrels" / "3 barils", "2015 Toyota Camry (VIN …004352)", "2 × boxes of clothes" | `goods` / `marchandises` (never reached in practice) |
| destination country | the line's own destination (waiting packages), else its container's; French readers get the French country name ("Guinée") | `its destination country` / `son pays de destination` |
| business phone | `businesses/{id}.phone` | `the number on your receipt` / `numéro indiqué sur votre reçu` (the French body reads "joindre au {{5}}") |
| tracking code | the line's code | `-` (every line has a code) |

Line breaks, tabs and runs of spaces in a value are collapsed to one space
(WhatsApp refuses them too).

In the legacy set the language per person is chosen from the phone's
country code: French for French-speaking countries (France, Belgium,
Guinea, Senegal, Côte d'Ivoire, ...), English for everyone else. The
bilingual set sends everyone the same two-language message.

Sample values for Meta's review: `Fatou`, `Dala Shipping`, `3 barrels`,
`Guinea`, `+1 646 555 0199` (arrived only), `CL-K7M4P2`. For the button,
use `CL-K7M4P2`.

### 3. Store the credentials

From WhatsApp Manager → API setup, take the **permanent system-user access
token** and the **Phone number ID**, then run (each prompts for the value):

```bash
firebase functions:secrets:set WHATSAPP_ACCESS_TOKEN --project "$FIREBASE_PROJECT"
firebase functions:secrets:set WHATSAPP_PHONE_NUMBER_ID --project "$FIREBASE_PROJECT"
firebase deploy --only functions:sendContainerCustomerUpdates,functions:deliverContainerCustomerUpdate,functions:sendContainerCurrentStatus,functions:addContainerLine,functions:addWaitingPackage --project "$FIREBASE_PROJECT"
```

All five read the secrets (`addContainerLine` and `addWaitingPackage` to
decide whether a new package's `received` rows are `queued` or
`waiting_for_whatsapp`), so all five must be redeployed after the secrets
change (a running function keeps the value it started with). Deploy them
one or two at a time (see the Cloud Run CPU quota notes in
`docs/ENGINEERING_GUARDRAILS.md`).

Before Meta approval both secrets hold the placeholder `unset`. The functions
deploy needs them to exist, and the code treats `unset` as "not connected".

### 4. Check

Register a test package with your own number as the receiver: the line
should show "received" and "sent", and `containerUpdates` should hold
`{lineId}_receiver_received` with `status: "sent"` and a
`whatsappMessageId`. Then ship a test container and mark it ready for pickup the same way. A
`failed` row carries Meta's error text in `error`. The usual causes are a
template name or language that doesn't match, a variable count that
differs from the approved body, or a template still pending review. A row
stuck in `retrying` means Meta or the network kept failing; the function
logs of `deliverContainerCustomerUpdate` carry each attempt's error.

Containers that shipped before this step still have their rows waiting;
see *Updates sent before WhatsApp was connected* above.
