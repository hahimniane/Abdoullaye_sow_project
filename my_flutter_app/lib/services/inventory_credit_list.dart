/// The "Credit owed" list's search, "Overdue only" and grouping as pure
/// functions. Mirrors the website's `filterOpenCredit`, `groupOpenCredit` and
/// `customerKeyOf` in admin_web/src/lib/inventory-credit.ts, so the phone and
/// the console read the same list the same way. Collector and store narrowing
/// stay in [inventoryOpenCredits]; these work on what that returns.
library;

import 'inventory.dart';
import 'inventory_credit.dart';

/// How the credit list is grouped.
enum InventoryCreditGroupBy { none, customer, collector, store }

/// Two sales of one customer share a key: the phone's digits when there are
/// at least seven, else the name in lower case with single spaces.
String inventoryCreditCustomerKey(String name, String phone) {
  final digits = phone.replaceAll(RegExp(r'[^0-9]'), '');
  if (digits.length >= 7) return 'tel:$digits';
  final cleaned = name.trim().toLowerCase().replaceAll(RegExp(r'\s+'), ' ');
  return 'name:$cleaned';
}

/// The credits to show: when [overdueOnly], only those past their due date,
/// and when [query] has words, those whose customer name holds every word, or
/// whose phone holds the digits typed (three or more).
List<InventorySale> filterInventoryCredits(
  List<InventorySale> credits, {
  bool overdueOnly = false,
  String query = '',
  required DateTime today,
}) {
  final text = query.trim();
  final words = text
      .toLowerCase()
      .split(RegExp(r'\s+'))
      .where((word) => word.isNotEmpty)
      .toList();
  final digits = text.replaceAll(RegExp(r'[^0-9]'), '');
  if (!overdueOnly && words.isEmpty) return credits;
  return [
    for (final sale in credits)
      if ((!overdueOnly || inventoryCreditOverdue(sale, today: today)) &&
          (words.isEmpty || _matches(sale, words, digits)))
        sale,
  ];
}

bool _matches(InventorySale sale, List<String> words, String digits) {
  final name = (sale.credit?.customerName ?? '').toLowerCase();
  if (words.every(name.contains)) return true;
  if (digits.length < 3) return false;
  final phone = (sale.credit?.customerPhone ?? '').replaceAll(
    RegExp(r'[^0-9]'),
    '',
  );
  return phone.contains(digits);
}

/// One group of credits with what it is owed.
class InventoryCreditGroup {
  const InventoryCreditGroup({
    required this.key,
    required this.label,
    required this.detail,
    required this.rows,
    required this.totals,
  });

  final String key;

  /// The customer's, collector's or store's name ('' when unknown).
  final String label;

  /// The customer's phone, for a customer group.
  final String detail;
  final List<InventorySale> rows;
  final InventoryCreditTotals totals;
}

/// [credits] grouped by [by], each group in the order its first (most
/// urgent) row came. [none] is one group. [collectorName] and [storeName]
/// turn ids into words.
List<InventoryCreditGroup> groupInventoryCredits(
  List<InventorySale> credits,
  InventoryCreditGroupBy by, {
  required DateTime today,
  String Function(String staffId)? collectorName,
  String Function(InventorySale sale)? storeName,
}) {
  if (by == InventoryCreditGroupBy.none) {
    return [
      InventoryCreditGroup(
        key: 'all',
        label: '',
        detail: '',
        rows: credits,
        totals: inventoryCreditTotals(credits, today: today),
      ),
    ];
  }
  final order = <String>[];
  final labels = <String, String>{};
  final details = <String, String>{};
  final rows = <String, List<InventorySale>>{};
  for (final sale in credits) {
    final credit = sale.credit;
    final String key;
    final String label;
    var detail = '';
    switch (by) {
      case InventoryCreditGroupBy.customer:
        key = inventoryCreditCustomerKey(
          credit?.customerName ?? '',
          credit?.customerPhone ?? '',
        );
        label = credit?.customerName ?? '';
        detail = credit?.customerPhone ?? '';
      case InventoryCreditGroupBy.collector:
        key = credit?.collectorStaffId ?? '';
        label = collectorName?.call(key) ?? key;
      case InventoryCreditGroupBy.store:
        key = sale.storeId;
        label = storeName?.call(sale) ?? sale.storeName;
      case InventoryCreditGroupBy.none:
        key = 'all';
        label = '';
    }
    if (!rows.containsKey(key)) {
      order.add(key);
      labels[key] = label;
      details[key] = detail;
    }
    (rows[key] ??= []).add(sale);
  }
  return [
    for (final key in order)
      InventoryCreditGroup(
        key: key,
        label: labels[key] ?? '',
        detail: details[key] ?? '',
        rows: rows[key]!,
        totals: inventoryCreditTotals(rows[key]!, today: today),
      ),
  ];
}
