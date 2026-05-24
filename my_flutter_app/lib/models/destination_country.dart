import 'package:cloud_firestore/cloud_firestore.dart';

class DestinationCountry {
  const DestinationCountry({
    required this.id,
    required this.name,
    this.code,
    this.isActive = true,
    this.sortOrder = 0,
  });

  static const fallback = DestinationCountry(
    id: 'guinea',
    name: 'Guinea',
    code: 'GN',
    isActive: true,
    sortOrder: 0,
  );

  final String id;
  final String name;
  final String? code;
  final bool isActive;
  final int sortOrder;

  factory DestinationCountry.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? <String, dynamic>{};
    return DestinationCountry(
      id: doc.id,
      name: (data['name'] ?? doc.id) as String,
      code: data['code'] as String?,
      isActive: data['isActive'] != false,
      sortOrder: (data['sortOrder'] as num?)?.toInt() ?? 0,
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'name': name,
      if (code != null && code!.isNotEmpty) 'code': code,
      'isActive': isActive,
      'sortOrder': sortOrder,
      'updatedAt': FieldValue.serverTimestamp(),
    };
  }
}
