enum GuestTrackingServiceType {
  barrel,
  freight,
  transport,
  parking,
  sharedBarrel,
  freightQuote,

  /// Goods a business loaded into its own container for a customer (a
  /// "CL-" code). Stages follow the box: booked, in transit, arrived.
  container,
}

enum GuestTrackingStage {
  awaitingPayment,

  /// A container line dropped off before any container is chosen: received,
  /// nothing booked onto a box yet (`waiting_container` on the wire).
  waitingContainer,
  booked,
  inTransit,
  arrived,
  delivered,
  cancelled,
}

/// A sailed container's details as the shipping line calls them, on a
/// container line's public answer (functions/guest_tracking.js
/// `publicContainerShipping`). Each field is '' when not known; the box's
/// details, never the person's.
class GuestContainerShipping {
  const GuestContainerShipping({
    this.shippingLine = '',
    this.containerNumber = '',
    this.bookingNumber = '',
  });

  final String shippingLine;
  final String containerNumber;
  final String bookingNumber;

  /// Null for any other service, or when nothing is known.
  static GuestContainerShipping? fromWire(
    GuestTrackingServiceType service,
    Object? value,
  ) {
    if (service != GuestTrackingServiceType.container || value is! Map) {
      return null;
    }
    String read(String key) {
      final raw = value[key];
      if (raw is! String) return '';
      final text = raw.trim();
      return text.length > 60 ? text.substring(0, 60) : text;
    }

    final shipping = GuestContainerShipping(
      shippingLine: read('shippingLine'),
      containerNumber: read('containerNumber'),
      bookingNumber: read('bookingNumber'),
    );
    return shipping.shippingLine.isEmpty &&
            shipping.containerNumber.isEmpty &&
            shipping.bookingNumber.isEmpty
        ? null
        : shipping;
  }
}

class GuestTrackingRecord {
  const GuestTrackingRecord({
    required this.trackingCode,
    required this.service,
    required this.stage,
    this.updatedAt,
    this.quoteCount = 0,
    this.shipping,
  });

  final String trackingCode;
  final GuestTrackingServiceType service;
  final GuestTrackingStage stage;
  final DateTime? updatedAt;

  /// Price requests only: how many businesses have answered. A count is
  /// public; a price never is - seeing prices takes the claim step.
  final int quoteCount;

  /// Container lines only, once the box has sailed.
  final GuestContainerShipping? shipping;

  factory GuestTrackingRecord.fromMap(Map<String, dynamic> data) {
    final trackingCode = data['trackingCode'];
    if (trackingCode is! String || trackingCode.trim().isEmpty) {
      throw const FormatException('Missing tracking code');
    }

    final rawCount = data['quoteCount'];
    final service = _serviceFromWire(data['service']);
    return GuestTrackingRecord(
      trackingCode: trackingCode.trim(),
      service: service,
      shipping: GuestContainerShipping.fromWire(service, data['shipping']),
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
    'container' => GuestTrackingServiceType.container,
    _ => throw const FormatException('Unsupported guest tracking service'),
  };
}

GuestTrackingStage _stageFromWire(Object? value) {
  return switch (value) {
    'awaiting_payment' => GuestTrackingStage.awaitingPayment,
    'waiting_container' => GuestTrackingStage.waitingContainer,
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
