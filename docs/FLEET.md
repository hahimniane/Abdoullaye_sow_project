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
| Q8 | Overpay → driver credit, applied to the next bill automatically. |
| Zelle (11/05) | **No staff step.** Each active driver has personal cents (the amount is the code). A driver taps "I paid" (amount + sender name); the bank must agree. An unknown deposit is asked to drivers on WhatsApp; only a true two-driver dispute goes to the owner. Phase 1b. |
| Q10 | A car returned mid-period: a Fleet setting the admin picks — `full` period or `days` used (pro rata by day). |
| Q11 | Drivers see only their fleet business on Laawol (its Fleet pages and its other services), never other businesses. Setting on by default; the Fleet admin can turn it off. **Fleet drivers only** — other customers keep the marketplace (Q12). Phase 2. |
| Q13 | Drivers pay by **Zelle only**. No card or bank payments in the app. |
| Q14 | Import the sheet as past payments. A 0 in the current month or the one before (Oct and Nov 2026) becomes an owed bill; older 0s carry no debt. |
| Q15 | A city ticket shows to a driver only after the office presses "Charge driver". Phase 3. |
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
  "driver"|"company", status "active"|"inactive", importKey`.
- `fleetAssignments/{id}`: `businessId, carId, driverId, startDayKey,
  endDayKey|null, rentCents, period "weekly"|"monthly", dueDay (monthly 1–28,
  weekly 1=Mon…7=Sun), createdBy`.
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
  period containing `throughDayKey` (monthly: calendar months starting on the
  start's due day; weekly: weeks ending before the due weekday).
- `rentBillsToCreate(assignment, existingBillIds, throughDayKey, settings)` —
  idempotent; a period cut by `endDayKey` follows `returnRule`.
- `lateFeesToCreate(bills, settings, todayKey)` — one per open rent bill whose
  due day has passed the office's fee day, from `firstMonth` on, not waived.
- `allocatePayment(openBills, amountCents)` — late fees first, then oldest due
  first; leftover → credit. Returns `{allocations, creditAddedCents}`.
- `applyCredit(openBills, creditCents)` — same order.
- `driverBalance(bills, creditCents)` — owed, late, next due.
- `assignPersonalCents(activeDrivers)` — 1–99, stable, unique.

## 4. Server

One new callable `fleetAction {action, businessId, ...}` (actions below) and
one scheduled job `fleetDaily` (bills for the period, late fees; reminders in
phase 2). Budget: four rarely used admin tools drop to `maxInstances: 1`.

| Action | Who | What |
|---|---|---|
| `settings_save` | admin | late fee, return rule, Zelle details, drivers-see-only switch |
| `driver_save` / `car_save` | staff | add / edit (admin for rent-related fields) |
| `assignment_start` / `assignment_end` | admin | car to driver with rent; return a car (bills cut by `returnRule`) |
| `charge_add` | staff | one-off charge on a driver |
| `bill_waive` | admin | waive a late fee or charge, with reason |
| `payment_record` | staff | cash/Zelle typed in; allocated oldest first |
| `payment_undo` | admin | back off the bills; credit back |
| `import_sheet` | admin | rows parsed from the sheet (§5), idempotent by `importKey` |

## 5. Import

`functions/fleet_import.js` (pure): sheet rows → drivers, cars, assignments,
payments, owed bills. Payments: a month cell ≥ $50 is a payment that month;
values under $50 and 1/0 markers are not payments. 0 in Oct/Nov 2026 → an
owed rent bill. Cars by unique plate. Sanity totals the import must reproduce:
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
- **Receipt** (`fleet_receipt_2lang`, Utility, bilingual): after every
  recorded payment (`payment_record`, a bank deposit matched or picked by
  the office), never for imported history. Says the amount, the day, and
  what is still owed or the credit.
- **Reminder** (`fleet_rent_reminder_2lang`): for each active driver's
  oldest open bill, 2 days before its due day, on the day, 3 days after,
  then every 7 days while open; says the amount owed, Landa's Zelle
  (settings zelle name + handle) and the exact amount to send (whole
  dollars owed + the driver's personal cents). Sent once a day from 10 AM
  New York by `fleetBankRefresh` (`fleet.remindersSentDayKey`).
- **Rows**: `fleetMessages/{receipt_<paymentId> | reminder_<driver>_<bill>_<day>
  | test_...}` created once (never sent twice), status queued / sent /
  failed / stopped / skipped (no phone). Server-only collection.
- Pure: `fleet_whatsapp.js` + `test/fleet-whatsapp.test.js`; emulator:
  `test/fleet-whatsapp-callables.test.js` (in `npm run test:fleet`).
- Templates submitted with `~/laawol-deploy-logs/create_fleet_templates.py`
  on 2026-11-12. Meta first rejected the reminder as INCORRECT_CATEGORY;
  reworded as "Payment reminder from {{2}}: your rent bill {{3}}..." and
  resubmitted. Turn WhatsApp to drivers on only once both are APPROVED.
