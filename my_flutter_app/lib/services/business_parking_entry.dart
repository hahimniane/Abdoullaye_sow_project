import 'package:cloud_functions/cloud_functions.dart';

/// Business-entered parking, app side (docs/PLAN-2026-08-backlog.md item 5).
///
/// A deliberate mirror of the server's pure module,
/// `functions/business_parking_entry.js`, and of the console's
/// `admin_web/src/lib/business-parking-entry.ts`. The callable is still the
/// authority; this exists so the form can refuse a bad entry before it costs
/// a round trip, and so both clients enforce the same window.
///
/// Everything above [BusinessParkingService] is pure: no Firebase, no widgets,
/// so `test/business_parking_entry_test.dart` drives it directly.

/// How the platform is (or is not) involved in collecting the money.
enum BusinessParkingPaymentMethod {
  /// The customer pays the lot directly. We record the amount and never bill
  /// it, take no cut, and create no Stripe object.
  direct,

  /// We bill the customer through a hosted Stripe Checkout page.
  paymentLink,
}

extension BusinessParkingPaymentMethodWire on BusinessParkingPaymentMethod {
  String get wireValue => switch (this) {
    BusinessParkingPaymentMethod.direct => 'direct',
    BusinessParkingPaymentMethod.paymentLink => 'payment_link',
  };
}

/// Everything the form can object to, in the server's own vocabulary so the
/// two never drift.
enum BusinessParkingEntryError {
  businessRequired,
  customerNameRequired,
  customerPhoneRequired,
  customerEmailInvalid,
  paymentLinkContactRequired,
  carMakeRequired,
  carModelRequired,
  carYearRequired,
  carYearInvalid,
  startDateRequired,
  endDateRequired,
  endDateBeforeStartDate,
}

/// How a business says it received an off-platform payment. Free text would
/// give us "Zelle", "zelle " and "ZELLE" as three ways a lot was paid, so the
/// server normalizes anything unrecognised to `other` - these are the values
/// it recognises.
const List<String> businessParkingReceivedViaValues = <String>[
  'zelle',
  'cash',
  'cashapp',
  'venmo',
  'check',
  'card_in_person',
  'other',
];

/// What a staff member typed in for a walk-up car.
class BusinessParkingEntryDraft {
  const BusinessParkingEntryDraft({
    required this.businessId,
    required this.customerName,
    required this.customerPhone,
    this.customerEmail = '',
    required this.carMake,
    required this.carModel,
    required this.carYear,
    this.vinNumber = '',
    this.startDate,
    this.endDate,
    this.paymentMethod = BusinessParkingPaymentMethod.direct,
  });

  final String businessId;
  final String customerName;
  final String customerPhone;
  final String customerEmail;
  final String carMake;
  final String carModel;
  final String carYear;
  final String vinNumber;
  final DateTime? startDate;
  final DateTime? endDate;
  final BusinessParkingPaymentMethod paymentMethod;
}

String _trimmed(Object? value, [int max = 200]) {
  final text = (value ?? '').toString().trim();
  return text.length <= max ? text : text.substring(0, max);
}

bool _isEmailish(String value) =>
    RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]{2,}$').hasMatch(value);

DateTime _dayOnly(DateTime value) =>
    DateTime(value.year, value.month, value.day);

/// Every problem at once, not just the first - a form that reveals its
/// objections one save at a time is how a walk-up gets left standing there.
List<BusinessParkingEntryError> validateBusinessParkingEntry(
  BusinessParkingEntryDraft draft,
) {
  final errors = <BusinessParkingEntryError>[];

  if (_trimmed(draft.businessId, 180).isEmpty) {
    errors.add(BusinessParkingEntryError.businessRequired);
  }
  if (_trimmed(draft.customerName).isEmpty) {
    errors.add(BusinessParkingEntryError.customerNameRequired);
  }

  final phone = _trimmed(draft.customerPhone, 40);
  if (phone.isEmpty) {
    errors.add(BusinessParkingEntryError.customerPhoneRequired);
  }

  final email = _trimmed(draft.customerEmail, 180).toLowerCase();
  if (email.isNotEmpty && !_isEmailish(email)) {
    errors.add(BusinessParkingEntryError.customerEmailInvalid);
  }
  // Email is optional - until the money has to reach someone. A payment link
  // nobody receives is a charge that never happens and a space that never
  // frees up.
  if (draft.paymentMethod == BusinessParkingPaymentMethod.paymentLink &&
      phone.isEmpty &&
      email.isEmpty) {
    errors.add(BusinessParkingEntryError.paymentLinkContactRequired);
  }

  if (_trimmed(draft.carMake, 80).isEmpty) {
    errors.add(BusinessParkingEntryError.carMakeRequired);
  }
  if (_trimmed(draft.carModel, 80).isEmpty) {
    errors.add(BusinessParkingEntryError.carModelRequired);
  }
  final year = _trimmed(draft.carYear, 8);
  final yearValue = int.tryParse(year);
  if (year.isEmpty) {
    errors.add(BusinessParkingEntryError.carYearRequired);
  } else if (!RegExp(r'^\d{4}$').hasMatch(year) ||
      yearValue == null ||
      yearValue < 1900 ||
      yearValue > 2100) {
    errors.add(BusinessParkingEntryError.carYearInvalid);
  }

  final start = draft.startDate;
  final end = draft.endDate;
  if (start == null) errors.add(BusinessParkingEntryError.startDateRequired);
  if (end == null) errors.add(BusinessParkingEntryError.endDateRequired);
  if (start != null && end != null && _dayOnly(end).isBefore(_dayOnly(start))) {
    errors.add(BusinessParkingEntryError.endDateBeforeStartDate);
  }

  return errors;
}

/// The exact payload `createBusinessParkingEntry` expects.
///
/// Dates go as a date plus a midday clock so a timezone west of UTC cannot
/// roll the parking window back a day on the server's `new Date(...)` - the
/// window is what the customer is charged for.
Map<String, dynamic> businessParkingEntryPayload(
  BusinessParkingEntryDraft draft,
) {
  String middayIso(DateTime? value) {
    if (value == null) return '';
    final day = _dayOnly(value);
    final month = day.month.toString().padLeft(2, '0');
    final date = day.day.toString().padLeft(2, '0');
    return '${day.year}-$month-${date}T12:00:00';
  }

  return <String, dynamic>{
    'businessId': _trimmed(draft.businessId, 180),
    'customerName': _trimmed(draft.customerName),
    'customerPhone': _trimmed(draft.customerPhone, 40),
    'customerEmail': _trimmed(draft.customerEmail, 180).toLowerCase(),
    'carMake': _trimmed(draft.carMake, 80),
    'carModel': _trimmed(draft.carModel, 80),
    'carYear': _trimmed(draft.carYear, 8),
    'vinNumber': _trimmed(draft.vinNumber, 17).toUpperCase(),
    'startDate': middayIso(draft.startDate),
    'endDate': middayIso(draft.endDate),
    'paymentMethod': draft.paymentMethod.wireValue,
  };
}

/// What the callable answers with.
class BusinessParkingEntryResult {
  const BusinessParkingEntryResult({
    required this.entryId,
    required this.trackingCode,
    required this.paymentMethod,
    required this.amountDue,
    required this.amountDueCents,
    required this.platformFeeCents,
    required this.paymentStatus,
    required this.checkoutUrl,
    required this.checkoutSessionId,
  });

  /// Reads the response defensively: a missing checkoutUrl on the payment-link
  /// path must surface as "no link" in the UI, never as a null rendered into a
  /// copy button.
  factory BusinessParkingEntryResult.fromCallable(Object? data) {
    final row = data is Map ? data : const <Object?, Object?>{};
    Object? at(String key) => row[key];
    final cents = (num.tryParse(_trimmed(at('amountDueCents'), 20)) ?? 0)
        .round()
        .clamp(0, 1 << 40);
    final dollars = num.tryParse(_trimmed(at('amountDue'), 20));
    return BusinessParkingEntryResult(
      entryId: _trimmed(at('entryId') ?? at('reservationId'), 180),
      trackingCode: _trimmed(at('trackingCode'), 60),
      paymentMethod: _trimmed(at('paymentMethod'), 40),
      amountDue: (dollars ?? cents / 100).toDouble(),
      amountDueCents: cents,
      platformFeeCents: (num.tryParse(_trimmed(at('platformFeeCents'), 20)) ?? 0)
          .round()
          .clamp(0, 1 << 40),
      paymentStatus: _trimmed(at('paymentStatus'), 40),
      checkoutUrl: _trimmed(at('checkoutUrl'), 2048),
      checkoutSessionId: _trimmed(at('checkoutSessionId'), 180),
    );
  }

  final String entryId;
  final String trackingCode;
  final String paymentMethod;
  final double amountDue;
  final int amountDueCents;
  final int platformFeeCents;
  final String paymentStatus;
  final String checkoutUrl;
  final String checkoutSessionId;

  bool get isPaymentLink => paymentMethod == 'payment_link';
}

/// The outcome of marking a direct payment received. `alreadyPaid` is a
/// success, not a failure - calling twice must not double-record a payment.
class BusinessParkingPaidResult {
  const BusinessParkingPaidResult({
    required this.alreadyPaid,
    required this.amountPaid,
    required this.trackingCode,
  });

  factory BusinessParkingPaidResult.fromCallable(Object? data) {
    final row = data is Map ? data : const <Object?, Object?>{};
    final cents = (num.tryParse(_trimmed(row['amountPaidCents'], 20)) ?? 0)
        .round()
        .clamp(0, 1 << 40);
    final dollars = num.tryParse(_trimmed(row['amountPaid'], 20));
    return BusinessParkingPaidResult(
      alreadyPaid: row['alreadyPaid'] == true,
      amountPaid: (dollars ?? cents / 100).toDouble(),
      trackingCode: _trimmed(row['trackingCode'], 60),
    );
  }

  final bool alreadyPaid;
  final double amountPaid;
  final String trackingCode;
}

/// Is this a walk-up the lot entered itself, rather than a customer booking?
bool isBusinessEnteredParking(Map<String, dynamic> row) =>
    _trimmed(row['source'], 40) == 'business' ||
    row['enteredByBusiness'] == true;

/// Whether "Mark payment received" applies. Mirrors the server's refusals so
/// the button is absent rather than present-and-rejected: a payment_link entry
/// is Stripe's to settle, and a paid entry must not invite a second marking.
bool canMarkBusinessParkingPaid(Map<String, dynamic> row) {
  if (!isBusinessEnteredParking(row)) return false;
  if (_trimmed(row['paymentMethod'], 40) != 'direct') return false;
  if (_trimmed(row['status'], 40) == 'cancelled') return false;
  return _trimmed(row['paymentStatus'], 40) == 'awaiting_direct_payment';
}

/// How a business-entered row's payment should read at a glance.
///
/// Mirrors the console's `businessParkingPaymentTone`, which returns
/// "paid" | "awaiting" | "none".
enum BusinessParkingPaymentTone {
  /// The money is in. Show a green badge.
  paid,

  /// The lot is still owed. Show an amber badge.
  awaiting,

  /// Nothing to say: a customer's own booking, a cancelled record, or an
  /// entry with nothing to collect. Show no badge at all rather than an
  /// "unpaid" one that would send staff chasing money nobody owes.
  none,
}

/// Paid, still owed, or nothing to show - the whole badge decision, with no
/// widgets in it so `test/business_parking_payment_tone_test.dart` can drive
/// every branch directly.
///
/// A cancelled record is [BusinessParkingPaymentTone.none] whatever its
/// payment status: the space was released, so neither "paid" nor "not paid"
/// is an instruction to anyone.
BusinessParkingPaymentTone businessParkingPaymentTone(
  Map<String, dynamic> row,
) {
  if (!isBusinessEnteredParking(row)) return BusinessParkingPaymentTone.none;
  if (_trimmed(row['status'], 40).toLowerCase() == 'cancelled') {
    return BusinessParkingPaymentTone.none;
  }
  final paymentStatus = _trimmed(row['paymentStatus'], 40).toLowerCase();
  if (paymentStatus == 'succeeded' || paymentStatus == 'paid') {
    return BusinessParkingPaymentTone.paid;
  }
  if (paymentStatus == 'not_required') return BusinessParkingPaymentTone.none;
  return BusinessParkingPaymentTone.awaiting;
}

/// What a business-entered row recorded, in dollars. A direct entry is
/// recorded and never billed, so this is what the lot is owed - not what the
/// platform collected.
double businessParkingAmountDue(Map<String, dynamic> row) {
  final cents = num.tryParse(_trimmed(row['amountDueCents'] ?? row['totalCostCents'], 20));
  if (cents != null && cents > 0) return cents.round() / 100;
  final dollars = num.tryParse(_trimmed(row['amountDue'] ?? row['totalCost'], 20));
  return (dollars ?? 0).toDouble();
}

/// The two callables, behind an injectable [FirebaseFunctions] so widget tests
/// can drive the screens without a network - the same shape
/// `FirebaseParkingService` already uses.
class BusinessParkingService {
  BusinessParkingService({FirebaseFunctions? functions})
    : _functions = functions ?? FirebaseFunctions.instance;

  final FirebaseFunctions _functions;

  Future<BusinessParkingEntryResult> createEntry(
    BusinessParkingEntryDraft draft,
  ) async {
    final response = await _functions
        .httpsCallable('createBusinessParkingEntry')
        .call<Object?>(businessParkingEntryPayload(draft));
    return BusinessParkingEntryResult.fromCallable(response.data);
  }

  Future<BusinessParkingPaidResult> markPaid({
    required String entryId,
    required String receivedVia,
  }) async {
    final response = await _functions
        .httpsCallable('markBusinessParkingPaid')
        .call<Object?>(<String, dynamic>{
          'entryId': entryId,
          'receivedVia': businessParkingReceivedViaValues.contains(receivedVia)
              ? receivedVia
              : 'other',
        });
    return BusinessParkingPaidResult.fromCallable(response.data);
  }
}
