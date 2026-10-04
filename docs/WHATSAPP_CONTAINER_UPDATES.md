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
   `at_port`, `arrived`). `sendContainerCustomerUpdates` sends one message
   per person per line.
3. Each message is one `containerUpdates/{lineId}_{role}_{update}` document.
   Staff tapping Shipped and the carrier reporting `on_ship` are the same
   update, so whoever comes first sends and the other finds it already done.
4. A person is skipped (and the line says why) when they have no phone,
   staff switched them off, or the number has no country code.

Rules live in `my_flutter_app/functions/container_updates.js` and are tested
in `test/container-updates.test.js`.

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
firebase deploy --only functions:sendContainerCustomerUpdates --project car-selling-flutter-app
```

Before Meta approval both secrets hold the placeholder `unset`. The functions
deploy needs them to exist, and the code treats `unset` as "not connected".

### 4. Check

Ship a test container with your own number as the receiver. The line should
show "sent", and `containerUpdates` should hold a document with
`status: "sent"` and a `whatsappMessageId`. A `failed` row carries Meta's
error text in `error`. The usual causes are a template name or language that
doesn't match, or a template still pending review.

## Updates sent before WhatsApp was connected

They stay `waiting_for_whatsapp` and are not sent later. A message about a
container that sailed weeks ago is noise. Customers start hearing from the
next moment after connection onward.
