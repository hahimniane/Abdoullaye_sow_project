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

/// One part of a package split across containers, on the public page:
/// its own code and stage, how many pieces and its price (cents, null when
/// not priced). Nothing about the people.
class GuestTrackingPart {
  const GuestTrackingPart({
    required this.trackingCode,
    required this.stage,
    required this.pieceCount,
    this.priceCents,
  });

  final String trackingCode;
  final GuestTrackingStage stage;
  final int pieceCount;
  final int? priceCents;
}

/// What the whole package costs, what was paid and what is still owed
/// (cents). Payments live on the first line of the package.
class GuestTrackingPayment {
  const GuestTrackingPayment({
    this.priceCents,
    this.paidCents = 0,
    this.balanceCents = 0,
  });

  final int? priceCents;
  final int paidCents;
  final int balanceCents;

  bool get isPriced => priceCents != null;
}

int _wholeCents(Object? value) =>
    value is num && value.isFinite && value > 0 ? value.round() : 0;

int? _priceOrNull(Object? value) =>
    value is num && value.isFinite && value > 0 ? value.round() : null;

class GuestTrackingRecord {
  const GuestTrackingRecord({
    required this.trackingCode,
    required this.service,
    required this.stage,
    this.updatedAt,
    this.quoteCount = 0,
    this.shipping,
    this.pieceCount = 0,
    this.parts = const [],
    this.payment,
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

  /// Container lines: how many pieces this code covers.
  final int pieceCount;

  /// Container lines: every part of the package (at least the line itself),
  /// in part order; more than one when it was split across containers.
  final List<GuestTrackingPart> parts;

  /// Container lines: the whole package's price, paid and balance.
  final GuestTrackingPayment? payment;

  /// Some of the package travels under another code.
  bool get isSplit => parts.length > 1;

  factory GuestTrackingRecord.fromMap(Map<String, dynamic> data) {
    final trackingCode = data['trackingCode'];
    if (trackingCode is! String || trackingCode.trim().isEmpty) {
      throw const FormatException('Missing tracking code');
    }

    final rawCount = data['quoteCount'];
    final service = _serviceFromWire(data['service']);
    final container = service == GuestTrackingServiceType.container;
    final rawParts = data['parts'];
    final rawPayment = data['payment'];
    return GuestTrackingRecord(
      pieceCount: container ? _wholeCents(data['pieceCount']) : 0,
      // Read defensively: a part with no code or an unknown stage is left
      // out rather than failing the whole answer.
      parts: [
        if (container && rawParts is List)
          for (final part in rawParts)
            if (part is Map &&
                part['trackingCode'] is String &&
                (part['trackingCode'] as String).trim().isNotEmpty &&
                _stageOrNull(part['stage']) != null)
              GuestTrackingPart(
                trackingCode: (part['trackingCode'] as String).trim(),
                stage: _stageOrNull(part['stage'])!,
                pieceCount: _wholeCents(part['pieceCount']),
                priceCents: _priceOrNull(part['priceCents']),
              ),
      ],
      payment: container && rawPayment is Map
          ? GuestTrackingPayment(
              priceCents: _priceOrNull(rawPayment['priceCents']),
              paidCents: _wholeCents(rawPayment['paidCents']),
              balanceCents: _wholeCents(rawPayment['balanceCents']),
            )
          : null,
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

GuestTrackingStage? _stageOrNull(Object? value) {
  try {
    return _stageFromWire(value);
  } on FormatException {
    return null;
  }
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
