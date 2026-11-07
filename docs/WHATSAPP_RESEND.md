# WhatsApp: corrected numbers, Send again, counter warning

Owner request 2026-11-07, after a package's sender number was typed three
digits short ("+164655501"), WhatsApp answered "Message undeliverable"
(131026), and staff corrected the number but nothing was sent to the new one.

## What happens now

1. **A corrected number hears the latest news by itself.** When a write
   changes `customerPhone` or `receiverPhone` on a container line that has
   already told people something (`lastCustomerUpdate.update`), that person,
   and only that person, is sent the line's latest update again on the new
   number. Server: `resendToCorrectedNumbers` in `rollupVolumeOnLineWrite`
   (the existing line trigger, so no new function against the CPU budget),
   `phoneChangedRoles` (pure, `container_updates.js`).
2. **Send again.** `updateContainerLine` with `action: "resend_update"`
   (containers permission) re-queues the latest update for each person whose
   message failed or whose number changed. A delivered or read message is
   never sent twice. At most `MAX_HAND_RESENDS` (5) hand resends per person to
   the same number (`handResends` on the row); a changed number always goes.
3. **Counter warning.** The console's Waiting list remembers the packages
   saved in this sitting; when WhatsApp reports one of their messages failed
   (usually within seconds), a red box shows who, the number used and the
   code, with **Fix the number** (opens the edit) and **Send again**.

## Rules (`requeueDecision(row, nowMs, {phone, retryFailed})`)

| Row | Number now | retryFailed | Decision |
| --- | --- | --- | --- |
| none | - | - | create |
| sent | different digits | any | requeue (keeps `previousPhone`) |
| sent, `deliveryStatus: failed`, `handResends < 5` | same | true | requeue (`handResends + 1`) |
| sent (anything else) | same | any | already_sent |
| queued / retrying / waiting_for_template / live sending | any | any | in_flight |
| failed, `handResends >= 5` | same | true | already_sent |
| failed / waiting_for_whatsapp / dead sending | - | - | requeue |

A requeue clears the previous attempt's WhatsApp report (`whatsappMessageId`,
`sentAt`, `deliveryStatus*`, `deliveryError*`) so the new attempt starts clean.

WhatsApp gives no way to check a number in advance (Meta removed the contacts
check in 2023): the first message is the check, and a failed one is free.

## Not yet

- The Flutter app shows failures but has no Send again or counter warning
  (next build).
- No format check per country as numbers are typed (proposed; not built).
