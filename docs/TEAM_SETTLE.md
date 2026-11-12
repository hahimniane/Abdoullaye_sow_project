# "I paid everything" - a team member settles their month

Owner, 2026-11-11 (decisions Q1-Q8). Server + website; the phone app is the
next build.

A team member's Month end card is a STATEMENT (PARKING_INVOICES.md section 6):
parking and jobs - expenses + cash held = "Owes the business $X". One action
pays it.

## Rules

- The member presses **I paid everything** on their own card (amount prefilled
  with the statement). The owner, Full access and platform admins can file it
  for a member; naming themselves (or the Business account) as the receiver
  confirms it at once.
- **What it is for:** Everything (the cash they hold first, then their own
  parking and jobs), Only the cash I hold, Only my parking. Any amount up to
  what that scope owes (`team_settle.js` `teamSettlePlan`).
- **Receiver:** the owner, someone with Full access, or the Business account
  (the owner or Full access confirms those). Never ordinary staff.
- **Frozen:** the amount, the split and the statement's number are stored when
  it is filed. Confirming records exactly that; if the statement can no longer
  take it (a later edit lowered it) the confirm is refused
  (`team_settle_bill_changed`) and it stays waiting. A later increase simply
  shows as "left to pay".
- **Confirm** writes a confirmed `staffHandovers` row (the cash, tagged
  `settlementId`) and a month bill payment (the parking, received by the
  receiver, tagged `settlementId` + `settleCashCents`), then the usual bill
  receipt on WhatsApp for the whole settlement (amount = parking + cash). A
  cash-only settlement has no bill payment, so no WhatsApp receipt; the member
  gets a push. **Decline** changes nothing and pushes the member.
- **Undo** (any staff of the business): voids the hand-over and undoes the bill
  payment; History records who and when; nobody is messaged.
- **Paid them back:** statement negative; owner / Full access, with a method.
  Recorded as a `staffExpenseRepayments` row dated in the month it settles
  (so that month goes to $0), member pushed. No WhatsApp receipt (no approved
  template for it yet).

## Where

`functions/team_settle.js` (pure) + `admin_web/src/lib/team-settle.ts`, shared
fixture `functions/test/fixtures/team-settle-cases.json`. Actions on the
`updateLotExpenseEntry` callable: `team_settle_request | _confirm | _decline |
_undo`, `team_payback`. Collection `staffMonthSettlements` (server-written,
readable by the business's team). Card: `team-settle-panel.tsx`.
Tests: `test:team-settle` (emulator), `team-settle.test.js`,
`team-settle.test.ts`.
