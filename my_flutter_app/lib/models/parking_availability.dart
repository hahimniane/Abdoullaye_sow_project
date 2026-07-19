import 'package:cloud_firestore/cloud_firestore.dart';

import 'business_profile.dart';

const activeParkingReservationStatuses = <String>{
  'requested',
  'reserved',
  'vehicle_received',
  'parked',
  'scheduled_for_transport',
  'active',
};

class ParkingDateRange {
  const ParkingDateRange({required this.start, required this.end});

  final DateTime start;
  final DateTime end;

  bool get isValid => !end.isBefore(start);

  int get billableDays {
    final hours = end.difference(start).inHours;
    return (hours <= 0 ? 1 : (hours / 24).ceil()).clamp(1, 10000);
  }

  bool overlaps(ParkingDateRange other) {
    return !end.isBefore(other.start) && !start.isAfter(other.end);
  }
}

class ParkingPricing {
  const ParkingPricing({
    required this.dailyRate,
    this.weeklyRate = 0,
    this.monthlyRate = 0,
    this.pickupFee = 0,
  });

  final double dailyRate;
  final double weeklyRate;
  final double monthlyRate;
  final double pickupFee;

  double estimate(ParkingDateRange range, {bool pickupRequested = false}) {
    var days = range.billableDays;
    var total = 0.0;
    if (monthlyRate > 0) {
      final months = days ~/ 30;
      total += months * monthlyRate;
      days -= months * 30;
    }
    if (weeklyRate > 0) {
      final weeks = days ~/ 7;
      total += weeks * weeklyRate;
      days -= weeks * 7;
    }
    total += days * dailyRate;
    if (pickupRequested) total += pickupFee;
    return double.parse(total.toStringAsFixed(2));
  }
}

class ParkingReservationWindow {
  const ParkingReservationWindow({
    required this.businessId,
    required this.range,
    required this.status,
  });

  final String businessId;
  final ParkingDateRange range;
  final String status;

  bool get countsAgainstCapacity =>
      activeParkingReservationStatuses.contains(status);
}

int availableParkingSpots({
  required int totalSpaces,
  required int blockedSpaces,
  required ParkingDateRange requestedRange,
  required Iterable<ParkingReservationWindow> reservations,
}) {
  if (totalSpaces <= 0) return 0;
  final overlapping = reservations.where(
    (reservation) =>
        reservation.countsAgainstCapacity &&
        reservation.range.overlaps(requestedRange),
  );
  final available = totalSpaces - blockedSpaces - overlapping.length;
  return available < 0 ? 0 : available;
}

class ParkingBusinessOption {
  const ParkingBusinessOption({
    required this.businessId,
    required this.businessName,
    required this.city,
    required this.address,
    required this.totalSpaces,
    required this.blockedSpaces,
    required this.availableSpaces,
    required this.pricing,
    required this.estimatedTotal,
    required this.minimumDays,
    required this.pickupAvailable,
    required this.instructions,
    this.phone,
    this.email,
    this.distanceMiles,
  });

  final String businessId;
  final String businessName;
  final String city;
  final String address;
  final int totalSpaces;
  final int blockedSpaces;
  final int availableSpaces;
  final ParkingPricing pricing;
  final double estimatedTotal;
  final int minimumDays;
  final bool pickupAvailable;
  final String instructions;
  final String? phone;
  final String? email;
  final double? distanceMiles;

  bool get hasAvailability => availableSpaces > 0;

  factory ParkingBusinessOption.fromFunctionData(Map<String, dynamic> data) {
    final pricing = ParkingPricing(
      dailyRate: _double(data['dailyRate']),
      weeklyRate: _double(data['weeklyRate']),
      monthlyRate: _double(data['monthlyRate']),
      pickupFee: _double(data['pickupFee']),
    );
    return ParkingBusinessOption(
      businessId: _string(data['businessId']),
      businessName: _string(
        data['businessName'],
        BusinessProfile.defaultBusinessName,
      ),
      city: _string(data['city']),
      address: _string(data['address']),
      totalSpaces: _int(data['totalSpaces']),
      blockedSpaces: _int(data['blockedSpaces']),
      availableSpaces: _int(data['availableSpaces']),
      pricing: pricing,
      estimatedTotal: _double(data['estimatedTotal']),
      minimumDays: _int(data['minimumDays'], 1),
      pickupAvailable: data['pickupAvailable'] == true,
      instructions: _string(data['instructions']),
      phone: _nullableString(data['phone']),
      email: _nullableString(data['email']),
      distanceMiles: data['distanceMiles'] == null
          ? null
          : _double(data['distanceMiles']),
    );
  }

  Map<String, dynamic> toFunctionData() {
    return {
      'businessId': businessId,
      'businessName': businessName,
      'city': city,
      'address': address,
      'totalSpaces': totalSpaces,
      'blockedSpaces': blockedSpaces,
      'availableSpaces': availableSpaces,
      'dailyRate': pricing.dailyRate,
      'weeklyRate': pricing.weeklyRate,
      'monthlyRate': pricing.monthlyRate,
      'pickupFee': pricing.pickupFee,
      'estimatedTotal': estimatedTotal,
      'minimumDays': minimumDays,
      'pickupAvailable': pickupAvailable,
      'instructions': instructions,
      'phone': phone,
      'email': email,
      'distanceMiles': distanceMiles,
    };
  }
}

ParkingReservationWindow parkingWindowFromFirestore(
  DocumentSnapshot<Map<String, dynamic>> doc,
) {
  final data = doc.data() ?? const <String, dynamic>{};
  final start = _timestampDate(data['parkingDate']) ?? DateTime.now();
  final end = _timestampDate(data['parkingEndDate']) ?? start;
  return ParkingReservationWindow(
    businessId: _string(data['businessId']),
    range: ParkingDateRange(start: start, end: end),
    status: _string(data['status'], 'reserved'),
  );
}

DateTime? _timestampDate(dynamic value) {
  if (value is Timestamp) return value.toDate();
  if (value is String) return DateTime.tryParse(value);
  return null;
}

String _string(dynamic value, [String fallback = '']) {
  if (value is String && value.trim().isNotEmpty) return value.trim();
  return fallback;
}

String? _nullableString(dynamic value) {
  final text = _string(value);
  return text.isEmpty ? null : text;
}

double _double(dynamic value, [double fallback = 0]) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value) ?? fallback;
  return fallback;
}

int _int(dynamic value, [int fallback = 0]) {
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value) ?? fallback;
  return fallback;
}
