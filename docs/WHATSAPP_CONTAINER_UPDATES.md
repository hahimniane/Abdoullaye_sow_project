# WhatsApp container updates

Everyone with goods on a container hears about them on WhatsApp: the
customer who handed the goods in (the **sender**) and the person collecting
them at the other end (the **receiver**). Each person gets at most three
messages per package:

| Moment | Template | Fires when |
| --- | --- | --- |
| `received` | `package_received` | The package is registered: dropped off to wait for a container (`addWaitingPackage`) or added straight onto one (`addContainerLine`). Assigning a waiting package to a box, or taking it off one, sends nothing. |
| `shipped` | `container_departed` | Staff mark the container **Shipped**, or the carrier feed reports it on the vessel — whichever comes first. |
| `arrived` | `container_arrived` | The carrier feed reports it discharged/available at the destination port, or staff mark it **Arrived** — whichever comes first. The other sends nothing. |

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
   - staff mark the container **Shipped** or **Arrived** (`setContainerStatus`), or
   - the Terminal49 carrier feed reports it on the vessel, discharged, or
     available (`pollContainerTracking`, every 4 hours). Tracking starts by
     itself as soon as the container has a real ISO number
     (`startContainerCarrierTracking`).
3. Moments customers care about carry `customerUpdate` (`shipped`,
   `at_port`, `arrived`). The timeline keeps `at_port` as its own moment,
   but its message is the arrival's: `messageUpdateFor` turns `at_port` into
   `arrived`, so `sendContainerCustomerUpdates` **queues** one `arrived`
   message per person per line; it sends nothing itself.
4. Each message is one `containerUpdates/{lineId}_{role}_{update}` document
   (`update` is `received`, `shipped` or `arrived`), created only if it does
   not exist yet. Staff tapping Shipped and the carrier reporting `on_ship`
   are the same update, and so are the carrier's "at the port" and staff's
   "Arrived": whoever comes first queues it and the other finds it already
   there.
5. `deliverContainerCustomerUpdate` sends each row on its own, as soon as the
   row becomes `queued` (see *The send queue* below). It builds the message
   at send time from the line, its container (for the destination) and the
   business (for its phone).
6. A person is skipped (and the line says why) when they have no phone,
   staff switched them off, or the number has no country code.

Rows written before the arrival merge may still carry `update: "at_port"`;
they are sent (if ever re-queued) as `container_arrived`.

Each line carries `lastCustomerUpdate` — the latest update and, per person,
`queued`, `sent`, `retrying`, `failed`, `waiting_for_whatsapp` or `skipped`
(with the reason). The queue and the sender both update it, in the same
transaction as the row.

Rules live in `my_flutter_app/functions/container_updates.js` and are tested
in `test/container-updates.test.js` (pure rules and wiring) and
`test/container-callables.test.js` (against the Firestore emulator:
`npm run test:containers`).

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
(`arrived` beats `shipped`; the carrier's `at_port` counts as `arrived`),
not every update it missed:

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

## Templates still in review

A template that Meta has not approved yet answers every send with error
`132001`. Such a row is not failed: it becomes `waiting_for_template`, the
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

Status (2026-10-16): the three templates below, in English and French (six in all), are submitted in WhatsApp Business Account **992521863149970**.

WhatsApp only lets a business start a conversation with a template Meta has
approved, and only after the Meta Business account is verified.

### 2. The templates

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

Sent once per person when the container reaches the destination
(`arrived`: the carrier's "at the port" or staff's "Arrived", whichever is
first). Variables: {{1}} name, {{2}} what, {{3}} business, {{4}}
destination country, {{5}} business phone, {{6}} tracking code.

English (`en`):

```
Hello {{1}}, good news: your shipment of {{2}} from {{3}} has arrived at its destination, {{4}}. The team will let you know when it is ready to collect; you can reach them on {{5}}. Your tracking code is {{6}}. Tap the button below to see its details.
```

French (`fr`):

```
Bonjour {{1}}, bonne nouvelle : votre envoi de {{2}} confié à {{3}} est arrivé à destination ({{4}}). L'équipe vous préviendra quand il sera prêt à récupérer ; vous pouvez la joindre au {{5}}. Votre code de suivi est {{6}}. Appuyez sur le bouton ci-dessous pour voir les détails.
```

### Where each value comes from, and what fills a blank

WhatsApp refuses an empty parameter, so every variable has a fallback that
still reads inside the sentence:

| Variable | Source | Fallback (en / fr) |
| --- | --- | --- |
| name | the line's customer or receiver name | `there` / `à vous` ("Hello there," / "Bonjour à vous,") |
| business | the business's name | `Laawol` |
| what | the line: "3 barrels" / "3 fûts", "2015 Toyota Camry (VIN …004352)", "2 × boxes of clothes" | `goods` / `marchandises` (never reached in practice) |
| destination country | the line's own destination (waiting packages), else its container's; French readers get the French country name ("Guinée") | `its destination country` / `son pays de destination` |
| business phone | `businesses/{id}.phone` | `the number on your receipt` / `numéro indiqué sur votre reçu` (the French body reads "joindre au {{5}}") |
| tracking code | the line's code | `-` (every line has a code) |

Line breaks, tabs and runs of spaces in a value are collapsed to one space
(WhatsApp refuses them too).

The language per person is chosen from the phone's country code: French for
French-speaking countries (France, Belgium, Guinea, Senegal, Côte d'Ivoire,
...), English for everyone else.

Sample values for Meta's review: `Fatou`, `Dala Shipping`, `3 barrels`,
`Guinea`, `+1 646 555 0199` (arrived only), `CL-K7M4P2`. For the button,
use `CL-K7M4P2`.

### 3. Store the credentials

From WhatsApp Manager → API setup, take the **permanent system-user access
token** and the **Phone number ID**, then run (each prompts for the value):

```bash
firebase functions:secrets:set WHATSAPP_ACCESS_TOKEN --project car-selling-flutter-app
firebase functions:secrets:set WHATSAPP_PHONE_NUMBER_ID --project car-selling-flutter-app
firebase deploy --only functions:sendContainerCustomerUpdates,functions:deliverContainerCustomerUpdate,functions:sendContainerCurrentStatus,functions:addContainerLine,functions:addWaitingPackage --project car-selling-flutter-app
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
`whatsappMessageId`. Then ship and arrive a test container the same way. A
`failed` row carries Meta's error text in `error`. The usual causes are a
template name or language that doesn't match, a variable count that
differs from the approved body, or a template still pending review. A row
stuck in `retrying` means Meta or the network kept failing; the function
logs of `deliverContainerCustomerUpdate` carry each attempt's error.

Containers that shipped before this step still have their rows waiting;
see *Updates sent before WhatsApp was connected* above.
