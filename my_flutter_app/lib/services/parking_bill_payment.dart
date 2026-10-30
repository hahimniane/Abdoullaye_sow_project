import 'package:cloud_firestore/cloud_firestore.dart' show Timestamp;

import 'parking_month_statement.dart';
import 'staff_expense_credit.dart' show itemsAfterCredit;

/// Part of a month bill paid at once (docs/PARKING_BILL_PAYMENTS.md).
///
/// Staff type ONE amount on a customer's Month end card. It pays the bill's
/// charges oldest first - money from before the month, then the month - each
/// part recorded on its car or activity like a hand-recorded part payment,
/// all of them tied to one `parkingBillPayments` document, so the whole
/// payment has one receipt and is undone as one. Never more than the bill's
/// recordable total: there is no parking credit balance.
///
/// Pure. A faithful mirror of the server's `parking_bill_payment.js` and the
/// console's `parking-bill-payment.ts`: all three give the same answers for
/// `functions/test/fixtures/parking-bill-payment-cases.json`.

/// The refusal reasons the server sends as `details.reason`.
abstract final class BillPaymentRefusal {
  static const noAmount = 'bill_payment_no_amount';
  static const moreThanOwed = 'bill_payment_more_than_owed';
  static const nothingToPay = 'bill_payment_nothing_to_pay';
  static const customerNotFound = 'bill_payment_customer_not_found';
  static const billChanged = 'bill_payment_bill_changed';
  static const receiverRequired = 'bill_payment_receiver_required';
  static const monthInvalid = 'bill_payment_month_invalid';
  static const notFound = 'bill_payment_not_found';
  static const alreadyUndone = 'bill_payment_already_undone';
  static const settledSince = 'bill_payment_settled_since';
  static const ledgerRequired = 'bill_payment_ledger_required';

  static const all = {
    noAmount,
    moreThanOwed,
    nothingToPay,
    customerNotFound,
    billChanged,
    receiverRequired,
    monthInvalid,
    notFound,
    alreadyUndone,
    settledSince,
    ledgerRequired,
  };
}

/// One charge a payment can pay.
class BillPaymentItem {
  const BillPaymentItem({
    required this.kind,
    required this.id,
    required this.label,
    required this.trackingCode,
    required this.dayKey,
    required this.amountCents,
  });

  /// 'car' or 'activity'.
  final String kind;
  final String id;
  final String label;
  final String trackingCode;

  /// "YYYY-MM-DD", the day the charge sorts by.
  final String dayKey;
  final int amountCents;

  BillPaymentItem withAmount(int cents) => BillPaymentItem(
    kind: kind,
    id: id,
    label: label,
    trackingCode: trackingCode,
    dayKey: dayKey,
    amountCents: cents,
  );
}

/// What one payment pays off on one car or activity (a car's two items are
/// one part).
class BillPaymentPart {
  const BillPaymentPart({
    required this.kind,
    required this.id,
    required this.label,
    required this.trackingCode,
    required this.amountCents,
    this.full = false,
  });

  final String kind;
  final String id;
  final String label;
  final String trackingCode;
  final int amountCents;

  /// The part pays everything that charge owed on the bill.
  final bool full;

  BillPaymentPart _more(int cents) => BillPaymentPart(
    kind: kind,
    id: id,
    label: label,
    trackingCode: trackingCode,
    amountCents: amountCents + cents,
    full: full,
  );

  BillPaymentPart _withFull(bool value) => BillPaymentPart(
    kind: kind,
    id: id,
    label: label,
    trackingCode: trackingCode,
    amountCents: amountCents,
    full: value,
  );
}

/// What an amount pays on a bill. Refused: [reason] is set and [parts] is
/// empty.
class BillPaymentPlan {
  const BillPaymentPlan({
    required this.ok,
    required this.reason,
    required this.payableCents,
    required this.parts,
    required this.leftCents,
  });

  final bool ok;
  final String reason;

  /// The most that can be paid here (the sum of the items).
  final int payableCents;
  final List<BillPaymentPart> parts;

  /// What the whole bill still owes afterwards.
  final int leftCents;
}

String _text(Object? value, [int max = 200]) {
  final s = (value ?? '').toString().trim();
  return s.length > max ? s.substring(0, max) : s;
}

int _cents(int value) => value < 0 ? 0 : value;

/// The bill's charges that a payment recorded here can pay, oldest first:
/// first what is from before the month (cars that left earlier, the earlier
/// days of cars still on the bill, older activities), then the month's own
/// cars and activities - each group by date. Cars paid through Stripe are not
/// recordable here and are left out, as in Mark all paid. Linked staff's
/// expense credit covers the first items (`itemsAfterCredit`, the same helper
/// Mark all paid uses).
List<BillPaymentItem> billPaymentItems(ParkingMonthCustomer customer) {
  final before = <BillPaymentItem>[];
  final month = <BillPaymentItem>[];

  void car({
    required String id,
    required String vehicle,
    required String trackingCode,
    required bool recordable,
    required int amountCents,
    required String dayKey,
    required List<BillPaymentItem> into,
  }) {
    if (amountCents <= 0 || !recordable) return;
    final name = _text(vehicle);
    into.add(
      BillPaymentItem(
        kind: 'car',
        id: _text(id),
        label: name.isEmpty ? 'Car' : name,
        trackingCode: _text(trackingCode, 40),
        dayKey: _text(dayKey, 10),
        amountCents: amountCents,
      ),
    );
  }

  for (final b in customer.olderCars) {
    car(
      id: b.id,
      vehicle: b.vehicle,
      trackingCode: b.trackingCode,
      recordable: b.recordable,
      amountCents: _cents(b.dueCents),
      dayKey: b.periodFrom,
      into: before,
    );
  }
  for (final b in customer.cars) {
    // A car on the bill owes its earlier days first, then the month's.
    final due = _cents(b.dueCents);
    final prior = _cents(b.priorUnpaidCents) < due
        ? _cents(b.priorUnpaidCents)
        : due;
    for (final (amount, into) in [(prior, before), (due - prior, month)]) {
      car(
        id: b.id,
        vehicle: b.vehicle,
        trackingCode: b.trackingCode,
        recordable: b.recordable,
        amountCents: amount,
        dayKey: b.periodFrom,
        into: into,
      );
    }
  }
  void activity(ParkingMonthActivity a, List<BillPaymentItem> into) {
    final amountCents = _cents(a.dueCents);
    if (amountCents <= 0) return;
    final label = _text(a.label);
    final vehicle = _text(a.vehicle);
    into.add(
      BillPaymentItem(
        kind: 'activity',
        id: _text(a.id),
        label:
            '${label.isEmpty ? 'Activity' : label}'
            '${vehicle.isEmpty ? '' : ' · $vehicle'}',
        trackingCode: '',
        dayKey: _text(a.date, 10),
        amountCents: amountCents,
      ),
    );
  }

  for (final a in customer.olderActivities) {
    activity(a, before);
  }
  for (final a in customer.activities) {
    activity(a, month);
  }
  return itemsAfterCredit<BillPaymentItem>(
    [..._byDay(before), ..._byDay(month)],
    _cents(customer.expenseCreditCents),
    amountOf: (x) => x.amountCents,
    withAmount: (x, cents) => x.withAmount(cents),
  );
}

/// A STABLE sort by day key: Dart's `List.sort` is not stable, and the order
/// within one day (a car before an activity, a car's earlier days before its
/// month) is part of the answer.
List<BillPaymentItem> _byDay(List<BillPaymentItem> items) {
  final indexed = [for (var i = 0; i < items.length; i++) (i, items[i])];
  indexed.sort((a, b) {
    final byDay = a.$2.dayKey.compareTo(b.$2.dayKey);
    return byDay != 0 ? byDay : a.$1.compareTo(b.$1);
  });
  return [for (final x in indexed) x.$2];
}

/// What one amount pays on a customer's bill. [BillPaymentPlan.parts] are the
/// charges paid, in order, one per car or activity; `leftCents` is what the
/// whole bill still owes afterwards.
BillPaymentPlan billPaymentPlan(
  ParkingMonthCustomer customer,
  int amountCents,
) {
  final items = billPaymentItems(customer);
  final payable = items.fold<int>(0, (s, x) => s + x.amountCents);
  final due = _cents(customer.dueCents);
  BillPaymentPlan refuse(String reason) => BillPaymentPlan(
    ok: false,
    reason: reason,
    payableCents: payable,
    parts: const [],
    leftCents: due,
  );
  if (payable <= 0) return refuse(BillPaymentRefusal.nothingToPay);
  if (!(amountCents > 0)) return refuse(BillPaymentRefusal.noAmount);
  if (amountCents > payable) return refuse(BillPaymentRefusal.moreThanOwed);

  final owed = <String, int>{};
  for (final item in items) {
    final key = '${item.kind}:${item.id}';
    owed[key] = (owed[key] ?? 0) + item.amountCents;
  }
  final parts = <BillPaymentPart>[];
  final index = <String, int>{};
  var left = amountCents;
  for (final item in items) {
    if (left <= 0) break;
    final take = left < item.amountCents ? left : item.amountCents;
    left -= take;
    final key = '${item.kind}:${item.id}';
    final at = index[key];
    if (at != null) {
      parts[at] = parts[at]._more(take);
    } else {
      index[key] = parts.length;
      parts.add(
        BillPaymentPart(
          kind: item.kind,
          id: item.id,
          label: item.label,
          trackingCode: item.trackingCode,
          amountCents: take,
        ),
      );
    }
  }
  return BillPaymentPlan(
    ok: true,
    reason: '',
    payableCents: payable,
    parts: [
      for (final p in parts)
        p._withFull(p.amountCents >= (owed['${p.kind}:${p.id}'] ?? 0)),
    ],
    leftCents: due - amountCents < 0 ? 0 : due - amountCents,
  );
}

/// "2014 Toyota Corolla, 2016 RAV4 and 2 more" - what a payment was for.
/// [labels] are the parts' labels; [language] is 'en' or 'fr'.
String billPaymentFor(Iterable<String> labels, [String language = 'en']) {
  final names = <String>[];
  for (final label in labels) {
    final name = _text(label, 80);
    if (name.isNotEmpty && !names.contains(name)) names.add(name);
  }
  final fr = language == 'fr';
  if (names.isEmpty) return fr ? 'stationnement' : 'parking';
  if (names.length == 1) return names[0];
  final and = fr ? 'et' : 'and';
  if (names.length == 2) return '${names[0]} $and ${names[1]}';
  final more = names.length - 2;
  final rest = fr ? (more == 1 ? 'autre' : 'autres') : 'more';
  return '${names[0]}, ${names[1]} $and $more $rest';
}

/// One part of a recorded payment, as stored on `parkingBillPayments`.
class ParkingBillPaymentPart {
  const ParkingBillPaymentPart({
    required this.kind,
    required this.id,
    required this.label,
    required this.amountCents,
    required this.full,
  });

  final String kind;
  final String id;
  final String label;
  final int amountCents;
  final bool full;
}

/// A payment on a customer's month bill: a `parkingBillPayments` document.
/// Never deleted - an undo marks it [undone].
class ParkingBillPayment {
  const ParkingBillPayment({
    required this.id,
    required this.customerKey,
    required this.amountCents,
    required this.receivedVia,
    required this.receivedByStaffId,
    required this.note,
    required this.parts,
    required this.status,
    required this.atMs,
    required this.undoneAtMs,
    required this.leftCents,
  });

  factory ParkingBillPayment.fromMap(String id, Map<String, dynamic> row) {
    int whole(Object? v) => v is num ? v.round() : 0;
    int millis(Object? ms, Object? at) {
      if (ms is num && ms > 0) return ms.round();
      if (at is Timestamp) return at.millisecondsSinceEpoch;
      return 0;
    }

    final parts = row['parts'];
    return ParkingBillPayment(
      id: id,
      customerKey: _text(row['customerKey']),
      amountCents: whole(row['amountCents']),
      receivedVia: _text(row['receivedVia'], 40),
      receivedByStaffId: _text(row['receivedByStaffId'], 128),
      note: _text(row['note']),
      parts: [
        if (parts is List)
          for (final p in parts)
            if (p is Map)
              ParkingBillPaymentPart(
                kind: _text(p['kind'], 20),
                id: _text(p['id'], 128),
                label: _text(p['label']),
                amountCents: whole(p['amountCents']),
                full: p['full'] == true,
              ),
      ],
      status: _text(row['status'], 20),
      atMs: millis(row['atMs'], row['at']),
      undoneAtMs: millis(row['undoneAtMs'], row['undoneAt']),
      leftCents: whole(row['leftCents']),
    );
  }

  final String id;
  final String customerKey;
  final int amountCents;
  final String receivedVia;
  final String receivedByStaffId;
  final String note;
  final List<ParkingBillPaymentPart> parts;

  /// 'recorded' or 'undone'.
  final String status;
  final int atMs;
  final int undoneAtMs;

  /// What the bill still owed right after this payment.
  final int leftCents;

  bool get undone => status == 'undone';
}

/// A month's payments grouped by customer key, newest first - worked out
/// once when the rows change, never per build.
Map<String, List<ParkingBillPayment>> billPaymentsByCustomer(
  Iterable<ParkingBillPayment> payments,
) {
  final out = <String, List<ParkingBillPayment>>{};
  for (final p in payments) {
    if (p.customerKey.isEmpty) continue;
    out.putIfAbsent(p.customerKey, () => []).add(p);
  }
  for (final list in out.values) {
    list.sort((a, b) {
      final byTime = b.atMs.compareTo(a.atMs);
      return byTime != 0 ? byTime : b.id.compareTo(a.id);
    });
  }
  return out;
}
