import 'package:cloud_firestore/cloud_firestore.dart';

import 'business_profile.dart';
import 'business_service.dart';
import 'destination_country.dart';

class BusinessDestinationOption {
  const BusinessDestinationOption({
    required this.id,
    required this.businessId,
    required this.businessName,
    required this.country,
    this.businessPhone,
    this.businessEmail,
    this.businessWebsite,
    this.businessProfileImageUrl,
    this.enabledServices = defaultBusinessServiceValues,
    this.serviceNote,
    this.businessStatus = 'approved',
  });

  final String id;
  final String businessId;
  final String businessName;
  final DestinationCountry country;
  final String? businessPhone;
  final String? businessEmail;
  final String? businessWebsite;
  final String? businessProfileImageUrl;
  final List<String> enabledServices;
  final String? serviceNote;
  final String businessStatus;

  bool get isAvailable =>
      businessStatus == 'approved' &&
      hasBusinessService(enabledServices, BusinessServiceKey.barrelShipping) &&
      country.isActive &&
      country.barrelShippingPrice > 0;

  factory BusinessDestinationOption.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? <String, dynamic>{};
    return BusinessDestinationOption.fromFirestoreData(doc, data);
  }

  factory BusinessDestinationOption.fromFunctionData(
    Map<String, dynamic> data,
  ) {
    final country = data['country'] is Map
        ? Map<String, dynamic>.from(data['country'] as Map)
        : <String, dynamic>{};
    return BusinessDestinationOption(
      id: (data['id'] ?? '') as String,
      businessId:
          (data['businessId'] ?? BusinessProfile.defaultBusinessId) as String,
      businessName:
          (data['businessName'] ?? BusinessProfile.defaultBusinessName)
              as String,
      businessPhone: data['businessPhone'] as String?,
      businessEmail: data['businessEmail'] as String?,
      businessWebsite: data['businessWebsite'] as String?,
      businessProfileImageUrl: data['businessProfileImageUrl'] as String?,
      enabledServices: normalizeBusinessServices(data['enabledServices']),
      serviceNote: data['serviceNote'] as String?,
      businessStatus: (data['businessStatus'] ?? 'approved') as String,
      country: DestinationCountry(
        id: (country['id'] ?? '') as String,
        name: (country['name'] ?? '') as String,
        code: country['code'] as String?,
        isActive: country['isActive'] == true,
        sortOrder: (country['sortOrder'] as num?)?.toInt() ?? 0,
        barrelShippingPrice:
            (country['barrelShippingPrice'] as num?)?.toDouble() ?? 0,
        deliveryEstimateMinDays: (country['deliveryEstimateMinDays'] as num?)
            ?.toInt(),
        deliveryEstimateMaxDays: (country['deliveryEstimateMaxDays'] as num?)
            ?.toInt(),
        destinationNote: country['destinationNote'] as String?,
      ),
    );
  }

  factory BusinessDestinationOption.fromFirestoreData(
    DocumentSnapshot doc,
    Map<String, dynamic> data, {
    Map<String, dynamic>? businessData,
  }) {
    final parent = doc.reference.parent.parent;
    final businessId =
        (data['businessId'] as String?) ??
        parent?.id ??
        BusinessProfile.defaultBusinessId;
    final business = businessData ?? const <String, dynamic>{};
    final businessName =
        (data['businessName'] as String?) ??
        (business['name'] as String?) ??
        BusinessProfile.defaultBusinessName;

    return BusinessDestinationOption(
      id: '${businessId}_${doc.id}',
      businessId: businessId,
      businessName: businessName,
      businessPhone:
          data['businessPhone'] as String? ?? business['phone'] as String?,
      businessEmail:
          data['businessEmail'] as String? ?? business['email'] as String?,
      businessWebsite:
          data['businessWebsite'] as String? ?? business['website'] as String?,
      businessProfileImageUrl:
          data['businessProfileImageUrl'] as String? ??
          business['profileImageUrl'] as String?,
      enabledServices: normalizeBusinessServices(
        businessData == null
            ? data['enabledServices']
            : business['enabledServices'],
      ),
      serviceNote:
          data['serviceNote'] as String? ?? business['serviceNote'] as String?,
      businessStatus:
          (businessData == null
                  ? data['businessStatus']
                  : business['status'] ?? data['businessStatus'] ?? 'pending')
              as String,
      country: DestinationCountry(
        id: doc.id,
        name: (data['name'] ?? doc.id) as String,
        code: data['code'] as String?,
        isActive: data['isActive'] == true,
        sortOrder: (data['sortOrder'] as num?)?.toInt() ?? 0,
        barrelShippingPrice:
            (data['barrelShippingPrice'] as num?)?.toDouble() ?? 0,
        deliveryEstimateMinDays: (data['deliveryEstimateMinDays'] as num?)
            ?.toInt(),
        deliveryEstimateMaxDays: (data['deliveryEstimateMaxDays'] as num?)
            ?.toInt(),
        destinationNote: data['destinationNote'] as String?,
      ),
    );
  }

  factory BusinessDestinationOption.fromLegacyCountry(
    DestinationCountry country,
  ) {
    return BusinessDestinationOption(
      id: '${BusinessProfile.defaultBusinessId}_${country.id}',
      businessId: BusinessProfile.defaultBusinessId,
      businessName: BusinessProfile.defaultBusinessName,
      country: country,
      businessStatus: 'approved',
    );
  }
}
