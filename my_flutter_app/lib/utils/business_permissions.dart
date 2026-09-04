abstract final class BusinessPermission {
  static const profile = 'profile';
  static const listings = 'listings';
  static const purchases = 'purchases';
  static const barrels = 'barrels';
  static const freight = 'freight';
  static const transport = 'transport';
  static const parking = 'parking';
  static const ledger = 'ledger';
  static const destinations = 'destinations';
  static const people = 'people';
  static const support = 'support';
  static const growth = 'growth';
}

bool canAccessBusinessPermission({
  required bool isStaff,
  required Iterable<String> permissions,
  required String permission,
}) {
  if (!isStaff) return true;
  return permissions.contains(permission);
}
