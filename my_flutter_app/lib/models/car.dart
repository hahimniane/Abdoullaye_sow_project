import 'package:cloud_firestore/cloud_firestore.dart';

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
    this.createdAt,
    this.updatedAt,
    this.soldInfo,
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
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final CarSaleInfo? soldInfo;

  bool get isSold => status.toLowerCase() == 'sold';

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
      createdAt: _toDateTime(data['createdAt']),
      updatedAt: _toDateTime(data['updatedAt']),
      soldInfo: CarSaleInfo.fromMap(
        data['soldInfo'] is Map<String, dynamic>
            ? data['soldInfo'] as Map<String, dynamic>
            : null,
      ),
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

