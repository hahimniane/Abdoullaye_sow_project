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

## Server choices the spec did not state (built 2026-11-19)

Where the spec was silent the safe side was taken ("wrong is worse than
slow"; a deposit waits for the office):

- **Matching dates**: for rules 3 and 5 a deposit dated more than a day
  before the screenshot's day cannot be that payment. Rule 5a (the driver's
  answer) does not need equal amounts (Q3); 5b does. Two claims, or two
  deposits, that fit the same way: nothing is guessed; the claims get
  `reason: "two_claims"`.
- **Names**: `nameIs` ignores reference numbers (a word with a digit is not
  part of a name). A remembered name must have two words that are not bank
  words (MONEY, SENT, PMT, XFER, ZELLE, ...); the cleanup runs on the bank's
  sender line when it is stored and again when names are compared.
- **Undone**: `payment_undo` sets `fleetUndone: true` on the deposit (and the
  bank's replacement copy inherits it in `bank_sync.applySyncPlan`). A later
  deposit of the same amount from the same sender within 5 days of an undone
  one also waits as `undone`. Undoing a payment brings back the late fees it
  took back and sends the claim it paid back to the office (`office`,
  `reason: "payment_undone"`).
- **Reading**: a picture the model is not `confident` about, or has no
  valid amount for, asks the driver for the amount. A covered driver's
  picture that could not be read is a claim asking the amount; an unknown
  phone's picture that could not be read is an ordinary support message.
  While Fleet WhatsApp is on for any business, every picture from an unknown
  phone is sent to the Claude API to see whether it is a payment.
- **Already recorded**: a picture of a payment the driver's remembered name
  already paid (same amount, bank date within a day of the picture, no claim
  attached) is answered "already recorded" and closes as `paid` with
  `reason: "already_recorded"`; the same picture sent twice while waiting is
  "already have it".
- **Questions**: three unanswered/unclear answers hand a claim to the office
  (`not_a_driver` for the phone question, `no_amount` for the amount); the
  name question is asked once and then the claim keeps waiting. Replies and
  the 2-day notice go to the phone that sent the picture (the driver's own,
  or the friend who paid for them); the receipt goes to the driver.
- **Outside the 24-hour window** the 2-day notice may not be delivered
  (free-form text): the claim is flagged for the office either way
  (`toldLateAtMs`, `toldLateSent`, `reason: "no_deposit"`).
- **Timers** act on every open claim, including ones in `office` (closed
  after 7 days). The "late" reminder is paused only for `asking_amount`,
  `waiting_bank` and `asking_name` claims.
- **Sweep**: once an hour the job looks at the last 100 deposits that are
  matchable, older than 10 minutes and never marked `fleetLookedAtMs`.
- **Bank connection**: a different login or account stores
  `businessBankLinks.matchFromMs = now`; matching starts no earlier.
- **importSheet** no longer assigns personal cents (it still answers
  `centsChanged: 0`).

## API (`fleetAction`, new and changed actions)

All take `businessId`. Staff = Fleet staff or Fleet admin.

- `bank_status` (staff) also returns `claims`: every open claim of the
  business (states `asking_driver`, `asking_amount`, `waiting_bank`,
  `asking_name`, `office`), newest first, at most 100:
  `[{id, driverId|null, driverName, amountCents|null, state, reason|null,
  createdAtMs, hasPhoto, fromPhone, payerName|null, toldLateAtMs|null}]`.
  `reason` is a claim reason (`wrong_recipient`, `too_old`, `not_a_driver`,
  `two_claims`, `no_amount`, `no_deposit`, `payment_undone`,
  `deposit_taken`) or null. Waiting deposits (`waiting[].reason`) may now
  be `unknown`, `shared_payer`, `undone`, `driver_left`, `own_transfer`,
  `not_zelle`, `possible_duplicate` (`two_drivers` is no longer produced).
- `claim_assign {claimId, creditId}` (staff): the deposit (it must be on the
  waiting list) pays the claim's driver, the bank's amount and date are
  recorded, the claim becomes `paid`, the sender is remembered, the receipt
  goes out. Returns `{success, claimId, paymentId, amountCents}`. Refusals
  (`error.details.reason`): `fleet_not_found`, `fleet_claim_closed`,
  `fleet_claim_no_driver`, `fleet_deposit_used`, `fleet_deposit_not_waiting`,
  `fleet_driver_left`.
- `claim_close {claimId}` (staff): the claim becomes `closed`. Returns
  `{success}`. Refusals: `fleet_not_found`, `fleet_claim_closed`.
- `claim_photo {claimId}` (staff): `{success, url: string|null, deleted}`,
  the download link of the screenshot in the business's support thread
  (null when there is none, or when it was deleted after 12 months). The
  claim also carries `mediaPath` (a Storage path under
  `support_cases/{caseId}/whatsapp/`, readable by the business's people
  through the existing support rules) and `caseId`, `messageId` (the wamid).
- `payer_names_save {driverId, names: string[]}` (staff): replaces the
  driver's `rememberedSenders` (at most 10 names; each stored as its sender
  key, e.g. `AWA SOW`; duplicates collapse). Refuses account-like and app
  names, one-word names and stop-listed words with
  `fleet_bad_name` (`details.name` says which); a key already remembered
  may stay. Returns `{success, names: [keys]}`. Other refusals:
  `fleet_bad_input` (more than 10), `fleet_not_found`.
- `bank_assign {creditId, driverId}` now also refuses `fleet_driver_left`
  (the driver must be active), `fleet_not_found` (not this business's) and
  `fleet_deposit_not_waiting` (the deposit must be on the waiting list).

`fleetClaims/{id}` is readable by Fleet staff of the business (listener);
`fromPhone`, `mediaPath`, `caseId`, `messageId`, `state`, `reason`, `open`
(true until paid or closed), `attempts`, `lang`, `paymentId`, `creditId`,
`closedByUid` are all stored on it. `fleetPayments` made from a claim carry
`claimId`; a payment that took back late fees carries `lateFeesVoided`.
