import 'dart:collection';

const baseParkedCarStatusOptions = ['active', 'reserved', 'completed'];

List<String> parkedCarStatusOptions(String currentStatus) {
  final normalized = currentStatus.trim();
  final statuses = <String>[
    ...baseParkedCarStatusOptions,
    if (normalized.isNotEmpty) normalized,
  ];
  return LinkedHashSet<String>.of(statuses).toList(growable: false);
}
