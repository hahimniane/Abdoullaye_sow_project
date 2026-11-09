import 'package:shared_preferences/shared_preferences.dart';

import '../models/customer_service_catalog.dart';

/// A shortcut saved under an id that has since been renamed. Freight folded
/// into Send a package (docs/PACKAGE_PRICE_LIST.md decision 12), and so did
/// Send a barrel (barrels are one of the things a package request carries),
/// so a pinned "freight" or "barrel" shortcut now opens Send a package
/// instead of silently vanishing.
String migratedServiceId(String stored) =>
    stored == 'freight' || stored == 'barrel' ? 'package' : stored;

/// Persists the customer's chosen bottom-navbar shortcuts.
class NavPrefs {
  static const _key = 'customer_navbar_services_v1';

  Future<List<String>> pinned() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getStringList(_key);
    if (saved == null) return List<String>.from(defaultPinnedServiceIds);
    final valid = <String>[];
    for (final stored in saved) {
      final id = migratedServiceId(stored);
      if (serviceById(id) != null && !valid.contains(id)) valid.add(id);
    }
    if (valid.length > maxPinnedServices) {
      valid.removeRange(maxPinnedServices, valid.length);
    }
    return valid.isEmpty ? List<String>.from(defaultPinnedServiceIds) : valid;
  }

  Future<void> setPinned(List<String> ids) async {
    final prefs = await SharedPreferences.getInstance();
    final unique = <String>[];
    for (final stored in ids) {
      final id = migratedServiceId(stored);
      if (serviceById(id) != null && !unique.contains(id)) unique.add(id);
    }
    await prefs.setStringList(_key, unique.take(maxPinnedServices).toList());
  }
}
