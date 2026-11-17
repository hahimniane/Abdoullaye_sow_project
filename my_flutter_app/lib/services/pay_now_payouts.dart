import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';

import '../utils/callable_data.dart' show callableMap;
import 'package_requests.dart' show RequestRefusal, parseRequestRefusal;
import 'package_request_service.dart' show RequestFailure;
import 'waiting_package_service.dart'
    show ContainerCallableCaller, callContainerCallable;

/// The weekly payouts of Pay now (docs/PACKAGE_BOX_SIZES_PAY_NOW.md, "Ledger
/// and weekly payouts"): the weeks when Laawol collected card payments for a
/// business that has no Stripe of its own, what it owes the business, and the
/// platform admin's "Mark paid out". The website is the reference
/// (`admin_web/src/lib/pay-now.ts`); the server does every sum.

/// How a payout was sent.
const payoutMethods = ['zelle', 'bank', 'other'];

/// The ledger line kinds the server writes.
const payoutLedgerTypes = [
  'payment',
  'stripe_fee',
  'refund',
  'chargeback',
  'dispute_fee',
  'bill_offset',
  'payout',
  'to_bill',
];

/// How long the read may take before the panel gives up: loading resolves.
const payoutsTimeout = Duration(seconds: 20);

int _signed(Object? value) => value is num && value.isFinite
    ? value.truncate()
    : int.tryParse('${value ?? ''}') ?? 0;

String _text(Object? value, [int max = 300]) {
  final t = (value ?? '').toString().trim();
  return t.length > max ? t.substring(0, max) : t;
}

class PayoutLine {
  const PayoutLine({
    required this.id,
    required this.type,
    required this.amountCents,
    this.requestCode = '',
    this.note = '',
    this.at,
  });

  final String id;

  /// One of [payoutLedgerTypes], or '' when the server sent another.
  final String type;
  final int amountCents;
  final String requestCode;
  final String note;
  final DateTime? at;
}

class PayoutWeek {
  const PayoutWeek({
    required this.businessId,
    required this.businessName,
    required this.weekKey,
    required this.netCents,
    required this.status,
    this.collectedCents = 0,
    this.paidAt,
    this.method = '',
    this.reference = '',
    this.lines = const [],
  });

  final String businessId;
  final String businessName;

  /// The Monday of the week, "YYYY-MM-DD" (New York time).
  final String weekKey;

  /// What Laawol owes the business for the week; negative goes onto the
  /// Laawol bill.
  final int netCents;
  final int collectedCents;

  /// `open`, `due`, `paid` or `nothing`.
  final String status;
  final DateTime? paidAt;
  final String method;
  final String reference;
  final List<PayoutLine> lines;

  bool get isDue => status == 'due';
  bool get isPaid => status == 'paid';
  bool get isOpen => status == 'open';

  /// The day it is paid out: the Monday after the week.
  DateTime? get payoutDay => payoutDayOf(weekKey);
}

/// The Monday after [weekKey] (when the week is paid out), or null for a bad key.
DateTime? payoutDayOf(String weekKey) {
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(weekKey);
  if (m == null) return null;
  return DateTime(int.parse(m[1]!), int.parse(m[2]!), int.parse(m[3]!) + 7);
}

class PayoutsAnswer {
  const PayoutsAnswer({this.weeks = const [], this.unpaidBillCents = 0});

  final List<PayoutWeek> weeks;
  final int unpaidBillCents;

  List<PayoutWeek> get due => dueWeeks(weeks);
  List<PayoutWeek> get recentlyPaid => [
    for (final w in weeks)
      if (w.isPaid) w,
  ].take(10).toList();
}

/// The `payouts` answer, most recent week first.
PayoutsAnswer parsePayouts(Object? data) {
  final d = callableMap(data);
  final raw = d['weeks'];
  final weeks = <PayoutWeek>[];
  if (raw is List) {
    for (final entry in raw) {
      if (entry is! Map) continue;
      final w = callableMap(entry);
      final weekKey = _text(w['weekKey'], 10);
      if (payoutDayOf(weekKey) == null) continue;
      final status = _text(w['status'], 10);
      final method = _text(w['method'], 10);
      final lines = <PayoutLine>[];
      final rawLines = w['lines'];
      if (rawLines is List) {
        var index = 0;
        for (final l in rawLines) {
          if (l is! Map) continue;
          final line = callableMap(l);
          final type = _text(line['type'], 20);
          final at = _signed(line['atMs']);
          lines.add(
            PayoutLine(
              id: _text(line['id'], 80).isEmpty
                  ? '$weekKey-$index'
                  : _text(line['id'], 80),
              type: payoutLedgerTypes.contains(type) ? type : '',
              amountCents: _signed(line['amountCents']),
              requestCode: _text(line['requestCode'], 20),
              note: _text(line['note']),
              at: at > 0 ? DateTime.fromMillisecondsSinceEpoch(at) : null,
            ),
          );
          index++;
        }
      }
      final paidAt = _signed(w['paidAtMs']);
      weeks.add(
        PayoutWeek(
          businessId: _text(w['businessId'], 80),
          businessName: _text(w['businessName'], 120),
          weekKey: weekKey,
          collectedCents: _signed(w['collectedCents']),
          netCents: _signed(w['netCents']),
          status: const ['open', 'due', 'paid', 'nothing'].contains(status)
              ? status
              : 'open',
          paidAt: paidAt > 0
              ? DateTime.fromMillisecondsSinceEpoch(paidAt)
              : null,
          method: payoutMethods.contains(method) ? method : '',
          reference: _text(w['reference'], 120),
          lines: lines,
        ),
      );
    }
  }
  weeks.sort((a, b) {
    final byWeek = b.weekKey.compareTo(a.weekKey);
    return byWeek != 0 ? byWeek : a.businessName.compareTo(b.businessName);
  });
  final bill = _signed(d['unpaidBillCents']);
  return PayoutsAnswer(weeks: weeks, unpaidBillCents: bill < 0 ? 0 : bill);
}

/// The weeks waiting for a platform admin: due, not yet paid out.
List<PayoutWeek> dueWeeks(Iterable<PayoutWeek> weeks) => [
  for (final w in weeks)
    if (w.isDue) w,
];

/// What Laawol owes now: the open and due weeks that net above nothing.
int owedNowCents(Iterable<PayoutWeek> weeks) {
  var sum = 0;
  for (final w in weeks) {
    if (w.isOpen || w.isDue) sum += w.netCents;
  }
  return sum < 0 ? 0 : sum;
}

/// What the platform admin owes the businesses in total.
int dueTotalCents(Iterable<PayoutWeek> weeks) {
  var sum = 0;
  for (final w in dueWeeks(weeks)) {
    if (w.netCents > 0) sum += w.netCents;
  }
  return sum;
}

/// What is wrong with a paid-out form, or '' (a week that nets to nothing or
/// less goes onto the bill and needs neither method nor reference).
String payoutProblem({
  required String method,
  required String reference,
  required int netCents,
}) {
  if (netCents <= 0) return '';
  if (!payoutMethods.contains(method)) return 'method_invalid';
  if (reference.trim().length > 120) return 'reference_too_long';
  return '';
}

/// The `payout_paid` request for [week].
Map<String, Object?> payoutPaidPayload(
  PayoutWeek week,
  String method,
  String reference,
) => {
  'action': 'payout_paid',
  'businessId': week.businessId,
  'weekKey': week.weekKey,
  'method': week.netCents > 0 ? method : 'other',
  'reference': week.netCents > 0 ? reference.trim() : '',
};

/// `setPackageRequestSettings` `payouts` and `payout_paid`, through the caller
/// the other services use so widget tests hand in a fake. Failures are
/// [RequestFailure]s, read like every other package-request refusal.
class PayNowPayoutsService {
  const PayNowPayoutsService({
    this.caller = callContainerCallable,
    this.timeout = payoutsTimeout,
  });

  static const callable = 'setPackageRequestSettings';

  final ContainerCallableCaller caller;
  final Duration timeout;

  Future<Object?> _call(Map<String, Object?> payload) async {
    try {
      return await caller(callable, payload).timeout(timeout);
    } on FirebaseFunctionsException catch (error) {
      throw RequestFailure(parseRequestRefusal(error.code, error.details));
    } on RequestFailure {
      rethrow;
    } on TimeoutException {
      throw const RequestFailure(RequestRefusal(code: 'unavailable'));
    } catch (error) {
      final text = error.toString().toLowerCase();
      final offline =
          text.contains('socket') ||
          text.contains('network') ||
          text.contains('connection');
      throw RequestFailure(
        RequestRefusal(code: offline ? 'unavailable' : 'unknown'),
      );
    }
  }

  /// One business's weeks ([businessId]) or every business's (a platform admin
  /// with none).
  Future<PayoutsAnswer> load({String? businessId}) async => parsePayouts(
    await _call({
      'action': 'payouts',
      if (businessId != null && businessId.isNotEmpty) 'businessId': businessId,
    }),
  );

  Future<void> markPaid(
    PayoutWeek week, {
    String method = 'zelle',
    String reference = '',
  }) async {
    await _call(payoutPaidPayload(week, method, reference));
  }
}
