# Zelle bank check: contract, flow and setup

The owner owns the Zelle bank account; staff sell. Staff verify a Zelle payment
at the counter without calling the owner: they tap **Check Zelle** on a payment
recorded as Zelle and Laawol asks the business's own bank (read-only, through
Plaid) whether a deposit of exactly that amount arrived. Owner-approved
2026-10-17.

Backend: `my_flutter_app/functions` - `plaid_client.js` (fetch client, errors,
Link request, webhook verification), `bank_sync.js` (feed into credits),
`zelle_check.js` (the rule, permissions, views), `bank_token_crypto.js` (the
sealed access token); callables at the end of `index.js`. Ported from Wouri
(`functions/src/services/plaid.ts`, `bankSync.ts`,
`handlers/organizationBankLink.ts`) with its gaps closed (see "Hardening").

## The rule

A payment is confirmed by a deposit that:

- is **exactly** the payment's amount (whole cents);
- reached the **connected account** (not another account on the same login);
- was received within the business's **window** (default 15 minutes; the owner
  sets 2 to 60) **before or after** the payment's time (`createdAt` of the
  record); edges included;
- has **not already confirmed** another payment (`consumedBy` empty) and has
  **not been removed** by the bank.

Pending deposits count. Outcomes:

| result | when | what is written |
| --- | --- | --- |
| `confirmed` | exactly one such deposit, with a bank time | the credit gets `consumedBy`; the record gets `bankCheck` (confirmed) - one transaction re-reading both |
| `choose` | several such deposits, **or** any deposit whose bank line carries only a date | nothing; staff pick by sender name with `confirmZelleCandidate` |
| `not_found` | none | `bankCheck {status: "not_found", checkedByUid, checkedAt}` - never blocks checking again |
| `already_confirmed` | the record's `bankCheck.status` is already confirmed | nothing |

**Date-only deposits.** Some banks give Plaid a date but no time. Such a
deposit cannot be held to a minutes window, so it is a candidate when its date
is one of the window's dates in the business's zone (`businesses.timeZone`
when valid, else America/New_York), and it never confirms on its own: the
answer is `choose` even when it is the only one. Its `atMs` is noon UTC of its
date and `timeKnown: false` - screens show the date only.

What counts as the payment:

| kind | collection | amount | method | voided |
| --- | --- | --- | --- | --- |
| `inventory_sale` | `inventorySales` | `paidNowCents` (pre-v4 sales: `totalCents`) | `paymentMethod` | `voided` |
| `inventory_credit_payment` | `inventoryCreditPayments` | `amountCents` | `method` | `reverted` |
| `container_line_payment` | `containerLinePayments` | `amountCents` | `method` | `reverted` |

A sale entirely on credit (paid now 0, method "") is `not_zelle`.

## Who may do what

- **Owner** (`zelle_check.bankRoleOf`): a platform admin, the business's
  `businessOwner`, or its `ownerUid`. Connects, reconnects, disconnects, sets
  the window, sees the bank's name, mask and last sync.
- **Staff**: anyone else of the business holding at least one business
  permission. `getBusinessBankStatus` answers them `{connected, status,
  windowMinutes}` only.
- **Checking** a payment needs exactly what viewing it needs: the inventory
  gate (inventory permission + service on) with store scoping (staff tied to
  one store of a multi-store business only that store's money:
  `store_not_allowed`; staff with no store see nothing of a multi-store
  business) for sales and credit payments; the `containers` section for
  package payments.
- Staff never see balances, other transactions, the bank line's text or the
  account. A candidate is `{creditId, atMs, timeKnown, senderName, pending}`.

## Data (server-only; rules deny every client read and write)

`businessBankLinks/{businessId}`: `businessId, itemId, accessTokenEnc,
institutionId, institutionName, accountId, accountMask, accountName, status
("active" | "needs_reauth" | "disconnected"), cursor, connectedAt,
connectedByUid, windowMinutes, lastSyncAt, lastRefreshAt,
lastRefreshAtByRecord, lastErrorCode, updatedAt`, plus `windowUpdatedByUid`, `disconnectedAt`, `disconnectedByUid`.
A window set before any bank is connected creates the document with only
`businessId, windowMinutes` (reads as not connected).
`lastRefreshAtByRecord` is `{"<kind>:<id>": epoch ms}` for the payment
records that paid for a `/transactions/refresh` in the last 5 minutes
(expired entries are dropped on every write, so it holds a handful of keys;
see "Cost and the refresh rule").

`businessBankCredits/{businessId}_{transactionId}`: `businessId,
transactionId, accountId, amountCents` (money IN, positive), `pending,
authorizedAtMs, postedAtMs, atMs` (best time: authorized, else posted, else
null), `timeKnown, dateKey` (YYYY-MM-DD), `senderName` (counterparty, else the
words after "from" on the line, else the merchant, else the line without the
Zelle words; at most 80 characters - **the rest of the line is never
stored**), `removed, consumedBy {kind, id}, consumedAt, consumedByUid,
createdAt, syncedAt`, and on a pending deposit that posted:
`replacesTransactionId` / `replacedByTransactionId`.
A sync never writes `consumedBy` or `removed: false`: both are **absent until
set** (absent = null / false), so a sync can never undo a confirmation.

Times: `lastSyncAt` (in the status answer), `atMs` and `bankCheck.atMs` are
epoch milliseconds; `bankCheck.checkedAt` is a Firestore Timestamp (server
time).

`bankCheck` on `inventorySales`, `inventoryCreditPayments`,
`containerLinePayments` (written only by the server; read with the record by
whoever may already read it - those collections' existing read rules,
`inventoryStoreRead` / `lotLedgerRead`, cover every field, so no rule
changed; client writes stay denied):
`{status: "confirmed", creditId, amountCents, atMs, timeKnown, senderName,
institutionName, checkedByUid, checkedAt}` or `{status: "not_found",
checkedByUid, checkedAt}`.

Index: `businessBankCredits (businessId ASC, amountCents ASC, createdAt
DESC)` - the check reads the 200 newest credits of exactly that amount.

## Callables

All `onCall` with `enforceAppCheck`, `cors: true`, `invoker: "public"`;
signed-in callers only. Refusals are `HttpsError` with the English message and
`details.reason` / `details.reasons` (`zelle_check.BANK_REFUSALS`).

1. `createBankLinkToken {businessId, platform: "ios"|"android"|"web",
   language?: "en"|"fr"}` -> `{linkToken, expiration, mode: "connect"|"update"}`.
   Owner. When the link is `needs_reauth`, update mode (the stored token is
   passed, no products): same login, same history.
2. `connectBusinessBank {businessId, publicToken, accountId?}` -> `{status,
   institutionName, accountMask, accountName, synced}`. Owner. Exchanges the
   token, picks the given depository account (else the login's first
   depository account), seals the token, keeps the owner's window, removes the
   **old** login at Plaid when it was a different item, then syncs once
   (`synced: false` when the first read failed - the bank is still connected;
   Plaid often needs a few minutes before history is ready). **After a
   Reconnect** (update mode) the app calls it again with Link's public token:
   the same item is kept (never removed), keeps its cursor and is set active.
   If Plaid refuses to exchange an update-mode token, a link in
   `needs_reauth` is synced with its stored login and, when that works, set
   active with the same answer.
3. `getBusinessBankStatus {businessId}` -> owner `{connected, status,
   windowMinutes, institutionName, accountMask, accountName, lastSyncAt (ms |
   null), lastErrorCode}`; staff `{connected, status, windowMinutes}`.
4. `setBankCheckWindow {businessId, minutes}` -> `{success, windowMinutes}`.
   Owner; whole minutes 2..60.
5. `disconnectBusinessBank {businessId}` -> `{success, connected: false,
   status: "disconnected"}`. Owner. `/item/remove` first (best effort), then
   the token and cursor are cleared. Stored credits are kept (they back past
   confirmations).
6. `checkZellePayment {businessId, kind, id}` -> `{result, confirmation?,
   candidates?}`; `confirmation = {amountCents, atMs, timeKnown, senderName,
   institutionName, pending?}`, `candidates = [{creditId, atMs, timeKnown,
   senderName, pending}]`. Asks Plaid to refresh (`/transactions/refresh`,
   billed: at most once per record in 5 minutes and once per 60 s per
   business, best effort - see "Cost and the refresh rule"), syncs
   (`/transactions/sync`, free, 250 a page, at most 20 pages), then applies
   the rule. A sync that fails for any reason but an expired login falls back
   to the deposits already read.
7. `confirmZelleCandidate {businessId, kind, id, creditId}` -> `{result:
   "confirmed"|"already_confirmed", confirmation}`. Same permission and record
   checks; the credit must still pass the rule (`candidate_invalid`) and be
   free (`candidate_taken`).
8. `plaidWebhook` (onRequest, POST). Verifies the `Plaid-Verification` JWT
   (ES256 only, key from `/webhook_verification_key/get`, at most 5 minutes
   old, SHA-256 of the exact raw body) before reading anything; 401 otherwise.
   `TRANSACTIONS` -> sync that business's link; `ITEM` `ERROR` (a login
   error), `PENDING_EXPIRATION`, `PENDING_DISCONNECT`,
   `USER_PERMISSION_REVOKED`, `USER_ACCOUNT_REVOKED` -> `needs_reauth`;
   `LOGIN_REPAIRED` -> `active` (only from `needs_reauth`). Always 200 for
   anything verified, so a new Plaid message never becomes an outage.

Refusal codes: `bank_owner_required`, `bank_access_denied`,
`bank_not_connected`, `bank_needs_reauth`, `not_zelle`, `record_not_found`,
`record_voided`, `kind_invalid`, `window_invalid`, `platform_invalid`,
`public_token_required`, `no_depository_account`, `candidate_invalid`,
`candidate_taken`, `bank_error` (Plaid unreachable or refusing;
`details.bankError` is `rate_limited`, `bank_unavailable`,
`service_unavailable`, `not_ready`, `link_expired` or `setup`), plus the
inventory gate's own (`service_disabled`, `store_not_allowed`, ...) and the
section refusal for package payments.

## Cost and the refresh rule

Plaid bills the shared team (Wouri, Dala and Laawol, same owner) for:

- **Transactions: $0.30 per connected bank per month** (one Item per
  business that connected a bank; a disconnected bank is removed at Plaid
  and stops costing).
- **Transactions Refresh: $0.12 per successful `/transactions/refresh`.**
  `/transactions/sync`, the webhook and everything else are free.

So the running cost is **$0.30 per connected bank per month + at most $0.12
per press of Check Zelle**. The rule (`zelle_check.refreshPlan`, decided in
the same transaction that records it on the link):

1. A payment record (`businessId` + `kind` + `id`) asks for **at most one
   refresh per 5 minutes** (`RECORD_REFRESH_WINDOW_MS`). The screens re-check
   automatically every 20 s for 3 minutes after a "not found yet"; those
   re-checks (and a staff member pressing Check again) only sync, which is
   free.
2. On top of that, **at most one refresh per 60 s per business**
   (`REFRESH_THROTTLE_MS`). A second payment checked within that minute only
   syncs; it gets its own refresh on a later re-check once the minute is up
   (still at most one for it).
3. A refresh that finds something new makes Plaid send
   `SYNC_UPDATES_AVAILABLE`; `plaidWebhook` syncs, the deposit is stored, and
   the next (free) re-check matches it. The re-check also syncs itself, so a
   late or lost webhook only delays the match.

The mark is taken before Plaid is asked, so a refresh that fails is not
retried within the 5 minutes either (a failed refresh is not billed).

## Hardening over Wouri

- The access token is sealed with AES-256-GCM under `BANK_TOKEN_KEY`, with
  the business id as additional data (a sealed token copied to another
  business does not open). Opened only inside a function; never returned.
- Plaid `removed` rows mark the credit `removed: true` (never usable). A
  pending deposit that posts under a new id (`pending_transaction_id`) is
  written in one transaction that carries the pending one's `consumedBy`
  over, so one deposit can never confirm two payments.
- Connecting a new bank over an old one calls `/item/remove` on the old item.
- The bank line's text is never stored; staff see only the sender's name.
- The webhook URL is derived from the running project
  (`https://us-central1-<project>.cloudfunctions.net/plaidWebhook`;
  `PLAID_WEBHOOK_URL` overrides it), never hardcoded.
- `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` restarts the pagination from
  the saved cursor (at most 3 times), throwing away the rows of the abandoned
  run.
- A sync that finishes after the owner disconnected or connected another bank
  does not write over the link (it checks `itemId` in a transaction).

## Console (admin_web)

- **Settings tab, owner only** (`role == businessOwner` of this business):
  "Bank for Zelle checks" card (`components/business/bank-zelle-card.tsx`).
  Connect opens Plaid Link for the web; the official script
  `https://cdn.plaid.com/link/v2/stable/link-initialize.js` is loaded only
  when Connect is pressed (15 s limit). It shows the bank, the account mask,
  the status and when the bank was last read; Reconnect when the bank needs
  the owner to sign in again (update mode); Disconnect behind a confirmation;
  the check window as a select (2 to 60 minutes). Platform admins work from
  the admin console, which does not show this card.
- **Check Zelle** (`components/business/zelle-check-button.tsx`) on: an
  opened inventory sale paid now by Zelle, each standing Zelle credit
  payment of a sale, and each standing Zelle package payment (Record a
  payment dialog). Confirmed shows a chip with amount, time (date only when
  the bank gave no time), sender and bank; not found says so with Check
  again; several deposits are listed by sender and time with "This one".
  The records are live, so a confirmation made in the app shows here too.
- Pure logic in `src/lib/zelle-check.ts` (tests `zelle-check.test.ts`);
  `bankCheck` is read into `InventorySale` and `PackagePaymentEntry`; every
  string is in `french-dom.ts`. The AASA
  (`public/.well-known/apple-app-site-association`) claims `/plaid/*`.

## Not in this version

- No notifications.
- A deposit the bank removes after it confirmed a payment keeps the payment
  confirmed (the credit shows `removed`); nothing flags the record yet.
- No History (`lotLedgerAudit`) rows: `bankCheck` carries who and when.

## Setup for the owner of the Plaid account

1. **Plaid dashboard -> Link -> Customization**: the customization named
   exactly **`laawol`** (United States, English) - done. Every Link token
   sends `link_customization_name: "laawol"` and `client_name: "Laawol"`.
   `PLAID_LINK_CUSTOMIZATION` (functions env) changes the name; an empty
   value sends none (Plaid's default customization). The team is shared with
   Wouri and Dala, so never edit their customizations for Laawol.
2. **Plaid dashboard -> Developers -> API -> Allowed Android package names**:
   add `com.laawoldigital.app` (from `android/app/build.gradle`
   `applicationId`).
3. **Allowed redirect URIs**: add `https://customer.laawoldigital.com/plaid/oauth`.
   The universal link: `admin_web/public/.well-known/apple-app-site-association`
   now claims `/plaid/*` for `GRKB7BXVZK.com.laawoldigital.app`, and the app's
   entitlements already list `applinks:customer.laawoldigital.com`.
   **TODO:** that file only takes effect once the static site is deployed to
   `customer.laawoldigital.com` (iOS caches the AASA; a reinstall picks up the
   new path). Until then OAuth banks (Chase, Bank of America, Wells Fargo...)
   may not hand the owner back to the iOS app; non-OAuth banks and the web
   console work.
4. **Webhook**: nothing to paste - every Link token carries
   `https://us-central1-<project id>.cloudfunctions.net/plaidWebhook` for the
   project the functions run in (e.g. `car-selling-flutter-app`, or
   `laawol-a855a` after the migration). If Plaid's dashboard asks for a
   default webhook, use that URL.
5. **Production access**: approved for **Transactions**; the
   **Transactions Refresh** add-on is being enabled (without it
   `/transactions/refresh` fails, the check still syncs - best effort).
6. **Secrets** (from `my_flutter_app`):

   ```bash
   firebase functions:secrets:set PLAID_CLIENT_ID   # Plaid dashboard -> Keys
   firebase functions:secrets:set PLAID_SECRET      # the sandbox or production secret
   openssl rand -base64 32 | firebase functions:secrets:set BANK_TOKEN_KEY --data-file=-
   ```

   Keep a copy of `BANK_TOKEN_KEY` in the password manager: a changed key
   makes every connected bank read as "not connected" and the owner connects
   it again (nothing else is lost).
7. **PLAID_ENV**: `sandbox` (default) or `production`, a functions
   environment variable. The production project's values are committed in
   `my_flutter_app/functions/.env.car-selling-flutter-app`
   (`PLAID_ENV=production`, `PLAID_LINK_CUSTOMIZATION=laawol`; no secrets;
   un-ignored in `functions/.gitignore`), which `firebase deploy` loads for
   that project id only. Every other project (staging, `demo-*` emulator
   projects) has no such file and is sandbox. `plaidEnvironment` also forces
   sandbox whenever it runs under an emulator (`FUNCTIONS_EMULATOR`, any
   `*_EMULATOR_HOST`, or a `demo-*` project), so no test or emulator run can
   reach a real bank even with `PLAID_ENV=production` exported. The secret
   in step 6 must match the environment (`PLAID_SECRET` in
   car-selling-flutter-app = the production secret). **After the migration
   to `laawol-a855a`**, copy the file to `.env.laawol-a855a` (and un-ignore
   it) or that project runs sandbox.
8. Deploy the functions, the rules and the index
   (`firebase deploy --only firestore:rules,firestore:indexes,functions:createBankLinkToken,...`)
   through the normal gate (`deploy/` preflight), one function batch at a time.

## Tests

- Unit (`npm run test:unit`): `test/bank-token-crypto.test.js` (round trip,
  tamper, wrong key/business), `test/plaid-client.test.js` (errors, Link
  request incl. the `laawol` customization, environment incl. the emulator
  guard and the committed production env file, webhook URL, fetch client,
  webhook verification ported from Wouri),
  `test/bank-sync.test.js` (sign flip, pending kept, account filter, removed,
  pending->posted, paging and mutation restart, ITEM statuses),
  `test/zelle-check.test.js` (exact amount, window both sides, consumed /
  removed / other account excluded, several -> choose, date-only -> choose,
  none -> not_found, record reading, permission planning, status views, the
  refresh rule (first check refreshes, re-checks at 20/40/60/120 s do not,
  the same record after 5 minutes does, another record within 60 s waits for
  the business throttle), and a source contract over the callables and
  rules).
- Emulator (`npm run test:bank`): `test/bank-callables.test.js`, Plaid faked at
  `fetch` (every call must go to `sandbox.plaid.com`, even with
  `PLAID_ENV=production`): one refresh per record across re-checks, again
  after 5 minutes, and a deposit synced by the webhook confirming on the next
  free re-check.
- Rules (`npm run test:rules`): "keeps the connected bank and its deposits
  server-only", "does not let a client write a payment's bankCheck".
