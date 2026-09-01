enum GuestTrackingServiceType {
  barrel,
  freight,
  transport,
  parking,
  sharedBarrel,
  freightQuote,
}

enum GuestTrackingStage {
  awaitingPayment,
  booked,
  inTransit,
  arrived,
  delivered,
  cancelled,
}

class GuestTrackingRecord {
  const GuestTrackingRecord({
    required this.trackingCode,
    required this.service,
    required this.stage,
    this.updatedAt,
    this.quoteCount = 0,
  });

  final String trackingCode;
  final GuestTrackingServiceType service;
  final GuestTrackingStage stage;
  final DateTime? updatedAt;

  /// Price requests only: how many businesses have answered. A count is
  /// public; a price never is - seeing prices takes the claim step.
  final int quoteCount;

  factory GuestTrackingRecord.fromMap(Map<String, dynamic> data) {
    final trackingCode = data['trackingCode'];
    if (trackingCode is! String || trackingCode.trim().isEmpty) {
      throw const FormatException('Missing tracking code');
    }

    final rawCount = data['quoteCount'];
    return GuestTrackingRecord(
      trackingCode: trackingCode.trim(),
      service: _serviceFromWire(data['service']),
      stage: _stageFromWire(data['stage']),
      updatedAt: _dateFromMilliseconds(data['updatedAtMs']),
      quoteCount: rawCount is num && rawCount.isFinite && rawCount > 0
          ? rawCount.truncate()
          : 0,
    );
  }
}

class GuestTrackingResult {
  const GuestTrackingResult.notFound() : found = false, record = null;

  const GuestTrackingResult.found(this.record) : found = true;

  final bool found;
  final GuestTrackingRecord? record;

  factory GuestTrackingResult.fromMap(Map<String, dynamic> data) {
    if (data['version'] != 1) {
      throw const FormatException('Unsupported guest tracking response');
    }
    if (data['found'] != true) return const GuestTrackingResult.notFound();

    final rawRecord = data['record'];
    if (rawRecord is! Map) {
      throw const FormatException('Missing guest tracking record');
    }
    return GuestTrackingResult.found(
      GuestTrackingRecord.fromMap(Map<String, dynamic>.from(rawRecord)),
    );
  }
}

GuestTrackingServiceType _serviceFromWire(Object? value) {
  return switch (value) {
    'barrel' => GuestTrackingServiceType.barrel,
    'freight' => GuestTrackingServiceType.freight,
    'transport' => GuestTrackingServiceType.transport,
    'parking' => GuestTrackingServiceType.parking,
    'shared_barrel' => GuestTrackingServiceType.sharedBarrel,
    'freight_quote' => GuestTrackingServiceType.freightQuote,
    _ => throw const FormatException('Unsupported guest tracking service'),
  };
}

GuestTrackingStage _stageFromWire(Object? value) {
  return switch (value) {
    'awaiting_payment' => GuestTrackingStage.awaitingPayment,
    'booked' => GuestTrackingStage.booked,
    'in_transit' => GuestTrackingStage.inTransit,
    'arrived' => GuestTrackingStage.arrived,
    'delivered' => GuestTrackingStage.delivered,
    'cancelled' => GuestTrackingStage.cancelled,
    _ => throw const FormatException('Unsupported guest tracking stage'),
  };
}

DateTime? _dateFromMilliseconds(Object? value) {
  if (value == null) return null;
  final milliseconds = value is num ? value.toInt() : null;
  if (milliseconds == null || milliseconds <= 0) return null;
  return DateTime.fromMillisecondsSinceEpoch(milliseconds);
}
