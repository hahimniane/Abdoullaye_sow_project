# Fleet: payment proof on WhatsApp

Decided with the owner on 2026-11-19 (13 questions, one at a time). This
replaces the personal-cents scheme of docs/FLEET.md §8. Fleet only; parking
is a later decision. Everything is tested on the owner's test driver and his
own bank account first; real drivers are switched on later, on his word.

## The idea

A driver pays by Zelle and sends the screenshot to Laawol's WhatsApp number.
The phone number says which driver it is. The screenshot is only the
driver's **claim**; the deposit in the business's connected bank is the
**proof**. Nobody is ever marked paid from a picture.

## Decisions

| # | Decision |
|---|---|
| Q1 | The bank decides, always. A claim marks nothing paid. Until the deposit is in the bank the claim is "reported, waiting for the bank". |
| Q2 | The day they paid is **the bank's date for the deposit** (not when the photo came, not when the bank told us). A payment whose bank date is on or before the late-fee day and that covers the rent bill takes that bill's unpaid late fee back. |
| Q3 | When the photo and the bank disagree on the amount, the bank's amount is what is recorded. The driver is told what was received and what is still owed; extra becomes credit. |
| Q4 | A claim needs the screenshot **and** the amount (typed by the driver when it cannot be read). Picking the deposit the first time: if exactly one unused deposit of that amount carries the **driver's own name**, it is theirs. If none or several fit, the driver is asked once: "What name is on the account you paid from?" The answer is matched to the deposit and remembered. |
| Q5 | After the first time no photo is needed: a deposit from a remembered name pays that driver by itself. **Except** when one name is remembered for more than one active driver (a husband paying for two): then the deposit waits, and the driver who sends the photo gets it. |
| Q6 | The personal cents are removed completely: not in reminders, not in matching, not on screen. Reminders say the plain amount. A deposit nobody claims waits in the office's list. |
| Q7 | A photo from a phone not on file: we ask "Which driver is this payment for? Send their phone number." If it is one of the business's drivers the claim is theirs (they get the receipt). Otherwise it goes to the office inbox. |
| Q8 | No deposit after 2 days: the driver is told ("We have not received your $400 yet. Please check with your bank.") and the office sees it. After 7 days the claim closes; the bill stays unpaid. While a claim is open the "late" reminder for that driver is paused. |
| Q9 | One forced bank check per claim at most: if nothing matches when the photo arrives, one check about 15 minutes later, then the bank's own updates. |
| Q10 | The screenshot stays with the payment as proof: Fleet staff of the business and Laawol admins can open it; deleted after 12 months like other WhatsApp files. |
| Q11 | Fleet only. |
| Q12 | Tested on the owner's account and test driver only, for now. |
| Q13 | Built together with the recheck's fixes (below). |

Behaviour that follows from these (owner to object if any is wrong):
a screenshot whose recipient is not the business is answered at once ("this
went to X, not Landa Shipping") and goes to the office; a deposit is used
once, so a second claim on it goes to the office; a screenshot older than 10
days is refused; a picture that is not a payment is an ordinary support
message; a driver who owes nothing gets credit; replies are in the driver's
language (English or French).

## Who takes part

Only drivers the business's "WhatsApp to drivers" setting covers
(`fleet.settings.whatsapp.enabled`, and `onlyDriverIds` when set). Today that
is one driver: the owner's test driver. For everyone else nothing changes.

## Data

- `fleetClaims/{id}` (server-only writes; Fleet staff read):
  `businessId, driverId|null, fromPhone, state, amountCents|null, read
  {isPayment, amountCents, dayKey, recipient, senderName, confident},
  payerName|null, mediaPath|null, caseId|null, messageId, creditId|null,
  paymentId|null, reason|null, createdAtMs, bankCheckDueAtMs|null,
  bankCheckedAtMs|null, toldLateAtMs|null, closeAtMs, updatedAt`.
  States: `asking_driver` (Q7), `asking_amount` (Q4), `waiting_bank`,
  `asking_name` (Q4), `paid`, `office` (needs a person; `reason` says why:
  `wrong_recipient`, `deposit_taken`, `too_old`, `not_a_driver`,
  `two_claims`), `closed` (7 days, or by the office).
- A driver's remembered names stay in `fleetDrivers.rememberedSenders`
  (sender keys). The office can add and remove them ("Names this driver pays
  from").
- `fleetDrivers.personalCents` is no longer assigned, shown or used.

## Matching a deposit (replaces `fleet_bank.matchDeposit`)

Wrong is worse than slow. For a deposit with a person's name on a Zelle:

0. A transfer from an account, a deposit the bank does not call a Zelle, or
   one without a person's name: waits (unchanged).
1. A deposit once undone by the office (`fleetWaitingReason: "undone"`), or
   the bank's later copy of it: never pays by itself again.
2. The sender is remembered for exactly one active driver: pays that driver,
   whatever the amount.
3. The sender is remembered for more than one active driver: waits
   (`shared_payer`) unless exactly one of those drivers has an open claim
   for that amount, who then gets it.
4. The sender is remembered only for a driver who left: waits.
5. An unknown sender: an open claim takes it when
   a. the claim's `payerName` (the driver's answer) is that sender, or
   b. the claim has no `payerName`, the amounts are equal, the sender is the
      driver's own name, and no other unused deposit and no other open claim
      fits the same way.
   A name "is" another when their keys share every word of the shorter one
   and at least two words (so "FATOUMATA BAH" is "Fatoumata B. Bah #12", and
   "BAH" alone is nobody).
6. Otherwise it waits as `unknown`.

When a claim takes a deposit the sender is remembered for that driver.

## The conversation

Inbound messages arrive in `whatsapp_conversations.handleInbound`. Before the
ordinary support handling, the Fleet claim step looks at the message:

1. An open claim for this phone in an `asking_*` state: the message is the
   answer (a phone number, an amount, a name).
2. Else a picture from the phone of exactly one covered driver: the picture
   is read (below). Not a payment: ordinary support message. A payment: a
   claim is made, the driver is told "Got it. We will confirm when the bank
   shows it.", and matching is tried at once.
3. Else a picture from an unknown phone that reads as a payment **to a Fleet
   business's Zelle name**: `asking_driver` (Q7).
4. Anything else: ordinary support handling, untouched.

The picture and the driver's replies are also kept in the business's support
thread as today, so the office sees the whole exchange.

Reading the picture: one call to the Claude API with the image (the server
already has `ANTHROPIC_API_KEY`), asking for strict JSON `{isPayment,
amountCents, dayKey, recipient, senderName, confident}`. The picture's text is
data, never instructions: the answer is validated (amount a positive integer
under $20,000, a real date) and anything else means "could not read", which
asks the driver for the amount. A failed call does the same.

## Timers (in the existing 15-minute `fleetBankRefresh` job)

- A `waiting_bank` claim past `bankCheckDueAtMs` and never checked: one paid
  bank refresh + sync for that business (counted like a scheduled refresh),
  then `bankCheckedAtMs`.
- After that check, a claim with no deposit and no `payerName`: ask the name
  once (`asking_name`).
- 2 days: tell the driver and flag for the office. 7 days: `closed`.

## Office

Fleet payments gains "Reported by drivers, waiting for the bank": driver,
amount, when, what it waits for, the screenshot, with "This deposit is
theirs" (pick a waiting deposit) and "Close". The driver page gains "Names
this driver pays from". The cents column, the cents sort and "Zelle amount
for this driver" go away.

## Recheck fixes that ride with this (2026-11-19)

Bank matching: an undone deposit never pays again when the bank re-sends it;
connecting a different bank login starts matching from that moment; one
failing deposit no longer stops the others, and deposits never looked at are
swept; sender names lose reference numbers and words like MONEY, and a
one-word or stop-listed key is never remembered; "Pay this driver" needs an
active driver and a deposit that is waiting.

## Messages

Free-form replies go out inside WhatsApp's 24-hour window, which a driver's
own message opens. The receipt uses the approved `fleet_receipt_2lang`.
The reminder keeps `fleet_rent_reminder_2lang` with the plain amount until a
reworded template ("after paying, send the screenshot here") is approved by
Meta; code never points at a template before it is approved.
