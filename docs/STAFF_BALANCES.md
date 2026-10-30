# Staff balances — who holds or owes what

Decided with the owner on 2026-10-29 (6 questions). Each staff member can be
holding the business's money (customer payments they were named as
receiving), be owed money (lot expenses they paid — docs/STAFF_EXPENSE_CREDIT.md)
and owe money (their own parking bill). Staff balances puts that in one
place, with two-step handovers so cash moving between people is recorded.

## 1. Decisions

1. **Held** = every payment where the staff member is named as receiver,
   whatever the method, EXCEPT payments received by **Business account**
   (a new receiver choice for Zelle / transfer / card / payment links paid
   straight to the business). Online/Stripe/link payments with no receiver
   are never held by anyone.
2. **Handovers, two steps:** the giver records "handed $X to {person | the
   business account}" (method, note, optional photo of a slip/screenshot);
   it is **pending** until the receiver taps **Confirm received**. Money into
   the business account is confirmed by the owner (or a platform admin).
   Later (not in this build) Bank check (Plaid) may confirm deposits
   automatically.
3. **To anyone in the business, or the business account.** A confirmed
   handover moves the amount from the giver's balance to the receiver's.
4. **One net number per person**, with the breakdown:
   `net = held + parkingDueAfterExpenses − expenseCreditLeftover`
   (positive: "owes the business $X"; negative: "the business owes them $Y").
   Nothing is auto-paid from held cash.
5. **History counts from the beginning.** The owner clears what was handed
   over before this existed with one **opening handover** per person
   (giver = that staff member, receiver = business account, kind
   `opening`, recorded and confirmed by the owner in one step).
6. **Everyone in the business sees every balance** (console + app),
   Money → Staff balances.

## 2. Data

- **Receiver constant:** `BUSINESS_ACCOUNT_RECEIVER = "business_account"`.
  Accepted in every callable that takes `receivedByStaffId` (parking:
  `recordBusinessParkingPartialPayment`, `markBusinessParkingPaid`,
  `recordParkingPaymentReceived`; ledger: `recordLotActivityDirectPayment`,
  `recordLotActivityInstalment`; packages: `recordContainerLinePayment`,
  `addWaitingPackage` initial payment, `receivePackageRequest`, delivery
  `collectedCents`; inventory: `recordInventorySale`,
  `recordInventoryCreditPayment`, `switchInventorySalePayment`; invoices:
  `recordInvoicePayment`) wherever a staff member is validated today —
  `business_account` passes that validation and is stored as is. Find each
  validator (e.g. `inventoryReceiverOf`, lot_ledger, container_payments)
  and extend it; never fork.
- **`staffHandovers/{id}`** (server-write only):
  `{businessId, kind: "handover"|"opening", fromStaffId, toId (staff uid or
  "business_account"), amountCents, method: "cash"|"zelle"|"check"|"deposit"|"other",
  note, proofPath, status: "pending"|"confirmed"|"declined"|"voided",
  createdByUid, createdAt, confirmedByUid, confirmedAt, declinedByUid,
  declinedAt, declineNote, voidedByUid, voidedAt, voidReason}`.
  Proof photos reuse the package photo upload rules under
  `staffHandoverProofs/{businessId}/{uid}/{fileId}` (same filename/size/type
  checks as `packagePhotos`; uploader's own folder; readable by the
  business's managers).
- **Rules:** `staffHandovers` read = `canManageBusiness(resource.data.businessId)`
  (every staff member of the business), write false.

## 3. Server (no new Cloud Function exports — 1000-CPU budget)

On `updateLotExpenseEntry`, by `action` (same file as the staff-credit
actions; staff must be members of the business):
- `record_handover {businessId, toId, amountCents, method, note?, proofPath?}`
  — the caller is the giver. Refuse `handover_to_self`,
  `handover_amount_invalid`, `handover_method_invalid`,
  `handover_receiver_invalid` (not a member and not business_account).
  Status `pending`.
- `confirm_handover {businessId, handoverId}` — only the receiver (or, for
  `business_account`, the owner/admin) may confirm: `handover_not_receiver`.
  `handover_not_pending` if not pending.
- `decline_handover {businessId, handoverId, note?}` — same who-rule.
- `void_handover {businessId, handoverId, reason?}` — the giver while
  pending, or the owner/admin any time; never deleted.
- `record_opening {businessId, staffId, amountCents, note?}` — owner/admin
  only (`opening_owner_only`); one step, status `confirmed`.
- `staff_balances {businessId}` — any member. Returns
  `{asOfMs, staff: [{staffId, name, collectedCents, collectedByMethod:
  {cash, zelle, ...}, handedOutCents, receivedFromOthersCents,
  pendingOutCents, pendingInCents, heldCents, parkingDueCents,
  expenseCreditCents, expenseOwedToThemCents, netCents}],
  businessAccount: {receivedCents, pendingInCents},
  pending: [handover rows waiting on someone]}`. Computed by a PURE module
  `staff_balances.js` (`collectReceipts(sources)`, `applyHandovers`,
  `netBalances`) with a fixture `test/fixtures/staff-balances-cases.json`
  and unit tests; the callable only gathers the rows: every payment source
  above (non-voided, non-reverted rows with a `receivedByStaffId`), the
  handovers, and the parking/expense netting already used by month end
  (`parkingMonthSummary` + `netStaffExpenses` for the current month,
  cumulative — reuse `staff_expense_ledger.monthEndOwing` or the same
  inputs). `heldCents = collected (non business_account) − confirmed out +
  confirmed in`; pending amounts are shown separately and do NOT change
  held until confirmed.
- Audit rows (`lotLedgerAudit`, entityType `staff_handover`) for every
  handover action.

### 3a. Server, as built (2026-10-29)

- **Answers.** `record_handover` / `confirm_handover` / `decline_handover` /
  `void_handover` / `record_opening` answer `{success, handoverId, status}`.
  `staff_balances` answers exactly `{asOfMs, staff, businessAccount,
  pending}` (no `success`); `pending` rows carry `{id, kind, fromStaffId,
  fromName, toId, toName, amountCents, method, note, proofPath, status,
  createdByUid, createdAtMs}` (`toName` is "" for `business_account`: the
  client words it). The fixture `test/fixtures/staff-balances-cases.json`
  holds recorded answers; clients render them and do not recompute.
- **Refusals** (`details.reason`): `handover_to_self`,
  `handover_amount_invalid`, `handover_method_invalid`,
  `handover_receiver_invalid`, `handover_proof_invalid`, `staff_not_member`
  (giver or opening person not on the team), `handover_not_found`,
  `handover_not_receiver`, `handover_not_pending`, `handover_voided`,
  `handover_void_not_allowed`, `opening_owner_only`,
  `opening_amount_invalid`. A caller not on the business gets
  `permission-denied`.
- **Held** counts parking per payment entry (reverted ones out) plus what a
  car carries beyond its entries (marked paid in full) under the record's
  `receivedByStaffId`; activities likewise (instalments plus the unlisted
  rest); inventory sales count `paidNowCents` (the whole total on a sale
  from before credit); card orders and rows with no receiver hold nothing.
  A sale from before `receivedByStaffId` existed has no holder.
- **Parking due** is the month-end bill of the customer a person is linked
  to, after expenses, as of today (cumulative); a customer linked to several
  staff has it split evenly (odd cent to the first by id).
- **Business account** `receivedCents` = payments received straight by it
  plus confirmed handovers and openings into it.
- Where `business_account` is accepted: every `receivedByStaffId` that was
  validated (`addWaitingPackage` payment, `recordContainerLinePayment`,
  `receivePackageRequest` payment, `recordInventorySale`,
  `recordInventoryCreditPayment`, `switchInventorySalePayment`) and the
  parking / ledger ones that store it as sent. Two callables gained the
  optional field: `recordInvoicePayment` (`payment.receivedByStaffId`, else
  the caller) and the delivery `deliver` action (`receivedByStaffId`, else
  the agent). A credit's collector stays a person.

## 4. Clients

- **Console** (Money → **Staff balances**, all staff of the business):
  one row per person: Holds · Parking · Expenses owed to them · **Net**
  ("owes $X" / "is owed $Y"), with a breakdown drawer (collected by method,
  handed over, received, pending in/out) and a history list (payments
  collected, handovers, openings, paid back). Actions: **Hand over money**
  (to a person or Business account; method; note; optional photo),
  **Confirm received / Decline** on handovers waiting on the viewer,
  **Void** on the viewer's own pending ones (owner: any), owner-only
  **Opening amount**. A "Waiting on you" badge in the sidebar/Today when
  something awaits the viewer's confirmation.
  "Received by" pickers everywhere money is recorded gain **Business
  account** as the first option.
- **App:** the same page under Money/business menu, the same actions, the
  same "Received by" option, push-free (the badge only).
- English + French everywhere (console `french-dom.ts` blocks ABOVE the
  `const englishDictionary` line, each closed with `});`; app ARB keys in
  both files with `@` metadata).

## 5. Tests
Server: pure module fixture (collected by method, business_account
excluded, handovers in/out, pending not counted, opening, net with
parking/expense), every action's refusals, rules. Console/app: rendering
from a recorded `staff_balances` answer, the hand-over flow, confirm /
decline, the Business account option in a "Received by" picker, French.

## 7. What counts as the business's money (2026-10-30)

Each business decides which kinds of money count toward Staff balances
(owner's words: car sales are individual; containers and packages depend on
the business). Stored on the business as `staffBalanceSources`:

| key | money | default |
| --- | --- | --- |
| `parking` | parked cars' payments | on |
| `activity` | lot jobs (instalments and settlements) | on |
| `package` | package / container line payments | on |
| `shop` | inventory sales and their credit payments | on |
| `invoice` | invoice payments | **off** — staff's own car sales |

- `staff_balances` filters receipts by it (`collectReceipts(sources, now,
  counted)`; missing keys take the defaults) and answers `counted` (every
  key filled). Handovers are never filtered.
- `set_counted_sources {businessId, sources}` on `updateLotExpenseEntry`:
  owner (or platform admin) only (`counted_sources_owner_only`,
  permission-denied); only booleans for known keys (`counted_sources_invalid`).
  Writes `staffBalanceSources` (full choice), `staffBalanceSourcesBy`, `…At`.
- Month end's "Business owes" follows automatically (it uses the answer's
  net).
- Console: Staff balances → "What counts" (owner edits; everyone sees).
  The app reads the server's answer, so its numbers follow the choice.
