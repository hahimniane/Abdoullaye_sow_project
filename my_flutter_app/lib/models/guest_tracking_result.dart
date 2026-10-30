import '../services/phone_accounts.dart' show TrackingSignInHint;

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
    this.pickupFeeCents = 0,
    this.paidCents = 0,
    this.balanceCents = 0,
  });

  final int? priceCents;

  /// A collected package's pickup fee, inside [priceCents]: its own row on
  /// the page (0 for none; an older server sends none).
  final int pickupFeeCents;
  final int paidCents;
  final int balanceCents;

  bool get isPriced => priceCents != null;
}

/// A parked car's money on its Track page (docs/PARKING_WHATSAPP.md §2):
/// what the stay has run up to today, what was paid and what is owed right
/// now. Worked out by the server (`parkingBalanceNow`); cents throughout.
class GuestTrackingParking {
  const GuestTrackingParking({
    this.dailyRateCents = 0,
    this.sinceDayKey = '',
    this.leftDayKey = '',
    this.days = 0,
    this.accruedCents = 0,
    this.paidCents = 0,
    this.balanceCents = 0,
    this.paidInFull = false,
    this.stillParked = true,
  });

  final int dailyRateCents;

  /// "YYYY-MM-DD"; '' when unknown.
  final String sinceDayKey;

  /// "YYYY-MM-DD" the car left; '' while it is still parked.
  final String leftDayKey;
  final int days;
  final int accruedCents;
  final int paidCents;
  final int balanceCents;
  final bool paidInFull;
  final bool stillParked;

  /// Null for anything that is not a map (an older server sends none).
  static GuestTrackingParking? fromWire(Object? value) {
    if (value is! Map) return null;
    String day(Object? v) {
      final text = v is String ? v.trim() : '';
      return RegExp(r'^\d{4}-\d{2}-\d{2}').hasMatch(text)
          ? text.substring(0, 10)
          : '';
    }

    final leftDayKey = day(value['leftDayKey']);
    return GuestTrackingParking(
      dailyRateCents: _wholeCents(value['dailyRateCents']),
      sinceDayKey: day(value['sinceDayKey']),
      leftDayKey: leftDayKey,
      days: _wholeCents(value['days']),
      accruedCents: _wholeCents(value['accruedCents']),
      paidCents: _wholeCents(value['paidCents']),
      balanceCents: _wholeCents(value['balanceCents']),
      paidInFull: value['paidInFull'] == true,
      stillParked: value['stillParked'] is bool
          ? value['stillParked'] as bool
          : leftDayKey.isEmpty,
    );
  }
}

int _wholeCents(Object? value) =>
    value is num && value.isFinite && value > 0 ? value.round() : 0;

/// A pickup fee never reads larger than the price it is inside.
int _feeWithin(Object? value, int? priceCents) {
  final fee = _wholeCents(value);
  if (priceCents == null) return 0;
  return fee > priceCents ? priceCents : fee;
}

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
    this.parking,
    this.signIn = const [],
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

  /// Parked cars: the stay's money - rate, days, paid and balance owed now.
  /// Null for any other service, or from an older server.
  final GuestTrackingParking? parking;

  /// Who may sign in from this page (docs/PHONE_ACCOUNTS.md §10): a role
  /// and the last two digits of each valid number on the record - never
  /// more. Empty on an older server or a record with no valid number.
  final List<TrackingSignInHint> signIn;

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
              pickupFeeCents: _feeWithin(
                rawPayment['pickupFeeCents'],
                _priceOrNull(rawPayment['priceCents']),
              ),
              paidCents: _wholeCents(rawPayment['paidCents']),
              balanceCents: _wholeCents(rawPayment['balanceCents']),
            )
          : null,
      parking: service == GuestTrackingServiceType.parking
          ? GuestTrackingParking.fromWire(data['parking'])
          : null,
      trackingCode: trackingCode.trim(),
      service: service,
      shipping: GuestContainerShipping.fromWire(service, data['shipping']),
      stage: _stageFromWire(data['stage']),
      updatedAt: _dateFromMilliseconds(data['updatedAtMs']),
      quoteCount: rawCount is num && rawCount.isFinite && rawCount > 0
          ? rawCount.truncate()
          : 0,
      signIn: TrackingSignInHint.listFrom(data['signIn']),
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

/// The service a wire word names, or null for one this app does not know
/// (My packages also lists package requests, which are not a guest-tracking
/// service).
GuestTrackingServiceType? guestTrackingServiceOrNull(Object? value) {
  try {
    return _serviceFromWire(value);
  } on FormatException {
    return null;
  }
}

/// The stage a wire word names, or null for one this app does not know.
GuestTrackingStage? guestTrackingStageOrNull(Object? value) =>
    _stageOrNull(value);

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
