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
  - `"needs_country_code"` - no country code and the number does NOT clearly
    fit the business's country. Nothing is guessed.
  - `"empty"` / `"invalid"`.
  - A local number becomes E.164 only when the business country is in the
    curated plan table and the digits fit it exactly: a US/Canada (NANP)
    business and exactly 10 digits `NXX NXX XXXX` (N = 2-9) or `1` + those 10
    -> `+1...`; Guinea 9 digits starting 6 or 3; Senegal 9 digits starting 7
    or 3; Mali 8; Côte d'Ivoire 10 starting 01/05/07/21/25/27; France `0` +
    9 digits (trunk 0 dropped); UK `0` + 10; Ghana `0` + 9; Nigeria `0` + 10;
    Cameroon 9 starting 6 or 2; Burkina Faso, Niger, Togo 8; Benin 10 starting
    01; Gambia 7; Sierra Leone `0` + 8; Liberia `0` + 7-8. Any other country:
    `needs_country_code`.
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

`syncRecordPhones(collection, id)` (re-reads the record, writes the derived
fields only when they differ - convergent - then ensures the accounts) runs:

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
status/payment transitions).

Known gap, accepted: the legacy direct client create of a `transportRequests`
document (old staff app path, `isLegacyTransportRecord`) is stamped on its
first update or by the backfill, not at create.

## 4. Accounts made from a record

`ensurePhoneAccount({e164, displayName, source})` in `phone_accounts.js`:

1. `phoneAccountOptOuts/{e164}` exists -> do nothing (the person deleted
   their account; see §8).
2. `auth.getUserByPhoneNumber(e164)` -> reuse that uid (a placeholder, a
   phone sign-up, or an email account that VERIFIED this number).
3. else `auth.createUser({phoneNumber: e164, displayName})`; on
   `auth/phone-number-already-exists` (a concurrent save won) read it back.
   Firebase Auth's phone uniqueness is the lock: two shipments with the same
   new number at once make one account.
4. `users/{uid}` is created with `create()` (an existing profile is never
   touched):

```
role: "customer", fullName: <record name>, email: "", phone: e164,
normalizedPhone: <digits>, phoneVerified: false,
accountOrigin: "shipment", firstSignInAt: null,
createdFrom: {collection, recordId, field},
preferredLanguage: "fr" | "en" (from loginLanguage),
notificationPreferences: defaults, createdAt, updatedAt
```

Never for an empty, invalid or `needs_country_code` number. Best-effort: any
failure is logged and swallowed - a staff save never fails because of it -
and the next write or the backfill retries.

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

Callables (all `enforceAppCheck`, `cors`, `invoker: "public"`,
`maxInstances: 2`):

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
`sign_in_required` (link without a real account).

`verifyPhoneLoginCode({challengeId, code})`:
- sign-in purpose -> `{customToken, uid, isNewAccount}`; the client calls
  `signInWithCustomToken`. The server has already done the sign-in
  bookkeeping (§5.3), so no `completePhoneSignIn` call is needed.
- link purpose (caller must be the uid that asked) -> `{linked: true,
  merged: boolean}` (§7).
Refusals: `code_wrong` (with `attemptsLeft`), `code_expired`,
`too_many_attempts`, `challenge_not_found`, `phone_in_use` (link: the number
belongs to an account that has signed in), `wrong_account`.

Storage: `phoneLoginChallenges/{challengeId}` (server only):
`{phoneE164, codeHash: sha256(challengeId:code), purpose, linkUid,
expiresAtMs (now + 10 min), attempts, status: open|used|locked,
createdAtMs, source: phone|tracking}`. The code is 6 random digits
(`crypto.randomInt`), never stored or logged in clear. 5 wrong attempts lock
the challenge. A used challenge cannot be reused.

Rate limits (`phoneLoginLimits/{sha256(kind:key)}`, server only; enforced in
the emulator too):

| Key | Limit |
| --- | --- |
| per number | 5 sends / hour, 10 / day |
| per client address (`clientAddressFromRequest`) | 20 sends / hour |
| per tracking code (masked flow) | 5 sends / hour |
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
{items: [{key: "<collection>/<id>", role: "sender" | "receiver",
  businessId, businessName, service, trackingCode, stage, pieceCount,
  parts?: [{trackingCode, stage, pieceCount}], shipping?: {shippingLine,
  containerNumber, bookingNumber}, quoteCount?, createdAtMs, updatedAtMs}],
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
`phoneAccountOptOuts`. `users/{uid}/hiddenShipments/{key}` - owner may read,
nobody writes from a client.

### 6.1 This isn't mine

`reportShipmentNotMine({key, role})` - the record must currently carry the
caller's number in that role. Writes `users/{uid}/hiddenShipments/{key}`,
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
number before deleting it. `ensurePhoneAccount` never recreates an opted-out
number. Signing in again with a code (WhatsApp or SMS) recreates the account
and removes the opt-out.

## 9. Admin lists and email-less accounts

- `listMarketplacePeople` / `getMarketplacePerson` DTOs gain
  `accountOrigin` and `notSignedInYet`; the list accepts `signInState:
  "all" | "signed_in" | "not_signed_in"`. The console shows a "Not signed in
  yet" label and a filter (default: hide them from the main list).
- Email-dependent paths must tolerate `email: ""`: notification email
  delivery already checks `isValidEmail`; password-reset/invite/verify-email
  actions refuse a person without an email with `reason: "no_email"`.

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
(`npm run backfill:phone-accounts -- ...`):

```
--project <id>          required (refuses to guess)
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

New: `requestPhoneLoginCode`, `verifyPhoneLoginCode`, `completePhoneSignIn`,
`getMyShipments`, `reportShipmentNotMine` (each `maxInstances: 2`).
Changed: `rollupVolumeOnLineWrite`, `syncParkedCarOccupancy`,
`notifyBarrelShipmentStatus`, `notifyFreightShipmentStatus`,
`notifyTransportRequestStatus`, the create callables in §3.1, the package
request callables, `lookupGuestTracking`, `finalizeAccountDeletion`,
`deleteUser`, `listMarketplacePeople`, `listPlatformUsers`,
`getMarketplacePerson`.

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
