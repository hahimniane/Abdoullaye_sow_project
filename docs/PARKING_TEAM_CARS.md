# A team member's own car on the lot

Decided with the owner on 2026-10-31 (all recommendations, "yes build it"):

1. **"Whose car?"** — adding or editing a parked car (console and app) asks
   **Team member** or **Someone else**. Team member = pick from the owner
   and every staff member of the business (any permissions). Someone else =
   name + phone as today (past customers suggested, or a new person).
2. **A team member's car is tied to the person** (`forStaffId`), not to a
   phone number: Month end bills it under them, their lot expenses net
   against it, Staff balances shows it as their parking bill — even with no
   phone on their profile. No customer account is made for it.
3. **Old cars** typed with a team member's linked number get tied too — the
   owner reviews the list first. From then on a car typed with a linked
   member's number is tied automatically (staff who type instead of pick).
4. **No customer WhatsApp for team cars**: no parked message, receipt,
   welcome or monthly invoice. Settled in Staff balances / Month end.
5. **Anyone who can add parking** may pick or change the team member; each
   change is in the car's History with who did it.

Defaults: a team car is charged at whatever daily rate is entered; a member
who leaves keeps their cars ("former team member"); team cars show a small
"Team" label in the parking list.

## Data

`parkedCars`:

- `forStaffId` — the team member's uid; absent for a customer's car.
- `forStaffName` — their name when tied (for display and History).
- `customerName` / `customerPhone` — for a picked member: the parking
  customer the owner linked to them in People (`staffParkingLinks[uid]`
  `customerName` / `customerPhone`), else their profile name and `""`.
  For an auto-tied car: what staff typed (kept).

## Server (no new function)

Pure `my_flutter_app/functions/parking_team.js`: `isTeamMember`,
`teamCarFields`, `linkedStaffForPhone` (unique link whose number has the
same last ten digits; two links on one number tie nobody), `teamCustomerKey`
(`staff:{uid}`), `staffIdOfKey`.

- `createBusinessParkingEntry` takes optional `forStaffId`. With it, name and
  phone are not required (filled from the member); a uid outside the team
  is refused `team_member_invalid` (failed-precondition, `details.reason`).
  Without it, a phone matching a link ties the car (`forStaffId`,
  `forStaffName`; typed name/phone kept).
- `updateBusinessParkingEntry` `changes.forStaffId`: a uid ties (name and
  phone refilled from the member), `""` unties (the car then needs a
  customer name and phone like any car — `invalid-argument` otherwise).
  Left out: the tie stays; an untied car whose number is linked gets tied.
  History line: `Team member: — → Musa Kante` / `Musa Kante → —`.
- `parkingCustomerKey(bill)` → `staff:{forStaffId}` when tied, else the
  phone / name key as before. Month statement items (month cars and carried
  cars) carry `forStaffId`; each customer carries `forStaffId` (`""` for a
  customer).
- `netStaffExpenses`: a `staff:{uid}` customer is that member's without a
  link; each member's credit is used once across all their bills, **their
  own `staff:` bill first**, then a bill still under their linked number
  (cars not yet tied); `businessOwes[].customerKey` prefers `staff:{uid}`.
- Customer WhatsApp off for tied cars (`carIsMessageable`, welcome list);
  monthly invoices skip `staff:` customers; phone accounts skip tied cars
  (`recordPhones` → none).

Shared fixtures (server, console and app must agree):
`test/fixtures/parking-carryover-cases.json` (last case: team cars group
under `staff:{uid}`, a same-number untied car stays apart) and
`test/fixtures/staff-expense-credit-cases.json` (last two cases: own bill
first, then the linked number's; no link needed).

## Clients

Console (`operations-panels.tsx` add + edit forms, parking list) and app
(`park_car_screen.dart` add + edit, parking list):

- **Whose car?** segmented choice: **Someone else** (default) | **Team
  member**. Team member shows a picker of the owner + every staff member
  (reuse the existing staff list sources: console `useBusinessStaff`, app's
  staff query used for "Received by"), names only. Choosing one hides the
  name/phone fields and sends `forStaffId`; the form shows "Their parking
  goes on their Staff balances. No WhatsApp is sent." Someone else = the
  current fields and suggestions unchanged (team members are no longer mixed
  into the customer suggestions).
- Edit: the same choice, prefilled from the car (`forStaffId`).
- Parking list / car details: a small **Team** label next to the owner name
  of a tied car (and "former team member" when the uid is no longer on the
  team list).
- Month end customer card for a `staff:` customer: a "Team member" label.
- Mirrors: console `parking-month-statement.ts` / app
  `parking_month_statement.dart` `parkingCustomerKey` + items/customers
  `forStaffId`; console `staff-expense-credit.ts` / app
  `staff_expense_credit.dart` `netStaffExpenses` — identical rules, pinned
  by the shared fixtures above.
- Every new string in English and French.
