abstract final class BusinessPermission {
  static const profile = 'profile';
  static const listings = 'listings';
  static const purchases = 'purchases';
  static const barrels = 'barrels';
  static const freight = 'freight';
  static const transport = 'transport';
  static const parking = 'parking';
  static const ledger = 'ledger';
  static const invoices = 'invoices';
  static const containers = 'containers';
  static const inventory = 'inventory';
  static const destinations = 'destinations';
  static const people = 'people';
  static const reviews = 'reviews';
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

/// Invoices and receipts open to anyone holding `ledger` (the lot's money) OR
/// the narrower `invoices` permission, which lets a person write invoices
/// without seeing the lot ledger's activity, expenses or reports. Those
/// screens stay on `ledger` alone. Mirrors the server, which accepts either.
bool canAccessInvoices({
  required bool isStaff,
  required Iterable<String> permissions,
}) =>
    canAccessBusinessPermission(
      isStaff: isStaff,
      permissions: permissions,
      permission: BusinessPermission.ledger,
    ) ||
    canAccessBusinessPermission(
      isStaff: isStaff,
      permissions: permissions,
      permission: BusinessPermission.invoices,
    );
