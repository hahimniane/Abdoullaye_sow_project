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

## 7. Phases

1a office (this spec) → 1b Zelle automatic (bank feed, personal cents, "I
paid", WhatsApp question) → 2 drivers (accounts, WhatsApp reminders/receipts,
app pages, insurance proof, lock to the business) → 3 city tickets.
