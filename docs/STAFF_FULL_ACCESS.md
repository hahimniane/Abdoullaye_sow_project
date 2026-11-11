# Staff full access

Owner, 11/11/2026: "give hassimiou niane the same privileges as the owner"
(at Keren Auto Sales), answered "A": a new "Full access" option for staff.

## Rules

- **Who grants it:** the business's real owner (People → staff row → "Give
  full access"), or a Laawol super admin (admin console → user → "Full
  access"). Ordinary staff cannot give it, and a full-access person cannot
  give it to anyone, themselves included.
- **What it gives:** everything the owner can do in that one business:
  settings, services, prices, parking lots, staff and permissions, reports.
  The business keeps its owner.
- **Kept owner-only:** transferring the business, and the business's bank
  (Zelle check connection) and Stripe payout setup.
- **Logged:** every grant and removal writes an audit log line
  (`business_staff_full_access_granted` / `_removed`) and stamps
  `fullAccessChangedAt` / `fullAccessChangedBy` on the user.

## How it works

- `users/{uid}.fullAccess: true` on a `role: "staff"` user with a
  `businessId`. Users cannot write the field themselves (`firestore.rules`
  self-update allow-list).
- **Server:** `getUserProfile` answers `staff_full_access.effectiveUser`:
  such a user reads as `role: "businessOwner"` with `storedRole: "staff"`, so
  every existing owner check passes. `zelle_check.bankRoleOf` treats them as
  staff. Granting rides on `updateBusinessStaffPermissions` with a boolean
  `fullAccess`, checked by `fullAccessGrantRefusal` (reasons
  `full_access_owner_only`, `full_access_staff_only`). Leaving a business
  clears the field (`nonBusinessAuthorityCleanup`).
- **Rules:** `hasFullAccess(userId)` joins `canManageBusinessSection`,
  `payNowRead` and `inventoryAllStores`.
- **Website:** `admin_web/src/lib/full-access.ts` (`effectiveProfile`,
  applied once in `console-router`; `isRealOwner` decides who sees the
  grant button). The header reads "Full access" for them, and
  `canManageBank` keeps the bank card owner-only.
- **Phone app:** next build. It reads `users/{uid}.role` directly
  (`auth_provider.dart`), so until then a full-access person sees their staff
  screens in the app; the website gives them everything.

## Tests

`functions/test/staff-full-access.test.js`, the "full access" block in
`parking-lots-callables.test.js`, the rules block "full access stays out of
a user's own reach", and `admin_web/src/lib/full-access.test.ts`.
