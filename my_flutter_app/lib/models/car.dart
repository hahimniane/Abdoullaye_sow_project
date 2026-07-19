import 'package:cloud_firestore/cloud_firestore.dart';

import 'business_service.dart';

class Car {
  Car({
    required this.id,
    required this.title,
    required this.make,
    required this.model,
    required this.year,
    required this.mileage,
    required this.price,
    required this.description,
    required this.features,
    required this.imageUrls,
    required this.status,
    required this.contactPhone,
    this.contactName,
    this.contactEmail,
    this.condition = '',
    this.bodyType = '',
    this.transmission = '',
    this.fuelType = '',
    this.drivetrain = '',
    this.exteriorColor = '',
    this.interiorColor = '',
    this.vin = '',
    this.stockNumber = '',
    this.isRebuiltTitle,
    this.isNegotiable = false,
    this.financingNote = '',
    this.locationCity = '',
    this.locationState = '',
    this.locationAddressLine1 = '',
    this.locationPostalCode = '',
    this.structuredFeatures = const <String>[],
    this.businessId = 'keren_auto_sales',
    this.businessName = 'Keren',
    this.businessStatus = 'approved',
    this.businessProfileImageUrl,
    this.enabledServices = defaultBusinessServiceValues,
    this.createdAt,
    this.updatedAt,
    this.soldInfo,
    this.useBusinessHoldPricing = true,
    this.carHoldPricingMode = '',
    this.carHoldFlatFee,
    this.carHoldDailyRate,
    this.carHoldMaxDays,
  });

  final String id;
  final String title;
  final String make;
  final String model;
  final String year;
  final String mileage;
  final double price;
  final String description;
  final List<String> features;
  final List<String> imageUrls;
  final String status;
  final String contactPhone;
  final String? contactName;
  final String? contactEmail;
  final String condition;
  final String bodyType;
  final String transmission;
  final String fuelType;
  final String drivetrain;
  final String exteriorColor;
  final String interiorColor;
  final String vin;
  final String stockNumber;
  final bool? isRebuiltTitle;
  final bool isNegotiable;
  final String financingNote;
  final String locationCity;
  final String locationState;
  final String locationAddressLine1;
  final String locationPostalCode;
  final List<String> structuredFeatures;
  final String businessId;
  final String businessName;
  final String businessStatus;
  final String? businessProfileImageUrl;
  final List<String> enabledServices;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final CarSaleInfo? soldInfo;
  final bool useBusinessHoldPricing;
  final String carHoldPricingMode;
  final double? carHoldFlatFee;
  final double? carHoldDailyRate;
  final int? carHoldMaxDays;

  bool get isSold => status.toLowerCase() == 'sold';
  bool get isReserved => status.toLowerCase() == 'reserved';

  factory Car.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? <String, dynamic>{};
    return Car.fromMap(doc.id, data);
  }

  factory Car.fromMap(String id, Map<String, dynamic> data) {
    return Car(
      id: id,
      title: _parseString(data['title']),
      make: _parseString(data['make']),
      model: _parseString(data['model']),
      year: _parseString(data['year']),
      mileage: _parseString(data['mileage']),
      price: _parseDouble(data['price']),
      description: _parseString(data['description']),
      features: _stringList(data['features']),
      imageUrls: _stringList(data['imageUrls']),
      status: _parseString(data['status'], fallback: 'active'),
      contactPhone: _parseString(
        data['contactPhone'] ?? data['sellerPhone'],
      ),
      contactName: _parseNullableString(data['contactName']),
      contactEmail: _parseNullableString(data['contactEmail']),
      condition: _parseString(data['condition']),
      bodyType: _parseString(data['bodyType']),
      transmission: _parseString(data['transmission']),
      fuelType: _parseString(data['fuelType']),
      drivetrain: _parseString(data['drivetrain']),
      exteriorColor: _parseString(data['exteriorColor']),
      interiorColor: _parseString(data['interiorColor']),
      vin: _parseString(data['vin']),
      stockNumber: _parseString(data['stockNumber']),
      isRebuiltTitle: data['isRebuiltTitle'] is bool
          ? data['isRebuiltTitle'] as bool
          : null,
      isNegotiable: data['isNegotiable'] == true,
      financingNote: _parseString(data['financingNote']),
      locationCity: _parseString(data['locationCity']),
      locationState: _parseString(data['locationState']),
      locationAddressLine1: _parseString(data['locationAddressLine1']),
      locationPostalCode: _parseString(data['locationPostalCode']),
      structuredFeatures: _stringList(data['structuredFeatures']),
      businessId: _parseString(
        data['businessId'],
        fallback: 'keren_auto_sales',
      ),
      businessName: _parseString(data['businessName'], fallback: 'Keren'),
      businessStatus: _parseString(
        data['businessStatus'],
        fallback: 'approved',
      ),
      businessProfileImageUrl: _parseNullableString(
        data['businessProfileImageUrl'],
      ),
      enabledServices: normalizeBusinessServices(data['enabledServices']),
      createdAt: _toDateTime(data['createdAt']),
      updatedAt: _toDateTime(data['updatedAt']),
      soldInfo: CarSaleInfo.fromMap(
        data['soldInfo'] is Map<String, dynamic>
            ? data['soldInfo'] as Map<String, dynamic>
            : null,
      ),
      useBusinessHoldPricing: data['useBusinessHoldPricing'] != false,
      carHoldPricingMode: _parseString(data['carHoldPricingMode']),
      carHoldFlatFee: data['carHoldFlatFee'] == null
          ? null
          : _parseDouble(data['carHoldFlatFee']),
      carHoldDailyRate: data['carHoldDailyRate'] == null
          ? null
          : _parseDouble(data['carHoldDailyRate']),
      carHoldMaxDays: data['carHoldMaxDays'] is num
          ? (data['carHoldMaxDays'] as num).toInt()
          : int.tryParse('${data['carHoldMaxDays'] ?? ''}'),
    );
  }

  static String _parseString(dynamic value, {String fallback = ''}) {
    if (value == null) return fallback;
    return value.toString();
  }

  static String? _parseNullableString(dynamic value) {
    if (value == null) return null;
    final parsed = value.toString();
    return parsed.isEmpty ? null : parsed;
  }

  static double _parseDouble(dynamic value) {
    if (value == null) {
      return 0;
    }
    if (value is num) {
      return value.toDouble();
    }
    if (value is String) {
      return double.tryParse(value) ?? 0;
    }
    return 0;
  }

  static List<String> _stringList(dynamic raw) {
    if (raw is Iterable) {
      return raw.map((e) => e.toString()).where((e) => e.isNotEmpty).toList();
    }
    return <String>[];
  }

  static DateTime? _toDateTime(dynamic value) {
    if (value is Timestamp) {
      return value.toDate();
    }
    if (value is DateTime) {
      return value;
    }
    return null;
  }

  int? get yearNumber => int.tryParse(year);

  int? get mileageNumber {
    final digits = mileage.replaceAll(RegExp(r'[^0-9]'), '');
    if (digits.isEmpty) return null;
    return int.tryParse(digits);
  }

  String get locationLabel {
    final parts = [
      locationAddressLine1.trim(),
      locationCity.trim(),
      locationState.trim(),
      locationPostalCode.trim(),
    ].where((part) => part.isNotEmpty).toList();
    return parts.join(', ');
  }

  List<String> get allFeatures {
    final values = <String>{};
    values.addAll(structuredFeatures.where((item) => item.trim().isNotEmpty));
    values.addAll(features.where((item) => item.trim().isNotEmpty));
    return values.toList();
  }
}

class CarSaleInfo {
  CarSaleInfo({
    required this.customerName,
    required this.customerPhone,
    this.customerEmail,
    this.customerAddress,
    this.amount,
    this.soldDate,
    this.notes,
  });

  final String customerName;
  final String customerPhone;
  final String? customerEmail;
  final String? customerAddress;
  final double? amount;
  final DateTime? soldDate;
  final String? notes;

  bool get hasData =>
      customerName.isNotEmpty ||
      customerPhone.isNotEmpty ||
      (customerEmail != null && customerEmail!.isNotEmpty) ||
      (customerAddress != null && customerAddress!.isNotEmpty) ||
      amount != null ||
      soldDate != null ||
      (notes != null && notes!.isNotEmpty);

  Map<String, dynamic> toMap() {
    final map = <String, dynamic>{
      'customerName': customerName,
      'customerPhone': customerPhone,
    };
    if (customerEmail != null && customerEmail!.isNotEmpty) {
      map['customerEmail'] = customerEmail;
    }
    if (customerAddress != null && customerAddress!.isNotEmpty) {
      map['customerAddress'] = customerAddress;
    }
    if (amount != null) {
      map['amount'] = amount;
    }
    if (soldDate != null) {
      map['soldDate'] = Timestamp.fromDate(soldDate!);
    }
    if (notes != null && notes!.isNotEmpty) {
      map['notes'] = notes;
    }
    return map;
  }

  static CarSaleInfo? fromMap(Map<String, dynamic>? map) {
    if (map == null || map.isEmpty) {
      return null;
    }
    return CarSaleInfo(
      customerName: (map['customerName'] ?? '') as String,
      customerPhone: (map['customerPhone'] ?? '') as String,
      customerEmail: map['customerEmail'] as String?,
      customerAddress: map['customerAddress'] as String?,
      amount: Car._parseDouble(map['amount']),
      soldDate: Car._toDateTime(map['soldDate']),
      notes: map['notes'] as String?,
    );
  }
}
