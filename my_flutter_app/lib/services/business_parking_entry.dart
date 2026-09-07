import 'package:cloud_functions/cloud_functions.dart';

import 'business_assistant_service.dart' show deepCastCallableValue;

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
  // The leave date is optional: no end date is an OPEN-ENDED stay that is
  // billed day by day ("bill through today") until the business closes it.
  // Same rule as the console and the server. Only an end before the start
  // is still wrong.
  if (start != null && end != null && _dayOnly(end).isBefore(_dayOnly(start))) {
    errors.add(BusinessParkingEntryError.endDateBeforeStartDate);
  }

  return errors;
}

/// A calendar day plus a midday clock, the only date shape the parking
/// callables accept.
///
/// The clock is the point: the server parses with `new Date(...)` and charges
/// for the window it gets, so a bare `yyyy-mm-dd` read in a timezone west of
/// UTC would roll the parking back a day and price it wrong. Midday cannot be
/// moved off its own date by any real offset.
String businessParkingMiddayIso(DateTime? value) {
  if (value == null) return '';
  final day = _dayOnly(value);
  final month = day.month.toString().padLeft(2, '0');
  final date = day.day.toString().padLeft(2, '0');
  return '${day.year}-$month-${date}T12:00:00';
}

/// The exact payload `createBusinessParkingEntry` expects.
///
/// Dates go as a date plus a midday clock so a timezone west of UTC cannot
/// roll the parking window back a day on the server's `new Date(...)` - the
/// window is what the customer is charged for.
Map<String, dynamic> businessParkingEntryPayload(
  BusinessParkingEntryDraft draft,
) {
  return <String, dynamic>{
    'businessId': _trimmed(draft.businessId, 180),
    'customerName': _trimmed(draft.customerName),
    'customerPhone': _trimmed(draft.customerPhone, 40),
    'customerEmail': _trimmed(draft.customerEmail, 180).toLowerCase(),
    'carMake': _trimmed(draft.carMake, 80),
    'carModel': _trimmed(draft.carModel, 80),
    'carYear': _trimmed(draft.carYear, 8),
    'vinNumber': _trimmed(draft.vinNumber, 17).toUpperCase(),
    'startDate': businessParkingMiddayIso(draft.startDate),
    'endDate': businessParkingMiddayIso(draft.endDate),
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

/// The outcome of cancelling a payment link. Like `alreadyPaid`,
/// `alreadyCancelled` is a success: two staff killing the same link at once
/// must not read as a failure.
class BusinessParkingCancelLinkResult {
  const BusinessParkingCancelLinkResult({
    required this.success,
    required this.alreadyCancelled,
  });

  factory BusinessParkingCancelLinkResult.fromCallable(Object? data) {
    final row = data is Map ? data : const <Object?, Object?>{};
    return BusinessParkingCancelLinkResult(
      success: row['success'] != false,
      alreadyCancelled: row['alreadyCancelled'] == true,
    );
  }

  final bool success;
  final bool alreadyCancelled;
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

/// Has the lot already nullified this payment link?
///
/// The server stamps `paymentLinkCancelledAt`; the field's presence is the
/// whole signal, so a timestamp, a string or a sentinel written by an
/// optimistic client all read the same.
bool isBusinessParkingPaymentLinkCancelled(Map<String, dynamic> row) =>
    row['paymentLinkCancelledAt'] != null;

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
  // Paid is checked BEFORE cancelled, matching the web console: money that
  // arrived is a fact the cancellation does not undo, and hiding the badge on
  // a cancelled-but-paid record made the two clients disagree about the same
  // car. Only an unpaid cancellation has nothing left to chase.
  final paymentStatus = _trimmed(row['paymentStatus'], 40).toLowerCase();
  if (paymentStatus == 'succeeded' || paymentStatus == 'paid') {
    return BusinessParkingPaymentTone.paid;
  }
  if (paymentStatus == 'not_required') return BusinessParkingPaymentTone.none;
  if (_trimmed(row['status'], 40).toLowerCase() == 'cancelled') {
    return BusinessParkingPaymentTone.none;
  }
  return BusinessParkingPaymentTone.awaiting;
}

/// Whether "Cancel payment link" applies.
///
/// The owner's rule is that a parking payment link stays good until the
/// customer pays it or the lot kills it, so the lot needs the second half of
/// that rule in front of it - but only while it still means something.
/// Mirrors the server's `parkingPaymentLinkState` refusals so the action is
/// absent rather than present-and-rejected: a paid entry is settled money,
/// and an already-cancelled one has nothing left to cancel.
///
/// A stored `checkoutUrl` is what makes a record a payment link here, the
/// same signal the details card already branches on - a direct entry never
/// has one.
bool canCancelBusinessParkingPaymentLink(Map<String, dynamic> row) {
  if (!isBusinessEnteredParking(row)) return false;
  if (_trimmed(row['checkoutUrl'], 2048).isEmpty) return false;
  if (isBusinessParkingPaymentLinkCancelled(row)) return false;
  if (businessParkingPaymentTone(row) == BusinessParkingPaymentTone.paid) {
    return false;
  }
  // The tone reads a cancelled *record* as "nothing to say" whatever its
  // payment status, so ask the payment status itself as well - the server
  // still calls a succeeded payment paid and would refuse.
  final paymentStatus = _trimmed(row['paymentStatus'], 40).toLowerCase();
  return paymentStatus != 'succeeded' && paymentStatus != 'paid';
}

/// Whether "Resend payment link" applies.
///
/// Exactly the cancel gate, and deliberately expressed as one: the server
/// refuses a resend for the same three reasons it refuses a cancellation -
/// the money is already in, the link was killed, or there is no link at all -
/// so two gates that could drift apart would only ever offer a button the
/// callable would reject. `resendBusinessParkingPaymentLink` additionally
/// refuses a record with no email and no phone on file; that one is the
/// server's to answer, and its `failed-precondition` message is shown as
/// written.
bool canResendBusinessParkingPaymentLink(Map<String, dynamic> row) =>
    canCancelBusinessParkingPaymentLink(row);

/// Whether "Check payment status" applies.
///
/// A Stripe webhook can arrive late, be misconfigured, or never arrive at all,
/// and a lot left staring at "Payment link sent" for a car the customer has
/// already paid for has no way to settle the question. This is the manual
/// fallback: `refreshBusinessParkingPayment` asks Stripe directly and reuses
/// the webhook's own completion path, so the action exists for exactly the
/// records Stripe could answer for.
///
/// Mirrors the console (`operations-panels.tsx`): the payment-link block is
/// shown for a business-entered record with a stored `checkoutUrl`, and the
/// check button inside it is hidden once the record is paid - there is nothing
/// left to ask.
///
/// Deliberately NOT gated on cancellation, and the console is not either: a
/// customer can pay a link in the minutes before the lot kills it, and that
/// payment is precisely the one nobody would otherwise find.
bool canCheckBusinessParkingPayment(Map<String, dynamic> row) {
  if (!isBusinessEnteredParking(row)) return false;
  if (_trimmed(row['paymentMethod'], 40) != 'payment_link') return false;
  if (_trimmed(row['checkoutUrl'], 2048).isEmpty) return false;
  return businessParkingPaymentTone(row) != BusinessParkingPaymentTone.paid;
}

/// The three answers `refreshBusinessParkingPayment` can give, and the only
/// three - the console reports exactly these and no others.
enum BusinessParkingRefreshOutcome {
  /// Stripe had the money, and this call is what recorded it. The payout and
  /// the platform's cut went through the same path a webhook would have used.
  confirmedAndRecorded,

  /// The record already said paid. Nothing moved, and that is a success: a
  /// second check must not read as a failure.
  alreadyRecorded,

  /// Stripe has not been paid. The lot is still owed.
  notReceived,
}

/// What `refreshBusinessParkingPayment` answers with.
class BusinessParkingRefreshResult {
  const BusinessParkingRefreshResult({
    required this.paid,
    required this.alreadyRecorded,
    required this.paymentStatus,
    required this.sessionStatus,
  });

  /// Reads the response defensively: anything that is not an explicit `true`
  /// is "not paid", because telling a lot money has arrived when it has not is
  /// the one mistake this action must never make.
  factory BusinessParkingRefreshResult.fromCallable(Object? data) {
    final decoded = deepCastCallableValue(data);
    final row = decoded is Map ? decoded : const <Object?, Object?>{};
    return BusinessParkingRefreshResult(
      paid: row['paid'] == true,
      alreadyRecorded: row['alreadyRecorded'] == true,
      paymentStatus: _trimmed(row['paymentStatus'], 40),
      sessionStatus: _trimmed(row['sessionStatus'], 40),
    );
  }

  final bool paid;

  /// True when the record already said paid before the check ran.
  final bool alreadyRecorded;
  final String paymentStatus;
  final String sessionStatus;

  BusinessParkingRefreshOutcome get outcome =>
      businessParkingRefreshOutcome(this);
}

/// Which of the three sentences the staff member is shown.
///
/// A deliberate mirror of the console's `checkLinkPayment`: `paid` decides
/// first, and only then does `alreadyRecorded` separate "we just recorded it"
/// from "it was already recorded". `alreadyRecorded` on an unpaid answer is
/// meaningless and must not promote it to a payment.
BusinessParkingRefreshOutcome businessParkingRefreshOutcome(
  BusinessParkingRefreshResult result,
) {
  if (!result.paid) return BusinessParkingRefreshOutcome.notReceived;
  return result.alreadyRecorded
      ? BusinessParkingRefreshOutcome.alreadyRecorded
      : BusinessParkingRefreshOutcome.confirmedAndRecorded;
}

/// The parking statuses a business may set, in the console's own order.
///
/// Not `baseParkedCarStatusOptions`: that list carries `reserved` and no
/// `cancelled`, which is the customer-booking vocabulary. A lot closing out a
/// walk-up needs "completed", and a lot releasing a space needs "cancelled".
const List<String> businessParkingStatusOptions = <String>[
  'active',
  'completed',
  'cancelled',
];

/// The status choices to offer, with whatever the record already holds kept
/// in the list.
///
/// A record parked on a status the console never offers - `reserved`, or
/// anything a migration left behind - must not have that status silently
/// rewritten by opening a dropdown that cannot represent it.
List<String> businessParkingStatusOptionsFor(String currentStatus) {
  final normalized = currentStatus.trim();
  // A set literal is insertion-ordered, so the console's order survives the
  // de-duplication and an already-known status is not moved to the end.
  return <String>{
    ...businessParkingStatusOptions,
    if (normalized.isNotEmpty) normalized,
  }.toList(growable: false);
}

/// "Do not narrow." A filter value rather than a null, the same way
/// [BusinessParkingPaymentFilter.all] is.
const String businessParkingStatusFilterAll = 'all';

/// Whether a row survives the parking-status filter.
///
/// Mirrors the console's `text(row.status, "") === filter`: a record with no
/// status recorded matches no narrowing, only `all`.
bool businessParkingMatchesStatusFilter(
  Map<String, dynamic> row,
  String filter,
) {
  final wanted = filter.trim();
  if (wanted.isEmpty || wanted == businessParkingStatusFilterAll) return true;
  return _trimmed(row['status'], 40) == wanted;
}

/// The fields a parked-car search reads, in the console's own order.
///
/// The order matters: the console joins these values with spaces before
/// matching, so "toyota camry" finds a car whose make and model are two
/// separate fields. A different order would answer that query differently.
const List<String> businessParkingSearchFields = <String>[
  'trackingCode',
  'ownerName',
  'customerName',
  'carMake',
  'carModel',
  'carYear',
  'vinNumber',
  'status',
];

/// Whether a row matches a free-text search.
///
/// A deliberate mirror of the console's `filterRows`, down to the join: the
/// searchable fields are concatenated with a space and the needle is looked
/// for in the result, so a query can run across two adjacent fields. An empty
/// query narrows nothing.
bool businessParkingMatchesSearch(Map<String, dynamic> row, String query) {
  final needle = query.trim().toLowerCase();
  if (needle.isEmpty) return true;
  final haystack = businessParkingSearchFields
      .map((field) => (row[field] ?? '').toString().toLowerCase())
      .join(' ');
  return haystack.contains(needle);
}

/// Whether any parking narrowing is in force.
///
/// An empty list means two different things - "you have no parked cars" and
/// "none of them match what you asked for" - and only one of them is fixed by
/// clearing a filter. This is what lets the empty state say which.
bool businessParkingListIsNarrowed({
  String search = '',
  String statusFilter = businessParkingStatusFilterAll,
  BusinessParkingPaymentFilter paymentFilter = BusinessParkingPaymentFilter.all,
  DateTime? from,
  DateTime? to,
}) {
  if (search.trim().isNotEmpty) return true;
  final status = statusFilter.trim();
  if (status.isNotEmpty && status != businessParkingStatusFilterAll) return true;
  if (paymentFilter != BusinessParkingPaymentFilter.all) return true;
  return from != null || to != null;
}

/// "Ends" while the car is still due to sit there, "Ended" once the day has
/// passed.
enum BusinessParkingEndLabel { ends, ended }

/// Which of the two the end-date field is called.
///
/// A future date labelled "Ended" reads as though the parking is over while
/// the car is still in the lot. Whole days are compared, in UTC, the same way
/// the console's `businessParkingEndLabel` does - a parking that ends today
/// has not ended yet.
///
/// [now] is injected so the boundary is testable rather than a coin flip on
/// the day a test happens to run.
BusinessParkingEndLabel businessParkingEndLabel(
  Map<String, dynamic> row, {
  DateTime? now,
}) {
  final end = _toDateOrNull(row['parkingEndDate']);
  if (end == null) return BusinessParkingEndLabel.ends;
  final endUtc = end.toUtc();
  final todayUtc = (now ?? DateTime.now()).toUtc();
  final endDay = DateTime.utc(endUtc.year, endUtc.month, endUtc.day);
  final today = DateTime.utc(todayUtc.year, todayUtc.month, todayUtc.day);
  return endDay.isBefore(today)
      ? BusinessParkingEndLabel.ended
      : BusinessParkingEndLabel.ends;
}

/// Which document a business-entered row is entitled to.
///
/// Money in is a receipt - proof of something already settled. Money still
/// owed is an invoice, which carries a way to pay. The server decides the
/// same thing in `functions/parking_document.js`; this exists so the button
/// can be labelled before the callable answers, and so the label and the
/// document that opens agree.
enum BusinessParkingDocumentType { receipt, invoice }

/// Receipt when the money is in, invoice otherwise.
///
/// Keyed off [businessParkingPaymentTone] rather than the raw payment status
/// so the button never contradicts the badge sitting a few pixels above it. A
/// cancelled record is [BusinessParkingPaymentTone.none], so it reads as an
/// invoice here - the server may still call it a receipt, and the document it
/// serves is the authority on its own heading.
BusinessParkingDocumentType businessParkingDocumentType(
  Map<String, dynamic> row,
) {
  // Mirrors functions/parking_document.js parkingDocumentType: the document
  // follows the MONEY, not the badge. The badge tone reports `none` for a
  // cancelled record even when it was paid, so keying the label off the tone
  // would print "Invoice" on a card whose served document says "Receipt".
  final status = (row['paymentStatus'] ?? '').toString().trim();
  return status == 'succeeded' || status == 'paid'
      ? BusinessParkingDocumentType.receipt
      : BusinessParkingDocumentType.invoice;
}

/// What a list is being asked to show. `all` is not "everything that exists" -
/// it is "do not narrow", which is why it is a filter value rather than a null.
enum BusinessParkingPaymentFilter { all, paid, notPaid }

/// Whether a row survives the paid/not-paid filter.
///
/// A row with nothing to say - a customer's own booking, a cancelled record,
/// an entry with nothing to collect - is neither paid nor unpaid, so it is
/// hidden by either narrowing rather than being quietly counted as unpaid and
/// sending staff chasing money nobody owes. It is only ever shown under `all`.
bool businessParkingMatchesPaymentFilter(
  Map<String, dynamic> row,
  BusinessParkingPaymentFilter filter,
) {
  if (filter == BusinessParkingPaymentFilter.all) return true;
  final tone = businessParkingPaymentTone(row);
  return filter == BusinessParkingPaymentFilter.paid
      ? tone == BusinessParkingPaymentTone.paid
      : tone == BusinessParkingPaymentTone.awaiting;
}

/// Anything a parkedCars document might hold a date in, as a [DateTime].
///
/// Mirrors the console's `toDateOrNull`. A Firestore `Timestamp` is read by
/// duck typing rather than by importing `cloud_firestore`, so everything above
/// [BusinessParkingService] stays free of Firebase and the tests can drive it
/// with a plain fake.
DateTime? _toDateOrNull(Object? value) {
  if (value == null) return null;
  try {
    final converted = (value as dynamic).toDate();
    if (converted is DateTime) return converted;
  } catch (_) {
    // Not a Timestamp; fall through to the shapes below.
  }
  if (value is DateTime) return value;
  try {
    final seconds = (value as dynamic).seconds;
    if (seconds is int) {
      return DateTime.fromMillisecondsSinceEpoch(seconds * 1000, isUtc: true);
    }
  } catch (_) {
    // Not a {seconds} shape either.
  }
  if (value is num) {
    return DateTime.fromMillisecondsSinceEpoch(value.round(), isUtc: true);
  }
  if (value is String) {
    final text = value.trim();
    if (text.isEmpty) return null;
    // A bare `yyyy-mm-dd` is a calendar day, not a local midnight: reading it
    // as local would move it a day west of UTC, which is the whole reason the
    // payload sends midday clocks.
    if (RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(text)) {
      return DateTime.tryParse('${text}T00:00:00Z');
    }
    return DateTime.tryParse(text);
  }
  return null;
}

/// The stored instant as a `yyyy-mm-dd` day, in UTC.
///
/// UTC, not local, because that is what the console's
/// `toISOString().slice(0, 10)` produces - a phone and a browser filtering the
/// same lot must not disagree about which day a car arrived.
String _utcDayString(DateTime? value) {
  if (value == null) return '';
  final day = value.toUtc();
  final month = day.month.toString().padLeft(2, '0');
  final date = day.day.toString().padLeft(2, '0');
  return '${day.year}-$month-$date';
}

/// A picked bound as a `yyyy-mm-dd` day.
///
/// Read literally rather than converted, because a date picker hands back the
/// calendar day the staff member tapped - the console's equivalent is the raw
/// string from an `<input type="date">`, which has no timezone at all.
String _boundDayString(DateTime? value) {
  if (value == null) return '';
  final month = value.month.toString().padLeft(2, '0');
  final date = value.day.toString().padLeft(2, '0');
  return '${value.year}-$month-$date';
}

/// Whether a parking OVERLAPS a date window.
///
/// "Cars parked between the 10th and the 15th" means every car sitting in the
/// lot during that window - including one that arrived on the 5th and leaves
/// on the 20th. Matching only parkings fully contained in the range would hide
/// exactly the long stays a lot most needs to see.
///
/// An open bound is "no bound on that side", so a business can ask for
/// "everything from the 10th onwards" by filling one field. A record with no
/// dates at all cannot be placed in time, so it matches nothing: excluding it
/// is the honest answer to "what was parked that week".
///
/// A deliberate mirror of the console's `businessParkingWithinRange` in
/// `admin_web/src/lib/business-parking-entry.ts`, down to the missing-end-date
/// rule - a car still parked is treated as open-ended rather than as having
/// left on its arrival day.
bool businessParkingWithinRange(
  Map<String, dynamic> row,
  DateTime? from,
  DateTime? to,
) {
  final fromDay = _boundDayString(from);
  final toDay = _boundDayString(to);
  if (fromDay.isEmpty && toDay.isEmpty) return true;

  final start = _utcDayString(_toDateOrNull(row['parkingDate']));
  final end = _utcDayString(_toDateOrNull(row['parkingEndDate']));
  if (start.isEmpty && end.isEmpty) return false;

  // A missing bound is genuinely unbounded on that side. No end recorded
  // means the car has not left, so it is still in the lot for every window
  // after it arrived - collapsing it onto its start day would hide exactly
  // the car a lot is most likely to be looking for.
  //
  // yyyy-mm-dd sorts chronologically as text, which is why the whole
  // comparison can stay in day strings and never touch a clock.
  if (toDay.isNotEmpty && start.isNotEmpty && start.compareTo(toDay) > 0) {
    return false;
  }
  if (fromDay.isNotEmpty && end.isNotEmpty && end.compareTo(fromDay) < 0) {
    return false;
  }
  return true;
}

/// What `updateBusinessParkingEntry` answers with.
///
/// The amount is reported, never sent: the server recomputes it from the
/// business's own parking rates, so a client that offered an amount field
/// would be offering to contradict the price the customer is charged.
class BusinessParkingUpdateResult {
  const BusinessParkingUpdateResult({
    required this.success,
    required this.entryId,
    required this.paymentMethod,
    required this.amountDueCents,
    required this.relinked,
    required this.paymentLinkUrl,
    required this.emailed,
    required this.texted,
  });

  /// Reads the response defensively: a missing paymentLinkUrl on a reissue
  /// must surface as "copy it yourself" in the UI, never as a null rendered
  /// into a copy button.
  factory BusinessParkingUpdateResult.fromCallable(Object? data) {
    final decoded = deepCastCallableValue(data);
    final row = decoded is Map ? decoded : const <Object?, Object?>{};
    return BusinessParkingUpdateResult(
      success: row['success'] != false,
      entryId: _trimmed(row['entryId'], 180),
      paymentMethod: _trimmed(row['paymentMethod'], 40),
      amountDueCents: (num.tryParse(_trimmed(row['amountDueCents'], 20)) ?? 0)
          .round()
          .clamp(0, 1 << 40),
      relinked: row['relinked'] == true,
      paymentLinkUrl: _trimmed(
        row['paymentLinkUrl'] ?? row['checkoutUrl'],
        2048,
      ),
      emailed: row['emailed'] == true,
      texted: row['texted'] == true,
    );
  }

  final bool success;
  final String entryId;
  final String paymentMethod;
  final int amountDueCents;

  /// True when the customer's payment link was reissued at a new amount and
  /// re-sent. The staff member has to be told: the URL they copied a minute
  /// ago is now dead.
  final bool relinked;
  final String paymentLinkUrl;
  final bool emailed;
  final bool texted;

  bool get isPaymentLink => paymentMethod == 'payment_link';

  /// Whether the reissued link actually left the building. Neither channel
  /// answering is not a success - the customer is holding a dead link and
  /// nobody has sent them the new one.
  bool get reachedCustomer => emailed || texted;
}

/// What `resendBusinessParkingPaymentLink` answers with.
class BusinessParkingResendLinkResult {
  const BusinessParkingResendLinkResult({
    required this.success,
    required this.emailed,
    required this.texted,
    required this.url,
  });

  factory BusinessParkingResendLinkResult.fromCallable(Object? data) {
    final decoded = deepCastCallableValue(data);
    final row = decoded is Map ? decoded : const <Object?, Object?>{};
    return BusinessParkingResendLinkResult(
      success: row['success'] != false,
      emailed: row['emailed'] == true,
      texted: row['texted'] == true,
      url: _trimmed(row['url'], 2048),
    );
  }

  final bool success;
  final bool emailed;
  final bool texted;
  final String url;

  /// Same rule as a reissue: a send that reached neither channel is something
  /// the staff member has to hear about, not a green snackbar.
  bool get reachedCustomer => emailed || texted;
}

/// The branded, print-optimised document the server serves for a parked car.
class BusinessParkingDocumentLink {
  const BusinessParkingDocumentLink({
    required this.documentType,
    required this.url,
  });

  /// Reads the response defensively: a missing url must surface as "could not
  /// be opened", never as a `launchUrl` against an empty string.
  factory BusinessParkingDocumentLink.fromCallable(Object? data) {
    final row = data is Map ? data : const <Object?, Object?>{};
    return BusinessParkingDocumentLink(
      documentType: _trimmed(row['documentType'], 40).toLowerCase() == 'receipt'
          ? BusinessParkingDocumentType.receipt
          : BusinessParkingDocumentType.invoice,
      url: _trimmed(row['url'], 2048),
    );
  }

  final BusinessParkingDocumentType documentType;
  final String url;

  bool get hasUrl => url.isNotEmpty;
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

/// The callables, behind an injectable [FirebaseFunctions] so widget tests
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

  /// Kills a payment link the customer has not used. The callable refuses a
  /// paid entry with `failed-precondition`, which the caller surfaces rather
  /// than swallows.
  Future<BusinessParkingCancelLinkResult> cancelPaymentLink({
    required String entryId,
  }) async {
    final response = await _functions
        .httpsCallable('cancelBusinessParkingPaymentLink')
        .call<Object?>(<String, dynamic>{'entryId': entryId});
    return BusinessParkingCancelLinkResult.fromCallable(response.data);
  }

  /// Corrects a walk-up the lot already recorded.
  ///
  /// [changes] carries only the fields the server lets a business rewrite:
  /// customerName, customerPhone, customerEmail, carMake, carModel, carYear,
  /// vinNumber, startDate, endDate, paymentMethod - dates as
  /// [businessParkingMiddayIso] strings. There is deliberately no amount: the
  /// callable reprices the window from the business's own rates, and a client
  /// that sent one would be proposing a charge the customer never agreed to.
  ///
  /// The callable refuses a paid record with `failed-precondition` ("This
  /// parking has been paid for and can no longer be edited"), which the caller
  /// surfaces rather than swallows.
  Future<BusinessParkingUpdateResult> updateEntry({
    required String entryId,
    required Map<String, dynamic> changes,
  }) async {
    final response = await _functions
        .httpsCallable('updateBusinessParkingEntry')
        .call<Object?>(<String, dynamic>{
          'entryId': entryId,
          'changes': changes,
        });
    return BusinessParkingUpdateResult.fromCallable(response.data);
  }

  /// Sends the customer their existing payment link again.
  ///
  /// The record's own durable URL, not a fresh one - two live links for one
  /// car is how a lot ends up chasing a payment that already happened. The
  /// callable refuses with `failed-precondition` when the parking is paid, the
  /// link was cancelled, or there is no email and no phone to send it to.
  Future<BusinessParkingResendLinkResult> resendPaymentLink({
    required String entryId,
  }) async {
    final response = await _functions
        .httpsCallable('resendBusinessParkingPaymentLink')
        .call<Object?>(<String, dynamic>{'entryId': entryId});
    return BusinessParkingResendLinkResult.fromCallable(response.data);
  }

  /// Asks Stripe, right now, whether a payment link was paid.
  ///
  /// The manual fallback for a webhook that never arrived. The callable reuses
  /// the same completion path the webhook would have taken - including the
  /// payout - so a record settled this way is indistinguishable from one
  /// settled automatically, and running it twice is harmless.
  ///
  /// It refuses a record that is not on the payment-link path, and one with no
  /// checkout session to ask about, with `failed-precondition`; those messages
  /// say something the caller's own copy cannot, so they are surfaced rather
  /// than swallowed.
  Future<BusinessParkingRefreshResult> refreshPayment({
    required String entryId,
  }) async {
    final response = await _functions
        .httpsCallable('refreshBusinessParkingPayment')
        .call<Object?>(<String, dynamic>{'entryId': entryId});
    return BusinessParkingRefreshResult.fromCallable(response.data);
  }

  /// Asks for the printable receipt or invoice for a record.
  ///
  /// The callable mints the durable token when the record predates it and
  /// enforces the parking permission itself, so a refusal comes back as a
  /// `FirebaseFunctionsException` the caller surfaces rather than swallows.
  Future<BusinessParkingDocumentLink> parkingDocumentUrl({
    required String entryId,
  }) async {
    final response = await _functions
        .httpsCallable('getParkingDocumentUrl')
        .call<Object?>(<String, dynamic>{'entryId': entryId});
    return BusinessParkingDocumentLink.fromCallable(response.data);
  }
}
