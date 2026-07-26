import 'package:cloud_firestore/cloud_firestore.dart';

/// A business can register more than one physical office/drop-off location
/// (separate branches), so a customer bringing an item to the office picks
/// from these instead of one implicit business address.
class OfficeLocation {
  const OfficeLocation({
    required this.id,
    required this.label,
    required this.address,
    this.isActive = true,
    this.sortOrder = 0,
  });

  final String id;
  final String label;
  final String address;
  final bool isActive;
  final int sortOrder;

  factory OfficeLocation.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? <String, dynamic>{};
    return OfficeLocation(
      id: doc.id,
      label: (data['label'] ?? 'Office') as String,
      address: (data['address'] ?? '') as String,
      isActive: data['isActive'] != false,
      sortOrder: (data['sortOrder'] as num?)?.toInt() ?? 0,
    );
  }

  static List<OfficeLocation> sorted(List<OfficeLocation> locations) {
    final copy = [...locations];
    copy.sort((a, b) {
      final order = a.sortOrder.compareTo(b.sortOrder);
      return order != 0 ? order : a.label.compareTo(b.label);
    });
    return copy;
  }
}
