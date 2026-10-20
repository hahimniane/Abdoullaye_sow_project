# Phone accounts

Status: contract for branch `feat/phone-accounts`. Server first; the console
(`admin_web`) and the app (`my_flutter_app`) build on exactly what is written
here. Decisions are the owner's (2026-10); this document records how they are
implemented and must be kept in sync with the code.

## 1. What it does

A person whose number a business types on a shipment gets a Laawol account at
once, without doing anything. When they open the tracking link from WhatsApp
(or the app from the store) they sign in with a code sent to that number and
see every package any business has recorded with their number: as the sender
("My packages") and as the receiver ("Coming to you"). Nothing new is sent to
them when the account is made: the existing WhatsApp updates carry the link.

## 2. Phone numbers: the one rule

Pure helper `functions/phone_e164.js` (tested by `test/phone-e164.test.js`,
mirrored for display only by the clients - the server is the authority):

- `toE164(raw, {regionIso})` returns `{status, e164}`:
  - `"ok"` - a valid international number. `+` or `00` prefix, a calling code
    from `functions/calling_code_catalog.js` (AUTO-PORTED from
    `lib/data/calling_code_catalog.dart`, drift-tested), 8-15 digits in all,
    and when the country is in the curated numbering-plan table, the exact
    national length and leading digits of that plan.
  - `"needs_country_code"` - no country code, and not a NANP business's
    ten-digit number. Nothing is guessed.
  - `"empty"` / `"invalid"`.
  - A local number becomes E.164 ONLY for a NANP business (US, Canada and
    the other +1 countries) and only when it is exactly 10 digits
    `NXX NXX XXXX` (N = 2-9) or `1` + those 10 -> `+1...`. For every other
    business country - even a number that fits that country's plan - the
    answer is `needs_country_code` and staff see "Add the country code"
    (owner decision after review). The curated plans (Guinea, Senegal, Mali,
    Côte d'Ivoire, Cameroon, Burkina Faso, Niger, Togo, Benin, Gambia,
    France, UK, Ghana, Nigeria, Sierra Leone) only CHECK international
    numbers: length and leading digits after the calling code.
- `sameNumber(raw, e164)` - read-time check that a record's raw field still
  is the account's number (digits of raw, leading zeros dropped, are the tail
  of the E.164 digits, at least 7 of them).
- `loginLanguage(e164, preferredLanguage)` - `fr` for a profile language of
  `fr`, else `fr` for francophone calling codes (+33 +221 +223 +224 +225 +226
  +227 +228 +229 +235 +236 +237 +241 +242 +243 +253 +257 +261 +262 +269 +509
  +590 +594 +596), else `en`.
- `lastTwo(e164)` - the only part of a number ever shown from a tracking link.

`phone_number.js` (`isValidPhoneNumber`, local numbers accepted) is unchanged:
staff may still save a local number; it is flagged instead of refused.

## 3. Records: which phones, and the fields we add

Configuration `PHONE_RECORD_SOURCES` in `functions/phone_accounts.js`:

| Collection | Sender raw field | Receiver raw field | E.164 fields written |
| --- | --- | --- | --- |
| `containerLines` | `customerPhone` | `receiverPhone` | `customerPhoneE164`, `receiverPhoneE164` |
| `barrelShipments` | `customerPhone` | `receiverPhone` | same |
| `freightShipments` | `customerPhone` | `receiverPhone` | same |
| `transportRequests` | `customerPhone` | - | `customerPhoneE164` |
| `parkedCars` | `customerPhone` | - | `customerPhoneE164` |
| `freightQuoteRequests` | `customerPhone` | - | `customerPhoneE164` |
| `packageRequests` | `sender.phoneE164` | `receiver.phoneE164` | none: already strict E.164 |

`barrelPools`: a shared barrel's participants are signed-in customers; their
receivers' phones reach accounts through the `barrelShipments` each
participant gets when the pool is sealed. Pool documents are not stamped.

Derived fields (server-written only, never by clients, never trusted from
input):

- `customerPhoneE164`, `receiverPhoneE164` - the E.164 number, or deleted
  when the raw field is empty/invalid/needs a country code.
- `phoneCountryCodeMissing: ["customerPhone" | "receiverPhone"]` - the raw
  fields staff must fix ("Add the country code"). Deleted when empty.
- `phoneReportedNotMine: ["customerPhone" | "receiverPhone"]` - someone
  signed in with that number pressed "This isn't mine". Cleared for a field
  when its number changes.
- `phoneSyncedAt` - when the derived fields were last written.

`customerUid` is never written from a phone: who sees a record is decided at
read time by its current number.

### 3.1 Where the fields are written (no new triggers)

`syncRecordPhones(collection, id)` (ensures the accounts of the numbers
that appeared, then writes the derived fields only when they differ -
convergent; from a trigger see §3.2 for what it skips) runs:

- in the existing Firestore triggers, which already see every write:
  `rollupVolumeOnLineWrite` (containerLines), `syncParkedCarOccupancy`
  (parkedCars), `notifyBarrelShipmentStatus`, `notifyFreightShipmentStatus`,
  `notifyTransportRequestStatus` (updates of those three, including the
  customer's own receiver-phone edit);
- after the create callables of the collections whose trigger fires on
  update only: `createBarrelShipmentPaymentIntent`,
  `createBarrelOrderPaymentIntent`, `sealBarrelPool`,
  `createFreightShipmentPaymentIntent`, `createTransportRequest`,
  `createFreightQuoteRequest`;
- package requests: account creation after submit/update callables (the
  phones are already E.164 on the document).

A stamp-only write changes no status, payment or count, so the triggers it
re-fires are no-ops (volume rollups compare signatures; notify triggers check
status/payment transitions). `syncParkedCarOccupancy` puts the stamp in the
SAME write as its occupancy patch (`phoneStampForEvent`): one event, at most
one write.

Records a client creates directly fire no trigger (the barrel, freight and
transport triggers fire on update only, and a deployed trigger's event type
cannot be changed in place). Two covers, no new function:

- the app's legacy staff transport form asks right after saving:
  `phoneAccount({action: "syncRecord", key: "transportRequests/<id>"})`
  (the record's customer or someone with that section of its business);
- every hour `sweepPackageRequests` (existing, maxInstances 1) first runs
  `sweepRecentRecordPhones`: `barrelShipments`, `freightShipments` and
  `transportRequests` created in the last 3 hours, 200 each, 40-second
  budget, stamping what old app versions left and retrying numbers whose
  account failed. It never fails the package sweep.

### 3.2 What a trigger event costs (2026-10 incident)

Production has a hard 20-vCPU Cloud Run quota. A burst of updates to OLD
records (never stamped: parked cars, barrels) made every event stamp the
record (a second write that re-fired the trigger), make an account and a
`users/` profile (which woke `syncUserCustomClaims`), and the burst ran the
quota out (503s on label printing). Since then, from a trigger:

1. **Free check first** (`stampIsCurrent`, pure): when the derived fields
   already describe the raw numbers, the event stops before any Firestore
   or Auth call. A number without a country code is judged without the
   business's country only when this write did not change it (`before`).
2. **Which events do phone work** (`phoneEventNeedsSync`, pure): a new
   record, a number changed by this write, a record synced before (its stamp
   went stale: a failed account, a country-code fix), a record created in
   the last 24 hours (`RECENT_RECORD_MS`: a client's direct create, a
   retry), or a call without `before`. **Not** an old record never synced
   whose numbers this write left alone.
3. **One guarded write**: with the event's `updateTime` the stamp is a
   single `update(..., {lastUpdateTime})` - no re-read, no transaction. A
   newer write makes it fail harmlessly; that write's own event redoes it.
4. `syncUserCustomClaims` returns at once for a NEW profile whose claims
   would be a plain customer's (role `customer`, no business, admin role or
   permissions): a new Auth user has no claims, and no rule tells "none"
   from a customer's. Staff, owners and admins, and every later change,
   still sync.

Trade-off (owner-accepted): "at once" still holds for new records and for
number changes. An old record whose numbers nobody touches gets its stamp
and account from the backfill (§11), not from an unrelated status update;
the hourly sweep (§3.1) still covers the last 3 hours of client-created
barrels, freight and transport. A rare lost race on an old record (its stamp
write beaten by a newer write that did not change the number) is also left
to the backfill.

## 4. Accounts made from a record

`ensurePhoneAccount({e164, displayName, source})` in `phone_accounts.js`:

1. `phoneAccountOptOuts/{e164}` exists -> do nothing (the person deleted
   their account; see §8).
2. `phoneAccountClaims/{e164}` has a `uid` with `profileReady` -> reuse it
   (read in the same `getAll` as the opt-out: no Auth call).
3. otherwise take the number's claim (§4.1), then
   `auth.getUserByPhoneNumber(e164)` -> reuse that uid (a placeholder, a
   phone sign-up, or an email account that VERIFIED this number - such an
   account's `phoneSignInAliases` entry exists only for a number Auth holds,
   so Auth is the one place to look);
4. else `auth.createUser({phoneNumber: e164, displayName})`; on
   `auth/phone-number-already-exists` (a client's SMS sign-in made it
   meanwhile) read it back.
5. `users/{uid}` is created with `create()` (an existing profile is never
   touched):

```
role: "customer", fullName: <record name>, email: "", phone: e164,
normalizedPhone: <digits>, phoneVerified: false,
accountOrigin: "shipment", firstSignInAt: null,
createdFrom: {collection, recordId, field},
preferredLanguage: "fr" | "en" (from loginLanguage),
notificationPreferences: defaults, createdAt, updatedAt
```

6. the claim is settled: `{uid, profileReady: true}`.

Never for an empty, invalid or `needs_country_code` number. Best-effort: any
failure is logged and swallowed - a staff save never fails because of it.
Accounts are made BEFORE the number is stamped: a number whose account
failed (`failed`) or is still being made by another run (`pending`) stays
unstamped, so the next write of the record (§3.2), the hourly sweep (§3.1)
or the backfill tries again (`syncRecordPhones`).

### 4.1 One phone = one account, under concurrency

Firebase Auth's phone uniqueness is NOT a lock: in production (2026-10) two
trigger runs of one parked car at the same moment made two Auth users and
two profiles for one number. `phoneAccountClaims/{e164}` (server only,
rules deny every client) is:

```
{phone, uid: "" | <uid>, token: <random> | "", profileReady: boolean,
 claimedAtMs, settledAt}
```

- Taking it is `create()`: of any number of runs at once exactly one
  succeeds and makes the account; the others read the claim.
- A claim with a `uid` answers (by uid first: `getUser(uid)` must still hold
  the number; else whoever holds it now; else the claim is dropped and
  taken again - a merged or deleted account).
- A claim without a `uid` younger than 60 s (`CLAIM_STALE_MS`): another run
  is making the account; wait (150 ms .. 2 s, about 5 s in all), then give
  up as `pending` (the number stays unstamped; the next write or sweep
  links it). Older: a run that died - taken over with an `updateTime`
  precondition, so only one run takes it over.
- A run that fails releases its own claim (matched by `token`).
- A sign-in that makes the account (`accountForSignIn`) uses the same claim
  but never trusts a claim's uid unread (it mints a token for it); every
  sign-in and merge (`signInBookkeeping`) writes the claim with its uid, so
  a merged number's later shipments reuse the email account at once.
  Deleting an account removes its claim with the opt-out (§8).
- No index: claims are read by id only. Retry-safe: every step either
  converges on the same uid or leaves the claim for the next run.

Cleanup of what the race already made: `~/laawol-deploy-logs/phone_dupes.py`
(owner, ADC; dry run by default, `--apply` deletes) keeps one account per
number and deletes only extras that are `shipment` customer profiles never
signed in, with phone-only Auth users that never signed in.

A profile is "not signed in yet" while `accountOrigin == "shipment"` and
`firstSignInAt == null`. Such an account is a placeholder for merging (§7).

## 5. Signing in with a phone

### 5.1 WhatsApp code (first choice)

Template `laawol_login_code`, category AUTHENTICATION, languages `en` and
`fr`, copy-code button, security recommendation on, 10-minute expiry footer.
Meta fixes the wording of authentication templates (shown approximately;
Meta renders its own preset text per language):

- en: "*{{1}}* is your verification code. For your security, do not share
  this code." Footer: "This code expires in 10 minutes." Button: "Copy code".
- fr: "*{{1}}* est votre code de vérification. Pour votre sécurité, ne le
  partagez pas." Footer: "Ce code expire dans 10 minutes." Button: "Copier le
  code".

Created by the owner with `~/laawol-deploy-logs/create_login_template.py`
(reads `WHATSAPP_ACCESS_TOKEN` from Secret Manager at run time). The message
body is built only by `loginCodeTemplateMessage` in `whatsapp_templates.js`.

All of it goes through ONE callable, `phoneAccount` (`enforceAppCheck`,
`cors`, `invoker: "public"`, `maxInstances: 1`, the WhatsApp secrets bound):
the project's reserved-CPU budget (`test/scaling-contract.test.js`, 1,000)
stood at 999, so five functions could not fit. `data.action` names the
handler; an unknown action is refused with `action_invalid`. Below,
"`requestPhoneLoginCode(data)`" means `phoneAccount({action:
"requestPhoneLoginCode", ...data})`.

`requestPhoneLoginCode(data)` - one of:
- `{phone}` - a number typed by the person (must be `ok` E.164);
- `{trackingCode, role: "sender" | "receiver"}` - the masked flow: the
  server reads that record's number; the client never gets it;
- `{phone, purpose: "link"}` - a signed-in, non-anonymous caller proving a
  number to add to their account (§7).

Returns `{challengeId, channel: "whatsapp", lastTwo, expiresAtMs,
resendAfterMs}`. Refusals carry `details.reason`:
`phone_invalid`, `needs_country_code`, `tracking_not_found`,
`no_phone_on_record`, `rate_limited` (with `retryAfterMs`),
`whatsapp_unavailable` (secrets unset / Meta refused: offer SMS),
`sign_in_required` (link without a real account),
`phone_sign_in_unavailable` (link by an account with business or platform
access).

`verifyPhoneLoginCode({challengeId, code})`:
- sign-in purpose -> `{customToken, uid, isNewAccount}`; the client calls
  `signInWithCustomToken`. The server has already done the sign-in
  bookkeeping (§5.3), so no `completePhoneSignIn` call is needed.
- link purpose (caller must be the uid that asked) -> `{linked: true,
  merged: boolean}` (§7).
Refusals: `code_wrong` (with `attemptsLeft`), `code_expired`,
`too_many_attempts`, `challenge_not_found`, `phone_in_use` (link: the number
belongs to an account that has signed in), `wrong_account` (a link code tried by another account: neither counted nor
used).

Storage: `phoneLoginChallenges/{challengeId}` (server only):
`{phoneE164, codeHash: sha256(challengeId:code), purpose, linkUid,
expiresAtMs (now + 10 min), attempts, status: open|used|locked,
createdAtMs, source: phone|tracking}`. The code is 6 random digits
(`crypto.randomInt`), never stored or logged in clear. 5 wrong attempts lock
the challenge. A used challenge cannot be reused.

Who is actually sent a code (cost): a sign-in code goes out only to a number
that has an account a phone may open (a customer), or that some record
carries (a deleted account comes back that way). Any other number - and a
staff/owner/admin number - gets the very same answer, its limits are
counted the same, and its challenge holds the hash of a code nobody sees,
so every attempt is `code_wrong`. Nothing tells a caller whether a number is
known. A link code (signed-in customer adding a number) is always sent.

Customers only: phone-code sign-in and linking refuse any account with
business or platform access (role not `customer`, `businessId`,
`businessPermissions`, `platformAdmin`, `adminRole`) with
`phone_sign_in_unavailable` ("Use your email and password"). One explicit
exception (2026-10, docs/STAFF_PHONE_INVITES.md §2): staff who joined
through a phone invitation sign in (never link) with the code of the
invited number (`staffPhoneSignInAllowed`); a number with a live phone
invitation is sent a real code. Linking also
needs an existing customer profile, as `syncVerifiedCustomerPhone` does. A
text sign-in to such an account reaches Firebase, but `completePhoneSignIn`
refuses it and both clients sign straight out.

Rate limits (`phoneLoginLimits/{sha256(kind:key)}`, server only; enforced in
the emulator too):

| Key | Limit |
| --- | --- |
| per number | 5 sends / hour, 10 / day |
| per client address (`clientAddressFromRequest`; IPv6 by its /64 - `request_guard.addressBucket`; skipped when "unknown") | 20 sends / hour |
| per tracking code (masked flow; every spelling one key - `trackingLimitKey`) | 5 sends / hour |
| per calling code (+224, +1, ...) | 600 sends / day; hitting it logs an ERROR (alert) |
| the whole platform | 3,000 sends / day; hitting it logs an ERROR (alert) |
| resend | 30 s after the previous send to the same number |

### 5.2 SMS fallback ("Send it by text instead")

Firebase phone auth on the client (`verifyPhoneNumber` in the app,
`signInWithPhoneNumber` + invisible reCAPTCHA on the web). It needs the full
number on the client, so in the masked flow the person types their full
number; if it is not the record's number they are simply signed into
whatever account that number is. Firebase signs into the Auth user that owns
the number - the same uid the WhatsApp path mints a token for.

After an SMS sign-in the client calls `completePhoneSignIn({})`.

### 5.3 `completePhoneSignIn(data)` and sign-in bookkeeping

Without arguments (caller signed in with a phone): creates `users/{uid}` if
missing (`accountOrigin: "phone_sign_in"`), sets `firstSignInAt` if null,
`phoneVerified: true`, writes `phoneSignInAliases/{digits}` for this uid,
removes `phoneAccountOptOuts/{e164}`, returns `{uid, profileCreated}`.
The WhatsApp verify path runs the same bookkeeping before minting.

With `{placeholderIdToken}` - the merge proof of the SMS path (§7).

## 6. My packages

`getMyShipments({cursor?})` - caller signed in, Auth `phoneNumber` set (only
ever set through proof: Firebase phone auth, our code, or a merge). For every
source and role it runs

```
where(<E164 field>, "==", phone).where("createdAt", "<=", before)
  .orderBy("createdAt", "desc").limit(25)
```

(packageRequests: `sender.phoneE164` / `receiver.phoneE164`), merges, keeps
the 25 newest, and drops: records whose raw field no longer is this number
(`sameNumber` - a number changed by staff leaves the old account at once),
records hidden by "This isn't mine", and package requests already received
(the container line stands for them). Returns:

```
{phoneLastTwo, items: [{key: "<collection>/<id>", collection,
  role: "sender" | "receiver", roles: [...both when sent to oneself],
  businessId, businessName, service, trackingCode, stage, pieceCount,
  parts?: [{trackingCode, stage, pieceCount}], shipping?: {shippingLine,
  containerNumber, bookingNumber}, quoteCount?, requestStatus? (package
  requests), createdAtMs, updatedAtMs}],
 nextCursor: {beforeMs, skipKeys} | null}
```

The projection is `publicGuestTrackingRecord` (what the WhatsApp link already
shows) with every money field removed (`payment`, `parts[].priceCents`), plus
the business name. Never price, item list, contents, notes, addresses or the
other person's details. Clients group by business (business order = its
newest item), "Coming to you" = `role == "receiver"`. Stages are the guest
tracking stages, mapped to words by the existing guest-tracking copy.

Composite indexes (`firestore.indexes.json`): `(customerPhoneE164 ASC,
createdAt DESC)` on containerLines, barrelShipments, freightShipments,
transportRequests, parkedCars, freightQuoteRequests; `(receiverPhoneE164 ASC,
createdAt DESC)` on containerLines, barrelShipments, freightShipments;
`(sender.phoneE164 ASC, createdAt DESC)` and `(receiver.phoneE164 ASC,
createdAt DESC)` on packageRequests.

Rules: customers still cannot read any of these collections. New
server-only collections: `phoneLoginChallenges`, `phoneLoginLimits`,
`phoneAccountOptOuts`, `phoneAccountClaims` (§4.1). `users/{uid}/hiddenShipments/{key}` - owner may read,
nobody writes from a client.

### 6.1 This isn't mine

`reportShipmentNotMine({key, role})` - the record's STORED E.164 field (for a
package request, its stored E.164 number) must equal the caller's number
exactly, and the raw field must still be it; no last-digits matching. Every
field holding the caller's number is reported (`role` is informational). Writes `users/{uid}/hiddenShipments/{key}`,
adds the raw field name to the record's `phoneReportedNotMine`, and - once
per record and field - notifies the business owner through
`safeSendPreferenceNotification` (`businessActivity`), `data.type =
"phone_number_reported"`, `relatedCollection`, `relatedId`, `field`. Copy:
"A customer says a number isn't theirs" / "Someone who signed in with the
number on {code} says it isn't theirs. Check the number." Idempotent.

## 7. Email accounts and merging

- An email account whose Auth user has the number (verified through the
  existing SMS verification) IS the phone account: phone sign-in lands on it
  and `ensurePhoneAccount` reuses it. An unverified profile `phone` never
  pulls in shipments.
- Verifying a number that a placeholder holds: `linkWithCredential` fails
  with `credential-already-in-use`. Proof of ownership, then server merge:
  - WhatsApp: `requestPhoneLoginCode({phone, purpose: "link"})` +
    `verifyPhoneLoginCode` while signed in as the email account.
  - SMS: the client signs in with the returned credential on a SECONDARY
    Firebase app instance, takes that ID token, signs the secondary app out,
    and calls `completePhoneSignIn({placeholderIdToken})` as the email
    account.
- The SMS proof is checked with `verifyIdToken(token, true)` (revocation),
  and must be a phone sign-in less than 5 minutes old (`auth_time`), by the
  account that holds the number at that moment, of exactly the number being
  merged (`proofAcceptable`); otherwise `proof_invalid`. A retry after a
  partial merge needs a new proof (the old holder is gone) - and then the
  number is free, so a plain verification succeeds.
- Server (`linkPhoneToAccount`): the holder must be a placeholder (profile
  `accountOrigin == "shipment"`, `firstSignInAt == null`, Auth user without
  email or other providers) - otherwise `phone_in_use`. It copies the hidden
  shipments, deletes the placeholder Auth user and profile, sets the number
  on the email account's Auth user (`updateUser({phoneNumber})`), profile
  (`phone`, `normalizedPhone`, `phoneVerified: true`, `phoneVerifiedAt`) and
  alias. If nobody holds the number it is simply set. Retry-safe: a retry
  after a partial failure finds the number free and sets it.

## 8. Deleted accounts

`finalizeAccountDeletion` (and the `deleteUser` compatibility path) writes
`phoneAccountOptOuts/{e164}` `{deletedAt, uid}` for the deleted user's Auth
number before deleting it, and removes its `phoneAccountClaims/{e164}`.
`ensurePhoneAccount` never recreates an opted-out number. Signing in again with a code (WhatsApp or SMS) recreates the account
and removes the opt-out.

## 9. Admin lists and email-less accounts

- `listMarketplacePeople` / `getMarketplacePerson` DTOs gain
  `accountOrigin` and `notSignedInYet`; the list accepts `signInState:
  "all" | "signed_in" | "not_signed_in"`. With a filter the server reads up
  to 10 Auth pages per call until the page is full, and the console's
  `collectPeoplePages` keeps calling (up to 5 times) until it has a full page
  or the token runs out: never an empty page with "Load more" under it. The console shows a "Not signed in
  yet" label and a filter (default: hide them from the main list).
- Email-dependent paths tolerate `email: ""`: notification email delivery
  already checks `isValidEmail` (no email row is queued), and the admin
  recovery-email action already refuses a person without a valid email
  (`user-email-required`). Business staff can also be invited by WhatsApp
  number (docs/STAFF_PHONE_INVITES.md); platform invitations stay email.

## 10. Tracking page and app (clients)

- `/t/CODE` on the web (`customer-service-entry` -> `GuestTracking`): top
  section "Track it in the Laawol app" with the right store button for the
  device (`app-store-links.ts` / `GetAppBanner`) and the line "After
  installing, tap Track in WhatsApp again"; the status right below, never
  forced to install. Staff behaviour unchanged.
- `lookupGuestTracking` returns `record.signIn: [{role, lastTwo}]` - only the
  last two digits of the record's valid numbers. The page and the app (opened
  via `/t/CODE`) offer "Sign in as the number ending in ••35"; tapping it
  calls `requestPhoneLoginCode({trackingCode, role})`.
- Login screens (app, web customer console): "Sign in with your phone" next
  to email/password: number field (shared phone field), WhatsApp code,
  "Send it by text instead".
- My packages screen (app + web customer console): grouped by business,
  "Coming to you" section, each card: service, code, stage, pieces, dates
  (month-first, 12-hour), shipping info when sailed, "This isn't mine".
- Staff views of container lines / waiting packages (console + app): "Add
  the country code" next to a flagged number; "The person says this number
  isn't theirs" next to a reported one.
- Customers can edit their display name (existing profile edit).

## 11. Backfill (one time, owner runs it)

`functions/phone_backfill.js` + `functions/scripts/backfill-phone-accounts.js`
(`npm run backfill:phone-accounts -- ...`, run from `my_flutter_app/functions`
with Application Default Credentials):

```
--project <id>          required (refuses to guess)
--confirm <id>          must repeat --project
--business <businessId> only that business (start with throwaway_test_business)
--dry-run               default; prints what would change, writes nothing
--commit                write fields and create accounts
--limit <n>             records per run (default 500)
--cursor <token>        resume where the previous run stopped
```

Walks each source ordered by document id, pages of 200, under a deadline;
writes the derived fields (same convergent `recordPhonePatch`), then
`ensurePhoneAccount` for each number. Prints counts per collection (stamped,
flagged, accounts created/reused/opted-out, missing `createdAt`) and the
cursor to resume. Idempotent: a second run changes nothing.

## 12. New functions (targeted deploy)

New: `phoneAccount` (one function, `maxInstances: 1`).
Changed: `rollupVolumeOnLineWrite`, `syncParkedCarOccupancy`,
`notifyBarrelShipmentStatus`, `notifyFreightShipmentStatus`,
`notifyTransportRequestStatus`, `createBarrelShipmentPaymentIntent`,
`createBarrelOrderPaymentIntent`, `sealBarrelPool`,
`createFreightShipmentPaymentIntent`, `createTransportRequest`,
`createFreightQuoteRequest`, `submitPackageRequest`, `sweepPackageRequests`,
`lookupGuestTracking`,
`finalizeAccountDeletion`, `deleteUser`, `listMarketplacePeople`,
`listPlatformUsers`, `getMarketplacePerson`. Rules and indexes deploy too
(`firestore:rules`, `firestore:indexes`, incl. TTL on `phoneLoginChallenges`
and `phoneLoginLimits` `expiresAt`).

2026-10 fix (one phone = one account §4.1, trigger cost §3.2): every
function that runs `phone_accounts.js` account code must run the claim
version, or an old instance can still race a new one: `phoneAccount`,
`syncParkedCarOccupancy`, `rollupVolumeOnLineWrite`,
`notifyBarrelShipmentStatus`, `notifyFreightShipmentStatus`,
`notifyTransportRequestStatus`, `createTransportRequest`, `sealBarrelPool`,
`createBarrelShipmentPaymentIntent`, `createBarrelOrderPaymentIntent`,
`createFreightShipmentPaymentIntent`, `createFreightQuoteRequest`,
`submitPackageRequest`, `sweepPackageRequests`, `finalizeAccountDeletion`,
`deleteUser`, plus `syncUserCustomClaims` (early return) and
`firestore:rules` (`phoneAccountClaims`). No new function, trigger or index.

Deploy prerequisite: `verifyPhoneLoginCode` mints custom tokens, so the
functions' runtime service account needs `iam.serviceAccounts.signBlob` on
itself (role Service Account Token Creator). The WhatsApp template must be
approved before the WhatsApp path works; until then the code request answers
`whatsapp_unavailable` and clients offer SMS.

## 13. Edge cases

- Same number as sender and receiver: one account, both roles listed.
- A record whose number is changed: leaves the old account at once (read
  check), joins the new one when the derived field is re-stamped (seconds).
- A number on two businesses: both listed, grouped by business.
- A placeholder that never signs in costs nothing but an Auth row.
- Anonymous callers cannot use `getMyShipments` or link a number.
- Staff/admin accounts with a verified number see their own packages too.
