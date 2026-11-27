# Fleet (TLC plate leasing) — build spec

Customer: **Landa Shipping** (Lamine Tounkara), an existing Laawol business
that also leases plated TLC cars to drivers weekly or monthly. Fleet replaces
his spreadsheet (94 drivers, 77 cars, 2,760 payments since Oct 2021).
Designs approved by the owner 2026-11-05 (canvas "ASB Fleet"); behaviour
decided 2026-11-01 → 2026-11-11 (memory: project_fleet_module).

## 1. Decisions that shape the code

| # | Decision |
|---|---|
| Q1 | Each car–driver assignment has a rent (weekly or monthly) typed once. Owed starts at go-live; history comes in as payments. |
| Q2/Q3 | Insurance is paid to the broker, not to the business: not a bill line. It is car paperwork (insurer, policy, premium, due day, autopay); drivers upload proof (phase 2), the office ticks it. |
| Q5 | Monthly due on the 1st, weekly on Monday (editable per driver). Reminders 2 days before, on the day, late, then weekly. **Late fee**: the office sets the amount, the exact day of the month it applies and the first month it applies; one fee per late bill; admins can waive (History). Fees are paid first. |
| Q6 | Two levels: **Fleet staff** (permission `fleet`: see all, record payments, add cars/drivers/one-off charges, tick insurance) and **Fleet admin** (`fleet_admin`, plus the owner/full access: rents, late fee, due days, waive, undo payments, settings, import, bank). History on everything. |
| Q8 | Overpay → driver credit, applied to the next bill automatically (every new bill: rent, late fee, one-off charge; late fees first, then oldest due). |
| D1 (11/19) | Monthly billing is by **calendar month**. A driver who gets a plate mid-month pays the full month, due the day they get it (or the due day, when that is later in the start month); from the next month on the bill is the 1st to the last day, due on the assignment's due day. Weekly periods are unchanged. The daily job never bills a calendar month twice (a non-void rent bill of the assignment overlapping that month blocks a new monthly period). |
| D2 (11/19) | With `returnRule` "days", the month a plate comes back in is charged for the days used within that bill's own period; "full" keeps it whole. |
| L4 (11/19) | **Late-fee date**: the fee day of the due month when the bill is due on or before it; otherwise the due day + 3 days. |
| Zelle (11/05) | **No staff step.** Each active driver has personal cents (the amount is the code). A driver taps "I paid" (amount + sender name); the bank must agree. An unknown deposit is asked to drivers on WhatsApp; only a true two-driver dispute goes to the owner. Phase 1b. |
| Q10 | A car returned mid-period: a Fleet setting the admin picks — `full` period or `days` used (pro rata by day). |
| Q11 | Drivers see only their fleet business on Laawol (its Fleet pages and its other services), never other businesses. Setting on by default; the Fleet admin can turn it off. **Fleet drivers only** — other customers keep the marketplace (Q12). Phase 2. |
| Q13 | Drivers pay by **Zelle only**. No card or bank payments in the app. |
| Q14 | Import the sheet as past payments. A 0 in the current month or the one before (Oct and Nov 2026) becomes an owed bill; older 0s carry no debt. |
| Q15 | A city ticket shows to a driver only after the office presses "Charge driver". Phase 3. |
| Plates (11/15) | **The plate is the fleet's; the car on it is usually the driver's.** Screens speak of plates ("Plates", "Give a plate", "Plate returned"). A plate is permanent; the car on it can change. When the office edits the car and says the plate moved (not a typo), the car it was on is kept with its dates (`vehicleHistory`, `vehicleSince`). A new plate defaults to "the driver" owns the car. |
| Today | No separate Fleet home: Today shows fleet tiles (money this month, late drivers, Zelle waiting, tickets). |
| Rules | No prices in code (what Laawol charges Landa is a Bills deal). Fleet data is private to the business. AI reads, suggests and drafts; a person confirms anything with money. |

## 2. Data (all written by the server only; read by the business's people with `fleet`)

- `fleetDrivers/{id}`: `businessId, name, phone (E.164), tlcLicense, address
  {line1, city, state, zip}, status "active"|"left", personalCents (1–99,
  unique among the business's active drivers), rememberedSenders [string],
  creditCents, notes, importKey, createdAt, updatedAt`.
- `fleetCars/{id}`: `businessId, plate (upper case), company, vehicleType, vin,
  registrationExpiry (dayKey), diamondExpiry (dayKey), insurer, policyNumber,
  premiumCents, insuranceDueDay, insuranceAutopay, insurancePaidBy, ownership
  "driver"|"company", status "active"|"inactive", importKey, vehicleSince
  (dayKey|null), vehicleHistory [{vin, vehicleType, ownership, fromDayKey,
  toDayKey}]`. The record is the **plate**; `vin`/`vehicleType`/`ownership`
  describe the car on it now. `car_save` with `car.vehicleChange {moved: true,
  sinceDayKey}` moves the old car into `vehicleHistory`.
- `fleetAssignments/{id}`: `businessId, carId, driverId, startDayKey,
  endDayKey|null, rentCents, period "weekly"|"monthly", dueDay (monthly 1–28,
  weekly 1=Mon…7=Sun), rentHistory [{rentCents, dueDay, fromDayKey,
  toDayKey}] (the values before each change, `assignment_update`),
  rentFromDayKey (when the current fee started), createdBy`.
- `fleetBills/{id}` (id = `${assignmentId}_${periodFrom}` for rent, random for
  others): `businessId, driverId, carId, assignmentId, kind
  "rent"|"charge"|"late_fee"|"ticket", label, periodFrom, periodTo, dueDayKey,
  amountCents, paidCents, status "open"|"paid"|"waived"|"void", waived {byUid,
  atMs, reason}, lateFeeForBillId, createdAt`.
- `fleetPayments/{id}`: `businessId, driverId, amountCents, method
  "zelle"|"cash"|"other"|"import", paidDayKey, receivedAtMs, receivedByUid,
  allocations [{billId, cents}], creditAddedCents, creditUsedCents, status
  "recorded"|"undone", imported, bankTxnId, note`.
- `businesses/{id}.fleet`: `enabled, settings {lateFee {cents, dayOfMonth,
  firstMonth}, returnRule "full"|"days", driversSeeOnlyThisBusiness true,
  zelle {name, handle}}`. `enabledServices` gains `"fleet"`.
- Every change writes `lotLedgerAudit` (`entityType: "fleet_*"`) for History.

## 3. Pure logic (`functions/fleet_billing.js`, mirrored in `admin_web/src/lib/fleet-billing.ts`; shared fixture `functions/test/fixtures/fleet-billing-cases.json`)

- `rentPeriods(assignment, throughDayKey)` — the periods from start to the
  period containing `throughDayKey` (monthly: the first period is the start
  to the end of its month, due the later of the start day and the due day,
  then calendar months due on the due day; weekly: weeks from the start's
  weekday). Each period uses the fee and due day in force for it
  (`rentHistory`, `termsAt`).
- `rentBillsToCreate(assignment, existing, throughDayKey, settings)` —
  idempotent by bill id; `existing` is ids or bills, and a monthly period is
  skipped when a non-void rent bill of the assignment already overlaps its
  calendar month (`missingRentPeriods`). A period cut by `endDayKey` follows
  `returnRule` (days used within that period).
- `nextUnbilledPeriodStart(assignment, existing, todayKey)` — where a
  changed fee or due day starts to apply.
- **`billFromDayKey`** (on an assignment, later than its start): the first
  day rent is owed from. Monthly periods then run from that day; weekly ones
  keep the start's weekday and leave out the weeks that begin before it. The
  import sets it to the first day of the month after the last go-live month
  (the go-live months' bills are the import's own, under their own ids). The
  spreadsheet's history is payments only: nothing is ever owed for it.
  2026-11-19: without it the daily job billed every imported driver for
  every month since 2021 and a second time for Oct/Nov (Landa showed
  $628,910.96 owed). Repair: `tools-owner/fix-fleet-history-bills.mjs`
  (mistaken bills become `void` with `voidReason: "billed_by_mistake"`, on no
  list in the console).
- `billAfterReturn(bill, endDayKey, settings)` — what a bill the
  assignment's periods do not name (an imported month) is worth once the
  plate is back: used in full = unchanged, cut = `returnRule`, later = 0.
- `lateFeesToCreate(bills, settings, todayKey)` — one per open rent bill whose
  fee date (L4 above) has come, from `firstMonth` on, not waived.
- `allocatePayment(openBills, amountCents)` — late fees first, then oldest due
  first; leftover → credit. Returns `{allocations, creditAddedCents}`.
- `applyCredit(openBills, creditCents)` — same order.
- `driverBalance(bills, creditCents)` — owed, late, next due.
- `assignPersonalCents(activeDrivers)` — 1–99, stable, unique.

## 4. Server

One new callable `fleetAction {action, businessId, ...}` (actions below) and
one scheduled job `fleetDaily` (bills for the period, late fees; reminders in
phase 2). One failing assignment never stops the rest of the business's day or
its late fees (each has its own try/catch and a logged warning); a driver
marked "left" is never billed. Budget: four rarely used admin tools drop to `maxInstances: 1`.

| Action | Who | What |
|---|---|---|
| `settings_save` | admin | late fee, return rule, Zelle details, drivers-see-only switch |
| `driver_save` / `car_save` | staff | add / edit (admin for rent-related fields) |
| `assignment_start` / `assignment_end` | admin | car to driver with rent; return a car (bills cut by `returnRule`). Refused: `fleet_car_taken` (plate has an open assignment), `fleet_car_overlap` (start on or before the plate's last end day), `fleet_already_returned`. A return voids the late fees of bills that are gone (money on them becomes credit); a retried transaction credits once |
| `assignment_update {assignmentId, rentCents?, dueDay?}` | admin | change the plate fee / due day from the next period that has no bill; returns `{success, effectiveDayKey}`; refused `fleet_bad_input`, `fleet_already_returned`, `fleet_not_found` |
| `driver_leave {driverId, endDayKey}` | fleet (staff) | every open plate of the driver comes back on that day, driver set to "left"; returns `{success, ended}`. `driver_save` refuses status "left" while the driver has a plate (`fleet_driver_has_plate`) |
| `charge_add` | staff | one-off charge on a driver |
| `bill_waive` | admin | waive a bill, with reason (a waived rent bill voids its late fee) |
| `payment_record` | staff | cash/Zelle typed in; allocated oldest first |
| `payment_undo` | admin | back off the bills; credit back. After a plate return the part of an allocation no longer on its bill is taken from the driver's credit (then from later bills that credit paid) |
| `import_sheet` | admin | rows parsed from the sheet (§5), idempotent by `importKey` |

## 5. Import

`functions/fleet_import.js` (pure): sheet rows → drivers, cars, assignments,
payments, owed bills. Payments: a month cell ≥ $50 is a payment that month;
values under $50 and 1/0 markers are not payments. 0 in Oct/Nov 2026 → an
owed rent bill. The go-live months are the month of the first import and the
one before, kept on the business (`fleet.goLiveMonths`) so a later import
bills the same months. Cars by unique plate. Sanity totals the import must reproduce:
$863,265 total, 2,760 payments, 94 drivers; 2026 $221,729; Oct 2026 77 cars
(54 paying, 19 not working, 4 at $0).

## 6. Website (business console, sidebar group "Fleet")

Payments (grid driver × month), Drivers (list → driver page: bills,
payments, car, credit, History), Cars (list → car page: who had it when),
Paperwork (diamond/registration soonest first), Settings. Today gains fleet
tiles. English + French (`french-dom.ts`).

### Driver profile (office-only, decided 2026-11-11)

The driver page also shows **Joined** (start of the first assignment), **With
the company** (assigned days added up, overlaps and gaps not counted), the
current car, then three panels: **Track record** (newest first: joined, cars
given/returned, rent changes, left/back after a gap over 30 days, old TLC
licenses, friends who drove, late fees, charges, waived bills, notes, office
edits), **Office notes and files**, **Friends who drove**. Drivers never see
any of it.

- `fleetNotes/{id}`: `businessId, driverId, text, files[{path,name,contentType,size}], byUid, byName, atMs, createdAt, voided?{byUid,byName,atMs}`.
  Actions `note_add` (staff), `note_void` (admin; never deleted, shown greyed).
  Files are uploaded by the browser first to Storage
  `fleetDocs/{businessId}/{driverId}/{random}-{name}` (storage.rules:
  owner or `fleet`/`fleet_admin` staff by token claims, image or PDF under
  10 MB, create only); `note_add` re-checks the path prefix, type and size.
- `fleetSubstitutes/{id}`: `businessId, driverId, carId, name, phone, tlcLicense, address, fromDayKey, toDayKey, byUid, createdAt, voided?`.
  Actions `substitute_save` (staff; refuses `fleet_friend_overlap` on the same
  car and toDayKey < fromDayKey), `substitute_void` (admin). The main driver
  stays responsible for rent and charged tickets.
  `whoDroveAt(assignments, substitutes, carId, dayKey)` (server
  `fleet_billing.js`, mirrored in `fleet-billing.ts`, shared fixture
  `whoDroveCases`) is what phase 3 uses to put the friend's name on a ticket.
- `driver_save` keeps the previous TLC license: `licenseHistory[{license,
  fromDayKey|null, toDayKey}]`, with `tlcLicenseSince` for the current one.
- Firestore rules: both collections read by `fleetRead`, write false.
  Edit lines on the track record read History (`lotLedgerAudit`,
  entityId = the driver).

## 7. Phases

1a office (this spec) → 1b Zelle automatic (bank feed, personal cents, "I
paid", WhatsApp question) → 2 drivers (accounts, WhatsApp reminders/receipts,
app pages, insurance proof, lock to the business) → 3 city tickets.

## 8. Phase 1b: Zelle deposits pay drivers (built 2026-11-12)

Owner, 2026-11-12: deposits in the business's connected bank (Plaid, the
same link as the counter's Check bank) pay drivers' bills by themselves; the
business chooses how often Laawol asks the bank on pay days and sees what it
costs before saving.

- **Matching** (`fleet_bank.matchDeposit`, run after every bank sync in
  `index.js syncBankLink` -> `fleet_handlers.matchBankDeposits`): only
  deposits with a sender, after go-live (`BANK_MATCH_START_MS`, or when
  Fleet was switched on), not removed, not already used (a shop sale, a
  driver). 1) a sender remembered for exactly one active driver; 2) else the
  amount's cents equal exactly one active driver's personal cents. Paid like
  a hand-recorded payment (late fees, oldest first, rest to credit) with
  `method: "zelle"`, `bankTxnId`, `matchedBy`; the deposit gets
  `consumedBy {kind: "fleet_payment", id}` in the same transaction, and the
  sender is remembered on the driver. Otherwise the deposit gets
  `fleetWaiting: true` + `fleetWaitingReason` (`unknown` / `two_drivers` /
  `undone`).
- **Office**: Fleet payments shows "Zelle from the bank" (`bank_status`):
  the bank, the waiting deposits, "Check bank now" (`bank_check_now`, the
  counter's paid refresh under its once-a-minute rule and monthly limit) and
  "Pay this driver" (`bank_assign`, staff; the sender is remembered). Undoing
  a bank payment gives the deposit back to the waiting list.
- **Pay-day schedule** (Fleet settings, Fleet admin, `bank_schedule_save`):
  `fleet.settings.bankSchedule {every: 0|15|30|60, fromHour, toHour (New
  York), monthDays [1..28], mondays}`; off by default. The panel shows
  checks/month and $/month live (`bankScheduleQuote`, console mirror
  `lib/fleet-bank.ts`, shared fixture `test/fixtures/fleet-bank-cases.json`)
  at the business's Bills price for a bank check, else Plaid's $0.12.
  Estimate: 15 min, 7 AM-11 PM, 1st-3rd = 192 checks = $23.04.
- **Job** `fleetBankRefresh` (every 15 minutes, maxInstances 1): a business
  whose schedule is due gets one paid `/transactions/refresh` + a sync;
  counted as `scheduledRefreshes` on `businessBankUsage` (outside the
  counter's monthly limit) and billed with the month's bank checks
  (`platform_billing_handlers.bankUsage`).
- Tests: `test/fleet-bank.test.js` (pure), `test/fleet-bank-callables.test.js`
  (emulator, in `npm run test:fleet`), `admin_web/src/lib/fleet-bank.test.ts`.
- Next (phase 2): drivers see their personal cents and Zelle details,
  WhatsApp receipt per payment, "I paid", WhatsApp question for unknown
  deposits.

## 9. Phase 2a: drivers on WhatsApp (built 2026-11-12)

Owner, 2026-11-12: WhatsApp only for drivers for now (no app pages yet);
off until the business sends itself a test and switches it on; the
unknown-deposit question waits (the office's "Zelle from the bank" list).

- **Switch**: `fleet.settings.whatsapp.enabled` (Fleet admin,
  `whatsapp_save`), off by default. `whatsapp_test {phone}` sends a sample
  receipt and reminder to that phone (no driver named).
- **Only these drivers** (a test or a pilot):
  `fleet.settings.whatsapp.onlyDriverIds`, saved with `whatsapp_save
  {enabled, onlyDriverIds}` (up to 50, each a driver of the business).
  When the list is set, receipts and reminders go to those drivers only;
  an empty list means every active driver; leaving it out keeps the list.
- **Send a WhatsApp reminder** (driver page, Fleet staff,
  `whatsapp_remind_driver {driverId}`): the reminder for the driver's
  oldest open bill, now (soon / today / late from its due day). Its own
  message id `reminder_manual_{driver}_{bill}_{day}`: once a day per bill.
  Refused when WhatsApp is off for the driver, they owe nothing, have no
  phone, or have left.
- **Receipt** (`fleet_receipt_2lang`, Utility, bilingual): after every
  recorded payment (`payment_record`, a bank deposit matched or picked by
  the office), never for imported history. Says the amount, the day, and
  what is still owed or the credit.
- **Reminder** (`fleet_rent_reminder_2lang`; wording fixed by Meta, only the
  values change): about each active driver's oldest open **rent** bill
  (never a late fee or charge: those only add to the amount, and a driver
  who owes only those gets no automatic reminder), 2 days before its due
  day, on the day, 3 days after, then every 7 days while open. **Looking
  ahead** (2026-11-20): a month's bill is only made on its first day, so for
  each active driver with an open assignment whose next period is due in
  exactly 2 days and has no bill yet, the "soon" reminder is sent for that
  coming period (nothing is created; `fleet_billing.rentPeriods` rules:
  billFromDayKey, rentHistory, endDayKey). Id
  `reminder_<driver>_soon_<assignment>_<periodFrom>`. At most one automatic
  reminder per driver a day (the look-ahead yields to a regular one).
  The amount stated is what is owed (coming fee included for a look-ahead)
  **minus the credit the driver holds**, never below zero; at zero nothing
  is sent (the manual button refuses with "owes nothing"). It names the
  business's Zelle (settings zelle name + handle) and the plain amount. The
  driver is greeted by `driverDisplayName` (office notes like "#49" or
  "STORAGE 2/14/25" cut, same rule as the console), in receipts too.
  Nothing goes to a driver who has left (their payment's receipt still does).
  Sent once a day from 10 AM New York by `fleetBankRefresh`
  (`fleet.remindersSentDayKey`, set only after the pass finished without a
  failed send; a pass with failures is looked at again every 15 minutes that
  day, and a pass that sent everything is not repeated).
- **No Zelle address**: `whatsapp_save {enabled: true}` is refused with
  `fleet_zelle_missing` ("Add the Zelle email or phone in Fleet settings
  first.") while `fleet.settings.zelle.handle` is blank; reminders (daily
  and manual) are skipped while it is blank, logged once a business a day
  (`fleet.remindersZelleLoggedDayKey`).
- **Rows**: `fleetMessages/{receipt_<paymentId> | reminder_<driver>_<bill>_<day>
  | reminder_<driver>_soon_<assignment>_<periodFrom> | test_...}` status
  queued / sent / failed / stopped / skipped (no phone), with `attempts`.
  A row that is `failed`, or `queued` for over 10 minutes (a crash), is sent
  again by a later call with the same id, 3 attempts in all; `sent`,
  `stopped` and `skipped` rows are final, so nobody gets a message twice.
  Server-only collection.
- Pure: `fleet_whatsapp.js` + `test/fleet-whatsapp.test.js`; emulator:
  `test/fleet-whatsapp-callables.test.js` (in `npm run test:fleet`).
- Templates submitted with `~/laawol-deploy-logs/create_fleet_templates.py`
  on 2026-11-12. Meta first rejected the reminder as INCORRECT_CATEGORY;
  reworded as "Payment reminder from {{2}}: your rent bill {{3}}..." and
  resubmitted. Turn WhatsApp to drivers on only once both are APPROVED.

## 10. Payment proof on WhatsApp (2026-11-19)

Replaces the personal cents of sections 1, 2, 8 and 9: a driver sends the
Zelle screenshot to Laawol's WhatsApp number as a claim, and the deposit in
the business's bank is the proof. `fleetDrivers.personalCents` is no longer
assigned, shown or used (old values stay stored); reminders say the plain
amount owed. Spec, matching rules, conversation, timers and the office API:
docs/FLEET_PAYMENT_PROOF.md. Code: `fleet_claims.js` (pure, tested in
`test/fleet-claims.test.js`), `fleet_bank.matchDeposit`, the claim and bank
parts of `fleet_handlers.js` (`test/fleet-claims-callables.test.js`), the
inbound hook in `whatsapp_conversations.handleInbound`, the picture reading
in `index.js` (`ANTHROPIC_API_KEY` on `whatsappWebhook`). Q2: a payment whose
bank date is on or before the late-fee day and that covers the rent bill
voids that bill's unpaid late fee (`voidReason: "paid_on_time"`).

## 11. The driver's own account in the app (2026-11-25)

Owner, 2026-11-25: "build the driver screens in the app". Phase 2's app
pages, first cut: Home, Payments, My plate, Settings. Drivers pay by Zelle
only (Q13) and report a payment by sending the screenshot on WhatsApp
(section 10); the app shows where that report stands.

- **Who is a driver**: the signed-in account's VERIFIED phone (the token's
  `phone_number`, else the auth record's) is the `phone` of a `fleetDrivers`
  record of a business with Fleet on. No business id is asked, so a driver
  can never ask for someone else's records. An account with no verified
  phone, or a phone on no driver, is a regular customer.
- **Server**: `fleetAction {action: "driver_home"}` (no `businessId`) →
  `{success, todayKey, proofWhatsApp, onlyFleet, fleets: [{businessId,
  businessName, businessPhone, onlyFleet, zelle {name, handle}, driver {id,
  name, status, creditCents}, balance {owedCents, lateCents, nextDueDayKey,
  nextDueCents}, plates [...], bills [...], payments [...], claims [...]}]}`.
  Shaped by the pure `functions/fleet_driver_view.js`
  (`test/fleet-driver-view.test.js`; emulator
  `test/fleet-driver-callables.test.js` in `npm run test:fleet`).
  Bills: open, paid and waived (void ones are nobody's), every open one and
  the 60 newest closed. Payments: recorded ones, the 60 newest; spreadsheet
  history says `method: "import"`. Claims: the open ones, as `checking`
  (waiting for the bank), `reply` (we asked the driver something on
  WhatsApp) or `office`. A driver who left is shown while they owe or still
  hold a plate, then is a regular customer again.
- **Never in the answer**: office notes, the track record, friends who
  drove, remembered payer names, who recorded a payment, bank ids, the
  screenshot or the name read from it, the VIN, the premium, the insurance
  policy number (owner, 2026-11-26; the insurer's name is shown), other
  drivers.
  Both test files assert it.
- **Fleet only (Q11)**: `fleet.settings.driversSeeOnlyThisBusiness` (on
  unless the Fleet admin switched it off; the switch is already on the
  console's and the app's Fleet settings). On → the driver's account stands
  where the customer home would (`FleetDriverHost` in
  `customer_home_screen.dart`): four places, Settings without the
  marketplace rows (`SettingsScreen(fleetDriverOnly: true)`). Off → the
  regular home with a "Your plate" card (`FleetDriverHomeCard` on the Home
  tab) that opens the same three pages with a way back.
- **App**: pure model and wording rules `lib/services/fleet_driver_app.dart`;
  call, kept copy and controller `lib/services/fleet_driver_service.dart`
  (the last answer is kept per account in SharedPreferences so the account
  opens at once, "not a driver" included; signing out forgets it; a failed
  refresh keeps what is shown and says so); screens
  `lib/screens/fleet_driver_shell.dart` (host, shell, card) and
  `fleet_driver_tabs.dart` (Home, Payments, My plate). A phone-only account
  waits for the first answer behind a spinner, 6 seconds at most
  (`FleetDriverController.settleAfter`), so a driver never sees the
  marketplace flash by. Refreshed on pull, and when the app comes back to
  the front (20 s apart at least). Words: `fdr*` keys, English and French;
  days read "Dec 1, 2026" in English and "1er déc. 2026" in French
  (`driverDayLabel`).
- **"Send my payment screenshot"** opens the in-app page of section 14.
  WhatsApp stays as the other way, from that page: the chat with Laawol's
  number (`proofWhatsApp`: `fleet_driver_view.PROOF_WHATSAPP`, or the
  functions env `WHATSAPP_DISPLAY_NUMBER`) with a line ready to send.
- **Not built**: a Messages page, insurance proof upload, city tickets
  (phase 3), card payments (Q13 says Zelle only).

## 12. Push alerts to drivers (2026-11-25)

Owner, 2026-11-25: "do the push alerts". A driver with the app gets a push
beside each WhatsApp message Fleet sends them:

| Push | When | Words (`fleet_driver_push.driverPushText`) |
|---|---|---|
| `receipt` | a payment was recorded (`sendReceipt`) | "{business}: payment received" + the amount and what is left |
| `reminder` | the daily or the manual rent reminder (soon / today / late) | "{business}: plate fee due soon / due today / late" + the due day and what is owed |
| `not_received` | a reported payment the bank has not shown after 2 days (`runClaimTimers`) | "{business}: payment not found yet" |

- **Who**: the same drivers as WhatsApp, no one else: a push only goes
  where a WhatsApp message was tried (`whatsapp.enabled`, the
  `onlyDriverIds` pilot list, never a driver who left). Turning messages on
  for drivers turns the push on with them.
- **Which phone**: the account Firebase Auth holds the driver's number as
  VERIFIED for (`getUserByPhoneNumber`), never a number typed into a
  profile. No account (the driver has not installed the app): no push.
- **Once**: one push per `fleetMessages` row (`pushAtMs`, set in a
  transaction), however often the WhatsApp send is retried; the claim's own
  `toldLateAtMs` guards the third. A push that cannot be sent never fails
  the payment or the reminder.
- **Language**: the account's (`recipientLanguage`). Preference
  `carActivity`; push only (no email, no text); it also lands in the
  account's notification list. `data: {type: "fleet_driver", kind,
  businessId}`.
- **App**: `noteFleetDriverPush` (called by `PushNotificationService` for
  every push that arrives or is tapped) bumps `fleetDriverNews`;
  `FleetDriverHost` reads the account again. A tap opens the app on its
  home, which for a locked driver is their account.
- Code: `functions/fleet_driver_push.js` (words + `createDriverPusher`),
  `pushDriver` in `fleet_handlers.js`, `fleetDriverPusher` in `index.js`
  (the Auth lookup is skipped under the emulator). Tests:
  `test/fleet-driver-push.test.js`, `test/fleet-driver-push-callables.test.js`
  and the "2 days" case of `test/fleet-claims-callables.test.js`.
- Deploy: every function that sends a Fleet message (`fleetAction`,
  `fleetDaily`, `fleetBankRefresh`, `whatsappWebhook`, `plaidWebhook`,
  `connectBusinessBank`, `checkZellePayment`).

## 13. The fleet business's own shipping, for a locked driver (2026-11-25)

Q11 says a driver sees their fleet business's Fleet pages **and its other
services**, never another business. Owner, 2026-11-25: build it.

- `driver_home` adds `shipping: {enabled, sendSlug}` per fleet
  (`fleet_driver_view.shippingOf`): `enabled` when the business is approved
  and has a shipping service (`barrelShipping`, `sharedBarrels`, `freight`);
  `sendSlug` = its request link's name when it takes package requests
  (`packageRequestSettings.acceptRequests` and a `requestSlug`), else "".
- A LOCKED driver's Home ends with "Shipping with {business}": **Send a
  package** (only with a `sendSlug`) opens the customer request form pinned
  to that business (`PackageRequestFormScreen(slug:)`, the `/r/<slug>` path:
  the server lists that business's options only), and **My packages** opens
  `MyPackagesScreen(onlyBusinessId:)`, which drops every other business's
  packages (and reads on, five pages at most, when that business's sit on a
  later page). Opened from the regular home (switch off) the block is not
  shown: the regular app already has shipping.
- Not included: the business's car sales or parking for a locked driver
  (the customer screens for those list every business), and the list of
  package requests the driver made (the form's own confirmation and the
  WhatsApp messages cover it).

## 14. Reporting a payment from the app (2026-11-26)

Owner, 2026-11-26, on his first real-phone test: "send my payment
screenshot just redirects me to whatsapp why", then "go ahead" to sending
it inside the app. The button used to open WhatsApp and leave the driver to
attach the picture there.

- **App** (`lib/screens/fleet_driver_proof_screen.dart`): choose the
  screenshot (library, or the camera), see it, check the amount (what is
  owed is typed in already), Send. The picture is kept for another try when
  a send fails; Send cannot be tapped twice; a picture over 6 MB is refused
  on the phone. Then one of five answers in the app's own words: we are
  checking with the bank / already reported / already on your account /
  the business will look at it (payment to someone else, or too old) / not
  a payment screenshot (choose another). "Send it on WhatsApp instead"
  stays at the bottom.
- **Server**: `fleetAction {action: "driver_claim", businessId, imageBase64,
  amountCents, lang}` → `{success, outcome, amountCents, reason}`, outcome
  `waiting` | `duplicate` | `already_paid` | `office` | `not_a_payment`.
  The caller's verified phone must be on a driver of THAT business
  (`fleet_not_driver`); the file must be a JPG, PNG or WebP by its first
  bytes, up to 6 MB (`fleet_claim_image`); the amount is required
  (`fleet_claim_amount`); ten reports a day per driver
  (`fleet_claim_too_many`).
- **Same claim as WhatsApp**: `driverClaim` runs `pictureFromDriver` with a
  context of its own, so the reading, the wrong-recipient and too-old rules,
  the duplicate and already-recorded checks, the bank matching and the
  timers are the ones of section 10. Differences: the typed amount is used
  when the picture cannot be read (nothing is asked later); the claim
  carries `source: "app"` and `fileUrl`; no WhatsApp reply is sent (the app
  says it). It does not need WhatsApp to drivers to be on.
- **The picture**: stored by `storeClaimImage` under
  `fleetClaims/{businessId}/{driverId}/…`, only when a claim is made for it
  (a repeat or a non-payment keeps nothing), registered in `whatsappMedia`
  so the 12-month sweep deletes it. The office opens it with `claim_photo`
  like a WhatsApp one (`hasPhoto`); its address never goes to a phone.
- `fleetAction` now holds `ANTHROPIC_API_KEY` (the picture reader).
- Tests: `test/fleet-driver-claim-callables.test.js` (emulator), the
  screenshot-page cases of `test/fleet_driver_screens_test.dart`.


## 15. One Fleet page with tabs (2026-11-26)

Owner: "i love this new desing. but please make sure that everything that
existed in the old one is still accessible in this new one". Approved on a
Claude Design prototype (canvas FF7Q2ZqXrz9HzeyE6Wqp6z).

- The five sidebar items (Fleet payments, Drivers, Plates, Paperwork, Fleet
  settings) are one item, **Fleet**, in Overview. The page has tabs
  **Needs you · Drivers · Plates · Payments · Paperwork**; the gear (Fleet
  admins only) opens Fleet settings. Each tab is the page that was its own
  item, unchanged, so every filter, form and button is where it was.
- Old ids still work: `fleetViewForTab` (lib/fleet-home.ts) sends
  `fleetPayments`, `fleetDrivers`, `fleetCars`, `fleetPaperwork`,
  `fleetSettings` to their tab; a pin on any of them is a pin on Fleet.
- **Needs you** (`needsItems`): bank take-backs, drivers' screenshots the
  office must act on (state `office`, or waiting on the bank when a deposit
  of the same amount came in), unmatched deposits, late drivers (WhatsApp
  reminder button + Record a payment), plates with no driver (days idle and
  the last fee prorated: "plate fees missed"), diamond/registration expired or
  within 30 days, and one line for missing dates. Most money first. Every
  button opens the existing form or tab; nothing new writes.
- **Search**: drivers (name, phone, plate) and plates (plate, company); a
  plate and a day ("T712 Oct 3", "10/3", "3 oct") answers who had it that day
  and the friend who drove it (`plateOnDay`, `whoDroveAt`), with "Charge this
  ticket" opening that driver's Add a charge, prefilled.
- **New**: Add driver, Add plate, Record a payment and Add a charge (ask which
  driver, then open their form), Import from spreadsheet (admins). A free
  plate's page and Needs you have "Give to a driver": pick a driver with no
  plate, then their Give a plate opens with the plate and its last fee filled.
- One `bank_status` read and one open-claims listener per Fleet page, shared
  by Needs you and Payments. A one-time note tells staff where the items went
  (`laawol:notice:fleet-one-page-2026-11`, until 2027-02-01).

## 16. Pick lists on every Fleet form (2026-11-26)

Owner rule: anything that can be chosen from a list is a list, not a typed
box. Components in `admin_web/src/components/business/fleet-pickers.tsx`,
pure helpers (tested) in `admin_web/src/lib/fleet-pickers.ts`.

- **Plate:** Company, Insurer and Insurance paid by are pick-or-add lists of
  the values the business already uses (case and spacing folded, so typing
  "dala cars inc" picks "Dala Cars Inc"); "paid by" always offers The company
  and The driver. The car is make / model / year from the canonical catalog
  (`car-catalog.ts`), still saved as one `vehicleType` line ("Toyota Camry
  2021"); a full VIN fills them (`lib/vin-decode.ts`, shared with the car
  listing form). A saved line the catalog cannot read is kept until a make is
  picked. Insurance due day is 1–28.
- **Driver and friend who drove:** phone uses the shared calling-code field;
  the street is the Google address lookup (`AddressAutocomplete`) and fills
  city, state and ZIP; state is the full US list (saved as the 2-letter code),
  city is that state's list with "Other city" for anything else.
- **Days:** the rent due day, a fee change's due day and the late-fee day are
  1–28 lists; weekly rent picks Monday … Sunday (stored 1–7).
- **Charge:** the reason is a list (Ticket, Toll, Damage repair, Insurance
  deductible, Something else) plus details; saved as one label "Ticket ·
  T712000C · Oct 3". "Charge this ticket" from the search arrives split.
- Kept typed on purpose: names, plate, VIN, TLC licence, policy number,
  amounts, ZIP, notes and Zelle details (free values by nature).

## 17. Fleet leads, Requests next (2026-11-26)

Owner, 2026-11-26: Landa's main work is plate leasing; for shipping they only
answer requests that come from Laawol customers, not register packages. So:

- **Website.** When the viewer may open Fleet (business has the `fleet` service
  and the person holds `fleet` or `fleet_admin`), the menu starts Fleet,
  Shipping, Today, and the console opens on Fleet (Needs you) instead of
  Today. Shipping already opens on its first step, Requests. A link or a
  notification that opened another section is left alone. Staff without Fleet
  keep the usual order and Today. Pure rules: `fleetLeads`, `fleetFirstTabs`,
  `landingBusinessTab` in `admin_web/src/lib/business-sidebar.ts` (tested).
- **App.** Same rule as the website, no server change: whoever may open Fleet
  gets a home that starts with the Fleet block (Needs you, Drivers, Plates,
  Payments, Paperwork, each opening the Fleet page on that tab), then the
  Requests row (always shown, with the open count; only for someone who may
  ship), then Today, then every usual block folded under "More shipping"
  (`HomeFold`, closed at first). The folded shipping block drops its own
  Requests row so it is never shown twice. The `mainWork` setting is not
  used for this (the server accepts only the works it knows). Pure rule:
  `homeLeads` in `lib/services/business_home.dart`; tests in
  `test/home_fleet_leads_test.dart`. The Fleet page itself now opens on
  Needs you with tabs Drivers, Plates, Payments, Paperwork and the gear for
  settings, like the website, and its forms use the same pick lists
  (section 16).
- Requests reach a business only while it takes requests (Shipping >
  Requests > Request settings) and has a price list for the country.

**Each person's copy of the services (2026-11-27).** The app reads
`users/{uid}.businessServices`, the website reads the business. The switch
used to write only the business, so Landa's team never saw Fleet lead in the
app. Now `fleet_enable` copies the services (Fleet as the switch says) to every
owner and staff member, the 15-minute Fleet tick repairs any copy that drifted,
and `updateBusinessProfile` keeps Fleet exactly as it was
(`fleet_member_services.js`).

## 18. Fleet alerts to admins (2026-11-26)

Owner, 2026-11-26: admins hear about Fleet activity they did not do; not too
many alerts; routine activity grouped (owner picked "grouped", not an evening
summary).

**Who.** The business owner(s) and people holding `fleet_admin` (full-access
staff hold it). Never the person who did it (`byUid` / the caller). Events
with no admin behind them (the bank, a driver's WhatsApp screenshot, the
daily run) go to every admin. Never another business's people, never a
blocked account. Push + inbox entry only (never email, never SMS), each in
the person's own language. Delivered on today's apps (tap routing and the
setting come with the next store build).

**Setting.** `notificationPreferences.fleetAlerts`: `"all"` (default) |
`"needs"` (only "Needs you") | `"off"`. Unknown or missing = `"all"`.

**Kinds** (`data.fleetKind`):

| Kind | Level | When | Sent |
|---|---|---|---|
| `deposit_waiting` | needs | a bank deposit could not be given to a driver (any waiting reason, incl. possible duplicate); only the first time it starts waiting, never on a re-match of the same deposit | at once |
| `claim_needs_office` | needs | a driver's screenshot report needs the office to decide | at once |
| `bank_took_back` | needs | the bank removed a deposit that had paid a driver | at once |
| `plate_added` | info | a new plate (not an edit) | grouped |
| `driver_added` | info | a new driver (not an edit) | grouped |
| `payment_recorded` | info | a payment recorded by a person (not the bank, not the import) | grouped |
| `bank_matched` | info | the bank paid drivers by itself | one alert per bank check, listing the count, total and first names |

Grouped = the staff-activity pattern (`staff_activity_alerts.js`): per
(business, kind, actor) a 10-minute window; the first event goes at once, the
rest are counted and the scheduled flush sends one summary ("Moussa added 3
more drivers"). Edits, notes, charges, waives, settings: no alert.

**Push data.** `type: "fleet_alert"`, `businessId`, `fleetKind`, `fleetTab`
(`needs|drivers|plates|payments|paperwork`), and when known `driverId`,
`carId`, `paymentId`. Tap: needs kinds -> Fleet, Needs you; `plate_added` ->
that plate; `driver_added` and `payment_recorded` -> that driver (Payments
when no driver); `bank_matched` -> Fleet, Payments. Drivers never receive
these, and an alert never carries the insurance policy number.
