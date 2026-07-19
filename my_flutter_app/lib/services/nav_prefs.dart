import 'package:shared_preferences/shared_preferences.dart';

import '../models/customer_service_catalog.dart';

/// Persists the customer's chosen bottom-navbar shortcuts.
class NavPrefs {
  static const _key = 'customer_navbar_services_v1';

  Future<List<String>> pinned() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getStringList(_key);
    if (saved == null) return List<String>.from(defaultPinnedServiceIds);
    final valid = saved
        .where((id) => serviceById(id) != null)
        .take(maxPinnedServices)
        .toList();
    return valid.isEmpty ? List<String>.from(defaultPinnedServiceIds) : valid;
  }

  Future<void> setPinned(List<String> ids) async {
    final prefs = await SharedPreferences.getInstance();
    final unique = <String>[];
    for (final id in ids) {
      if (serviceById(id) != null && !unique.contains(id)) unique.add(id);
    }
    await prefs.setStringList(_key, unique.take(maxPinnedServices).toList());
  }
}
