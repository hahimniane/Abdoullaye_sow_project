// Platform activity alerts (functions `platform_activity_alerts.js`): a push
// to platform admins when someone in any business parks a car, saves a
// package or makes a shop sale, and when someone joins a business as staff.
// The server sends them only to admins whose role looks after businesses
// (`getsPlatformActivity`), so the switch is shown to exactly those people.

/// The platform admin roles that get the feed (server
/// `PLATFORM_ACTIVITY_ROLES`).
const platformActivityAdminRoles = {'superAdmin', 'operationsManager'};

/// "Platform activity": a platform admin (`role == admin`) whose admin role
/// is `superAdmin` or `operationsManager`.
bool showPlatformActivitySwitch({
  required String role,
  required String adminRole,
}) =>
    role.trim() == 'admin' &&
    platformActivityAdminRoles.contains(adminRole.trim());
