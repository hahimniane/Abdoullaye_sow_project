# Staff invited by phone (WhatsApp)

Status: contract for branch `feat/staff-phone-invite`. Server first; the
console (`admin_web`) and the app (`my_flutter_app`) build on exactly what is
written here. Decisions are the owner's (2026-10).

## 1. What it does

A business owner invites a person by their WhatsApp number instead of an
email. The person gets one bilingual WhatsApp message with an **Accept**
button (`https://customer.laawoldigital.com/j/<token>`), signs in with the
normal phone code (WhatsApp code, text as the fallback) exactly like a
customer, and becomes the business's staff. No password, no email.

If the number already has an account (a customer who signed in, or an
account made from a shipment's number), that SAME account becomes the staff
account and keeps its packages: one phone = one account
(`phoneAccountClaims`, docs/PHONE_ACCOUNTS.md §4.1).

Until Meta approves the template the invitation is still created and the
owner sees "WhatsApp message not sent yet - share this link" with the link
to copy (console and app).

## 2. The sign-in exception (owner decision 1)

Phone-code sign-in stays customers-only, with ONE explicit, tested
exception: **staff who joined through a phone invitation** sign in with the
code of the invited number. Pure rule `staffPhoneSignInAllowed(profile,
phone)` in `functions/staff_phone_invite.js`, used by
`phone_accounts.phoneSignInAllowed(profile, {phone})`:

- `role == "staff"`, no `platformAdmin`, no `adminRole`, a `businessId`;
- `signInMethod == "phone"` and `phoneInvite.phoneE164` equals the number
  signing in.

Written only by `acceptAccessInvitation` for a phone invitation:

```
signInMethod: "phone",
phoneInvite: {invitationId, phoneE164, businessId, acceptedAt}
```

The rules' own-profile update allow-list does not include either field, so
no client can write them. They are removed (`phoneInviteCleanup`) whenever
the person stops being business staff (`nonBusinessAuthorityCleanup`), when
an email invitation is accepted, and when a super admin makes someone staff
who was not staff before (`updateBusinessMembership`).

Still refused (`phone_sign_in_unavailable`, the client signs out): owners
(`businessOwner`), platform admins / admin roles, staff who joined by email,
and linking a number to a staff account (`purpose: "link"` passes no phone,
so the exception never applies).

Codes: a number with a live phone invitation (and no account yet) is sent a
real code (`numberHasLiveInvite`), like a number some record carries; a
phone-invited staff member's own number too. Every other staff/owner/admin
number still gets the decoy challenge.

## 3. Data

Same server-only collection as email invitations, `accessInvitations`
(rules: no client access). A phone invitation:

```
kind: "business", channel: "phone", email: "", phoneE164, phoneLastTwo,
fullName, locale, targetUid: <account holding the number at invite time>|"",
status: pending|accepted|cancelled (expired is derived), adminRole: "",
businessId, businessName, businessPermissions,
inventoryStoreAccess?: {allStores: boolean, homeStoreId: string},
linkToken: <43-char base64url>, createdAt, updatedAt, expiresAt (+7 days),
invitedBy, invitedByName, sendCount,
lastWhatsAppStatus: sent|not_configured|template_pending|failed,
lastWhatsAppError, lastWhatsAppMessageId, lastWhatsAppAt
```

- Doc id: `phoneInvitationId(e164, businessId)` = first 40 hex of
  `sha256("business:phone:<e164>:<businessId>")` - never an email
  invitation's id (`sha256("business:<email>:<businessId>")`).
- Email invitations now also store `channel: "email"`; documents without a
  channel are email ones (`invitationChannel`).
- `inventoryStoreAccess` may be on either channel.
- Lookups: `linkToken ==` and `phoneE164 ==`, one equality filter each:
  no composite index. No rules or index change.

## 4. Callables (no new function)

All existing; `inviteBusinessMember` and `resendAccessInvitation` now carry
the WhatsApp secrets (`{...MARKETPLACE_PEOPLE_CALLABLE_OPTIONS, secrets}`).

### `inviteBusinessMember`

```
{businessId, fullName, method: "phone" | "email" (default "email"),
 phone: "+224622123456",            // method phone (E.164 from the field;
                                    // a NANP business may send 10 digits)
 email: "a@b.c",                    // method email
 businessPermissions: [...],
 inventoryStoreAccess?: {allStores: true} | {allStores: false,
   homeStoreId: "<store id>"},      // only when the business has 2+ stores
 locale: "en" | "fr"}
```

Phone answer:

```
{success, invitationId, channel: "phone", email: "", phoneMasked: "+224 ••••56",
 status: "pending", inviteLink: "https://customer.laawoldigital.com/j/<token>",
 expiresAtMs, targetUid,
 whatsappSent: boolean,
 whatsappStatus: "sent" | "not_configured" | "template_pending" | "failed"}
```

`whatsappSent == false` is NOT an error: show "WhatsApp message not sent yet
- share this link" with the link and a Copy button.

Refusals (`details.reason`): `full-name-required`, `valid-phone-required`,
`phone-country-code-required`, `store-access-invalid`, `store-not-found`,
`existing-authority-conflict` (the number's account has business or
platform access), `invitation-already-pending`, `business-owner-required`,
`business-required`, `business-not-found`, `valid-email-required` (email).

### `listBusinessInvitations`

Rows gain: `channel` ("phone" | "email"), `phoneMasked`, `phoneLastTwo`,
`inviteLink` (phone only), `whatsappStatus` (phone only, "" before the first
attempt), `inventoryStoreAccess` (or null). A phone row: name, masked
number, status, Resend, Cancel, Copy link; when `whatsappStatus != "sent"`
the "not sent yet - share this link" note.

### `resendAccessInvitation`

Phone: a fresh seven days, the WhatsApp message again, SAME link (a link the
owner already shared keeps working). Answer as the invite's phone answer.

### `cancelAccessInvitation`

Unchanged (the link stops working: preview says cancelled, sign-in and
accept refuse).

### `phoneAccount` (existing, docs/PHONE_ACCOUNTS.md §5)

- `{action: "staffInvite", token}` - no sign-in needed. Answer:
  `{invitationId, status: "pending" | "expired" | "cancelled" | "accepted",
  businessId, businessName, invitedByName, fullName, phoneLastTwo,
  expiresAtMs}`. Unknown token: `invite_not_found`.
- `{action: "requestPhoneLoginCode", inviteToken}` - the masked flow (like
  `trackingCode`): the server reads the invited number; the client never
  gets it. Refusals as §5.1 of PHONE_ACCOUNTS.md plus `invite_not_found`
  (unknown, cancelled, expired or accepted invitation). Own rate bucket
  (`invite_hour`, 5 sends / hour per link). The SMS fallback needs the full
  number typed by the person, as from a tracking link.

### `acceptAccessInvitation`

```
{inviteToken?: "<token>"}   // from the /j/ link (preferred)
{invitationId?: "<id>"}
{}                          // exactly one live invitation for the caller's
                            // verified email OR verified phone
```

Answer: `{success, invitationId, status: "accepted", kind: "business" |
"platform", channel, businessId, businessName}`.

A phone invitation is accepted by the account whose Auth number (only ever
set through proof) equals `phoneE164`; same expiry/cancel rules and the same
conflict rule as email (a profile whose role is not customer is refused).
The profile becomes `role: "staff"`, business fields, permissions, the
marker of §2, and - when the invitation carries `inventoryStoreAccess` -
`inventoryHomeStoreId` / `inventoryAllStores` (the effect of
`setInventoryStaffAccess`; a store archived since leaves no home store).

Refusals: `active-invitation-not-found`, `invitation-selection-required`,
`invitation-expired`, `invitation-not-pending`,
`invitation-identity-mismatch` (signed in with another number),
`existing-authority-conflict`, `verified-email-required` (no verified email
and no phone).

After it answers, the client refreshes the ID token (claims follow the
profile through `syncUserCustomClaims`) and reloads the profile: the person
lands on the staff screens.

## 5. Removal cuts access at once (owner decision 2)

`updateBusinessMembership` (role customer, or another business) and
`updateUserRole` (to customer) clear the business fields and the marker and
call `admin.auth().revokeRefreshTokens(uid)` (`accessRemoved(before,
after)`, pure). Suspension and deletion already revoked. From that moment:

- every rule and callable refuses (they read the profile);
- the next ID-token refresh fails (`auth/user-token-expired`) and the
  Firebase SDK signs the user out;
- both clients follow the live profile: when it loses business or platform
  access they force a token refresh at once, so the person is signed out
  right away instead of within the hour.

## 6. The link

`https://customer.laawoldigital.com/j/<43-char token>`:

- Android intent filter `pathPrefix="/j/"`, apple-app-site-association
  `/j/*` - a new prefix: no existing one fits (`/t/` is tracking: an app
  already in the stores would open an invitation as an unknown tracking
  code; with `/j/` an older app leaves the link to the browser).
- `.htaccess`: `^j/([A-Za-z0-9_-]{43})/?$ -> /?service=staff-invite&j=$1`;
  the console's not-found page forwards the path form the same way.
- The page/screen: "{inviter} invited you to join {business} on Laawol as
  staff." Not signed in: "Accept with the number ending in ••35" (masked
  WhatsApp code; "Send it by text instead" asks for the full number), then
  accept. Signed in with that number: "Accept invitation". Signed in as
  another account: "Sign out to continue". Expired / cancelled / accepted /
  unknown: a plain message to ask the business for a new invitation.

## 7. The WhatsApp template

`staff_invite_2lang`, category UTILITY, language `en`, created by the owner
with `~/laawol-deploy-logs/create_staff_invite_template.py` (prints by
default, `--submit` sends; the token comes from Secret Manager and is never
printed). Body and variables: docs/WHATSAPP_CONTAINER_UPDATES.md
(`staff_invite_2lang`). Button: URL, `Accept · Accepter`,
`https://customer.laawoldigital.com/j/{{1}}` (the link token). Built only by
`staffInviteTemplateMessage` in `whatsapp_templates.js`.

Meta's "template not available" answers (132001 not approved / no such
template, 132015 paused, 132016 disabled) record `template_pending`; unset
secrets `not_configured`; any other failure `failed`. All three leave the
invitation pending with its link.

## 8. Functions to deploy (targeted)

Changed: `inviteBusinessMember`, `resendAccessInvitation`,
`cancelAccessInvitation`, `listBusinessInvitations`, `acceptAccessInvitation`,
`phoneAccount`, `updateBusinessMembership`, `transferBusinessOwnership`
(shares the membership handler), `updateUserRole`, `listMarketplacePeople`,
`listPlatformUsers`, `getMarketplacePerson` (invitation rows show the masked
number), `invitePlatformAdmin` (shares `createAccessInvitation`; behaviour
unchanged). No new function, trigger, rule or index. The WhatsApp template
must be approved before messages go out; until then owners share the link.
