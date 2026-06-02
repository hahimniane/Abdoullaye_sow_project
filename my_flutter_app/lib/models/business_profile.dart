import 'package:cloud_firestore/cloud_firestore.dart';

import 'business_service.dart';

class BusinessProfile {
  const BusinessProfile({
    required this.id,
    required this.name,
    this.status = 'pending',
    this.ownerUid,
    this.phone,
    this.email,
    this.website,
    this.profileImageUrl,
    this.profileImagePath,
    this.enabledServices = defaultBusinessServiceValues,
    this.serviceNote,
    this.addressLine1,
    this.city,
    this.state,
    this.postalCode,
    this.carHoldPricingMode = 'flat',
    this.carHoldFlatFee = 500,
    this.carHoldDailyRate = 100,
    this.carHoldMaxDays = 14,
  });

  static const defaultBusinessId = 'keren_auto_sales';
  static const defaultBusinessName = 'Keren';

  final String id;
  final String name;
  final String status;
  final String? ownerUid;
  final String? phone;
  final String? email;
  final String? website;
  final String? profileImageUrl;
  final String? profileImagePath;
  final List<String> enabledServices;
  final String? serviceNote;
  final String? addressLine1;
  final String? city;
  final String? state;
  final String? postalCode;
  final String carHoldPricingMode;
  final double carHoldFlatFee;
  final double carHoldDailyRate;
  final int carHoldMaxDays;

  bool get isApproved => status == 'approved';
  bool hasService(BusinessServiceKey key) =>
      hasBusinessService(enabledServices, key);

  factory BusinessProfile.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? <String, dynamic>{};
    return BusinessProfile(
      id: doc.id,
      name: (data['name'] ?? doc.id) as String,
      status: (data['status'] ?? 'pending') as String,
      ownerUid: data['ownerUid'] as String?,
      phone: data['phone'] as String?,
      email: data['email'] as String?,
      website: data['website'] as String?,
      profileImageUrl: data['profileImageUrl'] as String?,
      profileImagePath: data['profileImagePath'] as String?,
      enabledServices: normalizeBusinessServices(data['enabledServices']),
      serviceNote: data['serviceNote'] as String?,
      addressLine1: data['addressLine1'] as String?,
      city: data['city'] as String?,
      state: data['state'] as String?,
      postalCode: data['postalCode'] as String?,
      carHoldPricingMode: (data['carHoldPricingMode'] ?? 'flat') as String,
      carHoldFlatFee: _parseDouble(data['carHoldFlatFee'], 500),
      carHoldDailyRate: _parseDouble(data['carHoldDailyRate'], 100),
      carHoldMaxDays: _parseInt(data['carHoldMaxDays'], 14).clamp(1, 30),
    );
  }

  static double _parseDouble(dynamic value, double fallback) {
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value) ?? fallback;
    return fallback;
  }

  static int _parseInt(dynamic value, int fallback) {
    if (value is num) return value.toInt();
    if (value is String) return int.tryParse(value) ?? fallback;
    return fallback;
  }

  String get addressLabel {
    return [
      addressLine1,
      city,
      state,
      postalCode,
    ].whereType<String>().where((part) => part.trim().isNotEmpty).join(', ');
  }
}
