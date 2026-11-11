/// A negotiated discount on a parked car (docs/PARKING_DISCOUNT.md).
///
/// A deliberate mirror of the server's `parking_discount.js` and the
/// console's `parking-discount.ts`, so the preview says exactly what the
/// server will record. All three run the shared fixture
/// `functions/test/fixtures/parking-discount-cases.json`. The discount is
/// never money in: it lives in `parkingDiscounts` / `parkingDiscountCents`,
/// not in the payments.
///
/// Pure: no Firebase, no widgets, no clock of its own (the caller passes
/// `now`).
library;

import 'parking_balance.dart';
import 'parking_month_statement.dart';

/// Server refusal codes and their English sentences (the app shows localized
/// copy in its screens; this is the reference text).
const Map<String, String> discountMessages = {
  'discount_not_direct':
      'A discount can only be given on a car the business records payments for (cash, Zelle...). Online and payment-link cars are paid in Stripe.',
  'discount_reason_required': 'Say why the discount was agreed.',
  'discount_no_amount': 'Enter the discount amount.',
  'discount_nothing_owed': 'This car owes nothing right now.',
  'discount_more_than_owed':
      'That is more than this car owes. Enter at most what is owed.',
  'discount_paid_not_less':
      'The amount paid must be less than what is owed. For the full amount, record a normal payment.',
  'discount_receiver_required': 'Say who took the money.',
  'discount_owed_changed':
      'What this car owes has changed. Check the amount and try again.',
  'discount_not_found': 'That discount was not found.',
  'discount_already_undone': 'That discount was already undone.',
  'discount_voided': 'This car record was voided.',
};

String _text(Object? v, [int max = 200]) {
  final t = '${v ?? ''}'.trim();
  return t.length > max ? t.substring(0, max) : t;
}

/// One entry of a car's `parkingDiscounts` list.
class ParkingDiscount {
  const ParkingDiscount({
    required this.id,
    required this.amountCents,
    required this.reason,
    required this.mode,
    required this.paymentCents,
    required this.givenByUid,
    required this.atMs,
    required this.undone,
    required this.undoneByUid,
    required this.undoneAtMs,
  });

  final String id;
  final int amountCents;
  final String reason;

  /// "discount" or "settle".
  final String mode;
  final int paymentCents;
  final String givenByUid;
  final int atMs;
  final bool undone;
  final String undoneByUid;
  final int undoneAtMs;
}

/// Whether the business records this car's payments by hand.
bool discountableCar(Map<String, dynamic> car) =>
    _text(car['paymentMethod'], 40) == 'direct' &&
    (_text(car['source'], 40) == 'business' ||
        car['enteredByBusiness'] == true);

int _fixedTotalCents(Map<String, dynamic> car) {
  final cents = num.tryParse('${car['amountDueCents'] ?? car['totalCostCents'] ?? ''}');
  if (cents != null && cents.isFinite && cents > 0) return cents.round();
  final dollars = num.tryParse('${car['amountDue'] ?? car['totalCost'] ?? ''}');
  return dollars != null && dollars.isFinite && dollars > 0
      ? (dollars * 100).round()
      : 0;
}

/// What the car owes now, before any new discount (the server's rule).
int owedNowCents(Map<String, dynamic> car, DateTime now) {
  final balance = parkingBalanceNow(car, now);
  if (balance == null) return 0;
  if (balance.leftDayKey == null) return balance.balanceCents;
  final today = parkingDayNumber(now) ?? 0;
  final whole = _fixedTotalCents(car) -
      parkingPaidCentsOf(car, today) -
      parkingDiscountCentsOf(car);
  final wholeFloored = whole > 0 ? whole : 0;
  return wholeFloored > balance.balanceCents
      ? wholeFloored
      : balance.balanceCents;
}

/// The preview of a discount: either a refusal ([ok] false, with [reason]
/// code and English [message]) or what would be recorded.
class DiscountPreview {
  const DiscountPreview.ok({
    required this.owedCents,
    required this.discountCents,
    required this.paidCents,
    required this.leftCents,
    required this.settles,
  })  : ok = true,
        reason = '',
        message = '';

  DiscountPreview.refused(this.reason)
      : ok = false,
        message = discountMessages[reason] ?? reason,
        owedCents = 0,
        discountCents = 0,
        paidCents = 0,
        leftCents = 0,
        settles = false;

  final bool ok;
  final String reason;
  final String message;
  final int owedCents;
  final int discountCents;
  final int paidCents;
  final int leftCents;
  final bool settles;

  Map<String, Object?> toJson() => ok
      ? {
          'ok': true,
          'owedCents': owedCents,
          'discountCents': discountCents,
          'paidCents': paidCents,
          'leftCents': leftCents,
          'settles': settles,
        }
      : {'ok': false, 'reason': reason, 'message': message};
}

/// Whether a stay with a leave date is covered in full after this (open
/// stays never are).
bool _settlesStay(
  Map<String, dynamic> car,
  int extraPaid,
  int extraDiscount,
  DateTime now,
) {
  final end = car['parkingEndDate'];
  if (end == null || '$end'.isEmpty || end == false || end == 0) return false;
  final total = _fixedTotalCents(car);
  if (total <= 0) return false;
  final today = parkingDayNumber(now) ?? 0;
  return parkingPaidCentsOf(car, today) +
          extraPaid +
          parkingDiscountCentsOf(car) +
          extraDiscount >=
      total;
}

/// The preview for either form, in the server's order of checks.
/// "discount": the amount is the discount, the rest stays owed. "settle":
/// the amount is paid now, the rest owed today is the discount; money taken
/// needs who took it.
DiscountPreview discountPreview(
  Map<String, dynamic> car,
  String mode,
  int amountCents,
  String reason, {
  String receivedByStaffId = '',
  DateTime? now,
}) {
  final at = now ?? DateTime.now();
  if (car['voided'] == true) return DiscountPreview.refused('discount_voided');
  if (!discountableCar(car)) {
    return DiscountPreview.refused('discount_not_direct');
  }
  final amount = amountCents;
  if (mode == 'discount') {
    if (!(amount > 0)) return DiscountPreview.refused('discount_no_amount');
  } else if (!(amount >= 0)) {
    return DiscountPreview.refused('discount_no_amount');
  }
  final owed = owedNowCents(car, at);
  if (owed <= 0) return DiscountPreview.refused('discount_nothing_owed');
  if (mode == 'discount') {
    if (amount > owed) {
      return DiscountPreview.refused('discount_more_than_owed');
    }
    if (_text(reason, 300).isEmpty) {
      return DiscountPreview.refused('discount_reason_required');
    }
    return DiscountPreview.ok(
      owedCents: owed,
      discountCents: amount,
      paidCents: 0,
      leftCents: owed - amount,
      settles: _settlesStay(car, 0, amount, at),
    );
  }
  if (amount >= owed) return DiscountPreview.refused('discount_paid_not_less');
  if (_text(reason, 300).isEmpty) {
    return DiscountPreview.refused('discount_reason_required');
  }
  if (amount > 0 && _text(receivedByStaffId, 180).isEmpty) {
    return DiscountPreview.refused('discount_receiver_required');
  }
  return DiscountPreview.ok(
    owedCents: owed,
    discountCents: owed - amount,
    paidCents: amount,
    leftCents: 0,
    settles: _settlesStay(car, amount, owed - amount, at),
  );
}

/// The car's discounts, newest first, undone ones included.
List<ParkingDiscount> parkingDiscountsOf(Map<String, dynamic> car) {
  final raw = car['parkingDiscounts'];
  final list = raw is List ? raw : const [];
  int whole(Object? v) {
    final n = num.tryParse('${v ?? ''}');
    return n != null && n.isFinite && n.round() > 0 ? n.round() : 0;
  }

  final out = <ParkingDiscount>[
    for (final d in list)
      if (d is Map)
        ParkingDiscount(
          id: _text(d['id'], 80),
          amountCents: whole(d['amountCents']),
          reason: _text(d['reason'], 300),
          mode: d['mode'] == 'settle' ? 'settle' : 'discount',
          paymentCents: whole(d['paymentCents']),
          givenByUid: _text(d['givenByUid'], 128),
          atMs: whole(d['atMs']),
          undone: d['undone'] == true,
          undoneByUid: _text(d['undoneByUid'], 128),
          undoneAtMs: whole(d['undoneAtMs']),
        ),
  ].where((d) => d.id.isNotEmpty && d.amountCents > 0).toList();
  out.sort((a, b) => b.atMs.compareTo(a.atMs));
  return out;
}
