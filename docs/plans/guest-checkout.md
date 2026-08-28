# Guest checkout — book and pay without an account

## The goal

A customer arrives from the public site, fills in a shipping request, pays, and
receives their tracking number — without ever choosing a password or verifying
an email. Afterwards they may claim the booking into a real account, keeping
its history.

## What already exists

The pre-auth path is most of the way there. `CustomerServiceEntry` renders the
full booking form for a signed-out visitor, and every submit handler ends at
the same wall:

```ts
if (!authenticated) { onAuthenticationRequired?.(); return; }
```

Four call sites share that shape (barrel, freight, shared barrel, transport).
The form, the quoting, the pickup pricing and the validation all already run
without an account. Only the last step demands one.

On the backend, `createCustomerCheckoutSession` dispatches to a per-service
create function. Inside those, the signed-in user is used in exactly four
ways: `requireAuth`, `recordMarketplaceDisclosure`, `admin.auth().getUser` for
the email, and the `customerUid` / `customerEmail` fields written to the
record.

## The decision: anonymous auth, not unauthenticated callables

The customer gets a real Firebase uid from `signInAnonymously()` instead of
signing up. No password, no email verification, no account screen.

This is chosen over opening the callables to unauthenticated traffic because
every downstream contract keeps holding: security rules still compare
`request.auth.uid` to `customerUid`, disclosure records still attach to a
subject, notifications and receipts still have somewhere to point, and the
per-caller rate limits keep working. Opening the callables would mean
reworking all of that at once, on the payment path, which is the least
forgiving place in the product to be inventive.

It also gives the upgrade path for free: `linkWithCredential` turns the
anonymous account into a real one and the prior bookings come with it. That is
Firebase's designed route, not a workaround.

The guest is not anonymous to the business — they give a name, an email and a
phone, because a shipment nobody can be reached about is not a shipment. What
they skip is the account.

## Shape of the work

### Backend

1. A guest contact block (`guestEmail`, `guestPhone`, `guestName`) accepted by
   the create functions, required when the caller is anonymous and ignored
   when it is not.
2. `customerEmail` resolves from the guest block when `admin.auth().getUser`
   returns no email, which is always the case for an anonymous caller.
3. `isGuest: true` stamped on the record so operations can tell the two apart.
4. Rate limits on the guest path keyed to something better than a fresh uid —
   an anonymous caller can mint a new uid at will, so the limit keys on email
   and IP.
5. The confirmation email carries the tracking code, since a guest has no
   inbox inside the product to find it in.
6. A claim callable that attaches prior guest bookings to a newly linked
   account.

### Web

1. Replace the four `onAuthenticationRequired` walls with a guest-or-sign-in
   choice.
2. A contact step collecting name, email and phone before checkout.
3. After payment, a confirmation showing the tracking code, a link into the
   public tracking page, and an optional "create an account to keep this".
4. Every new string in `french-dom.ts`, placeholders and aria-labels included.

### Mobile

The same three, mirrored — guardrail: the Flutter app ships in the same change,
not after it. New ARB keys in both catalogs, `flutter gen-l10n`, no hardcoded
copy.

## Verification

Backend unit tests for the guest contact contract, the email fallback and the
rate-limit keying. Web tests for the new gate. Then the real thing: emulators
up, a guest booking driven through the browser in English and French, the
Stripe test card, the tracking code checked against the public lookup, and the
same run on the Flutter app.

## Risks

- **Abuse.** An anonymous uid is free to mint. Mitigated by keying limits on
  email and IP, and by App Check staying enforced.
- **Anonymous account sprawl.** Firebase Auth accumulates one uid per guest.
  Acceptable; they are cheap and prunable.
- **A guest who loses the tracking code** has no account to recover it from.
  Mitigated by the confirmation email, which is why the email is required.
