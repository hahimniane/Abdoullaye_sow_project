# WhatsApp container updates

When a business ships a container, everyone with goods on it hears about it
on WhatsApp: the customer who handed the goods in (the **sender**) and the
person collecting them at the other end (the **receiver**). They hear again
when the container reaches the destination port and when the business marks
it arrived.

Nothing is sent until the steps below are done. Until then every update is
recorded in `containerUpdates` with status `waiting_for_whatsapp`, so the
business can see who *would* have been told.

## How it works

1. A moment is written to `containers/{id}/trackingEvents`:
   - staff mark the container **Shipped** or **Arrived** (`setContainerStatus`), or
   - the Terminal49 carrier feed reports it on the vessel, discharged, or
     available (`pollContainerTracking`, every 4 hours). Tracking starts by
     itself as soon as the container has a real ISO number
     (`startContainerCarrierTracking`).
2. Moments customers care about carry `customerUpdate` (`shipped`,
   `at_port`, `arrived`). `sendContainerCustomerUpdates` **queues** one
   message per person per line; it sends nothing itself.
3. Each message is one `containerUpdates/{lineId}_{role}_{update}` document,
   created only if it does not exist yet. Staff tapping Shipped and the
   carrier reporting `on_ship` are the same update, so whoever comes first
   queues it and the other finds it already there.
4. `deliverContainerCustomerUpdate` sends each row on its own, as soon as the
   row becomes `queued` (see *The send queue* below).
5. A person is skipped (and the line says why) when they have no phone,
   staff switched them off, or the number has no country code.

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
(`arrived` beats `at_port` beats `shipped`), not every update it missed:

- It refuses (`failed-precondition`, `reason: whatsapp_not_configured`)
  until WhatsApp is connected, and (`reason: no_customer_update`) when the
  container has no customer news yet.
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

## One-time setup (platform admin)

### 1. Meta business verification

WhatsApp only lets a business start a conversation with a template Meta has
approved, and only after the Meta Business account is verified. This is the
blocker today.

### 2. Create the template

In WhatsApp Manager → Message templates, create **two languages of one
template**, both named exactly `container_status_update`, category
**Utility**.

**English (`en`)**

Body:

```
Hello {{1}}, an update from {{2}} about {{3}}: {{4}}. Tracking code: {{5}}.
```

Button: *Visit website*, text `Track shipment`, URL type **Dynamic**:

```
https://customer.laawoldigital.com/t/{{1}}
```

**French (`fr`)**

Body:

```
Bonjour {{1}}, une mise à jour de {{2}} concernant {{3}} : {{4}}. Code de suivi : {{5}}.
```

Button: *Visit website*, text `Suivre l'envoi`, same dynamic URL.

Sample values for Meta's review: `Fatou`, `Dala Shipping`, `3 barrels`,
`the container has left port and is on its way`, `CL-K7M4P2`. For the button,
use `CL-K7M4P2`.

The variable order matters. The code fills them as: name, business, what is
on the line, what just happened, tracking code. If the approved wording
changes, the five variables must stay in that order.

### 3. Store the credentials

From WhatsApp Manager → API setup, take the **permanent system-user access
token** and the **Phone number ID**, then run (each prompts for the value):

```bash
firebase functions:secrets:set WHATSAPP_ACCESS_TOKEN --project car-selling-flutter-app
firebase functions:secrets:set WHATSAPP_PHONE_NUMBER_ID --project car-selling-flutter-app
firebase deploy --only functions:sendContainerCustomerUpdates,functions:deliverContainerCustomerUpdate,functions:sendContainerCurrentStatus --project car-selling-flutter-app
```

All three read the secrets, so all three must be redeployed after the
secrets change (a running function keeps the value it started with).

Before Meta approval both secrets hold the placeholder `unset`. The functions
deploy needs them to exist, and the code treats `unset` as "not connected".

### 4. Check

Ship a test container with your own number as the receiver. The line should
show "sent", and `containerUpdates` should hold a document with
`status: "sent"` and a `whatsappMessageId`. A `failed` row carries Meta's
error text in `error`. The usual causes are a template name or language that
doesn't match, or a template still pending review. A row stuck in
`retrying` means Meta or the network kept failing; the function logs of
`deliverContainerCustomerUpdate` carry each attempt's error.

Containers that shipped before this step still have their rows waiting;
see *Updates sent before WhatsApp was connected* above.
