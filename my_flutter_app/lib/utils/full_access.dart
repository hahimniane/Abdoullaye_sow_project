/// "Full access" staff (docs/STAFF_FULL_ACCESS.md): a staff member the
/// business's owner, or a Laawol super admin, trusted with everything the
/// owner can do in that one business. The server decides
/// (`functions/staff_full_access.js` `effectiveUser`) and the database rules
/// follow (`hasFullAccess`); the app mirrors it, as the website does
/// (`admin_web/src/lib/full-access.ts` `effectiveProfile`), so the screens
/// the owner sees open for them too.
library;

/// Whether a stored profile is a full-access staff member: `role: "staff"`,
/// `fullAccess: true`, in a business. Anything else - an owner, ordinary
/// staff, a customer, a stray flag on someone with no business - is not.
bool isFullAccessStaff({
  required Object? role,
  required Object? fullAccess,
  required Object? businessId,
}) =>
    role == 'staff' &&
    fullAccess == true &&
    (businessId ?? '').toString().trim().isNotEmpty;

/// The role the screens act on: a full-access staff member is their
/// business's owner; anyone else keeps the role stored.
String? effectiveRole({
  required String? role,
  required Object? fullAccess,
  required Object? businessId,
}) =>
    isFullAccessStaff(
      role: role,
      fullAccess: fullAccess,
      businessId: businessId,
    )
    ? 'businessOwner'
    : role;
