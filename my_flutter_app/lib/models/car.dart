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
    return Car(
      id: doc.id,
      title: (data['title'] ?? '') as String,
      make: (data['make'] ?? '') as String,
      model: (data['model'] ?? '') as String,
      year: (data['year'] ?? '') as String,
      mileage: (data['mileage'] ?? '') as String,
      price: _parseDouble(data['price']),
      description: (data['description'] ?? '') as String,
      features: _stringList(data['features']),
      imageUrls: _stringList(data['imageUrls']),
      status: (data['status'] ?? 'active') as String,
      contactPhone:
          (data['contactPhone'] ?? data['sellerPhone'] ?? '') as String,
      contactName: data['contactName'] as String?,
      contactEmail: data['contactEmail'] as String?,
      condition: (data['condition'] ?? '') as String,
      bodyType: (data['bodyType'] ?? '') as String,
      transmission: (data['transmission'] ?? '') as String,
      fuelType: (data['fuelType'] ?? '') as String,
      drivetrain: (data['drivetrain'] ?? '') as String,
      exteriorColor: (data['exteriorColor'] ?? '') as String,
      interiorColor: (data['interiorColor'] ?? '') as String,
      vin: (data['vin'] ?? '') as String,
      stockNumber: (data['stockNumber'] ?? '') as String,
      isRebuiltTitle: data['isRebuiltTitle'] is bool
          ? data['isRebuiltTitle'] as bool
          : null,
      isNegotiable: data['isNegotiable'] == true,
      financingNote: (data['financingNote'] ?? '') as String,
      locationCity: (data['locationCity'] ?? '') as String,
      locationState: (data['locationState'] ?? '') as String,
      locationAddressLine1: (data['locationAddressLine1'] ?? '') as String,
      locationPostalCode: (data['locationPostalCode'] ?? '') as String,
      structuredFeatures: _stringList(data['structuredFeatures']),
      businessId: (data['businessId'] ?? 'keren_auto_sales') as String,
      businessName: (data['businessName'] ?? 'Keren') as String,
      businessStatus: (data['businessStatus'] ?? 'approved') as String,
      businessProfileImageUrl: data['businessProfileImageUrl'] as String?,
      enabledServices: normalizeBusinessServices(data['enabledServices']),
      createdAt: _toDateTime(data['createdAt']),
      updatedAt: _toDateTime(data['updatedAt']),
      soldInfo: CarSaleInfo.fromMap(
        data['soldInfo'] is Map<String, dynamic>
            ? data['soldInfo'] as Map<String, dynamic>
            : null,
      ),
      useBusinessHoldPricing: data['useBusinessHoldPricing'] != false,
      carHoldPricingMode: (data['carHoldPricingMode'] ?? '') as String,
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
