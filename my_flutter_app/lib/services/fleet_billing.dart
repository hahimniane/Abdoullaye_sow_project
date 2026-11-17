// Fleet billing rules (docs/FLEET.md section 3), mirrored from
// functions/fleet_billing.js and admin_web/src/lib/fleet-billing.ts, and run
// against the same shared fixture (functions/test/fixtures/
// fleet-billing-cases.json), so the phone shows exactly what the server will
// bill. Pure: no clock of its own.

import 'fleet_models.dart';

const _monthsEn = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

class FleetRentPeriod {
  const FleetRentPeriod(this.periodFrom, this.periodTo, this.dueDayKey);

  final String periodFrom, periodTo, dueDayKey;

  @override
  bool operator ==(Object other) =>
      other is FleetRentPeriod &&
      other.periodFrom == periodFrom &&
      other.periodTo == periodTo &&
      other.dueDayKey == dueDayKey;

  @override
  int get hashCode => Object.hash(periodFrom, periodTo, dueDayKey);

  @override
  String toString() => '$periodFrom..$periodTo due $dueDayKey';
}

class FleetBillingSettings {
  const FleetBillingSettings({
    this.returnRule = 'full',
    this.lateFeeCents = 0,
    this.lateFeeDay = 0,
    this.lateFeeFirstMonth = '',
  });

  /// The server's `fleet.settings` map (or the fixture's `settings`).
  factory FleetBillingSettings.fromMap(Map<String, dynamic>? m) {
    final fee = m?['lateFee'];
    int n(Object? v) => v is num ? v.round() : int.tryParse('$v') ?? 0;
    return FleetBillingSettings(
      returnRule: m?['returnRule'] == 'days' ? 'days' : 'full',
      lateFeeCents: fee is Map ? n(fee['cents']) : 0,
      lateFeeDay: fee is Map ? n(fee['dayOfMonth']) : 0,
      lateFeeFirstMonth: fee is Map ? '${fee['firstMonth'] ?? ''}' : '',
    );
  }

  final String returnRule;
  final int lateFeeCents, lateFeeDay;
  final String lateFeeFirstMonth;
}

/// The rent periods from the start to the period holding [throughDayKey]
/// (or the end day first).
List<FleetRentPeriod> fleetRentPeriods(
  FleetAssignment a,
  String throughDayKey,
) {
  final s = a.startDayKey.split('-').map(int.parse).toList();
  final stop =
      a.endDayKey.isNotEmpty && a.endDayKey.compareTo(throughDayKey) < 0
      ? a.endDayKey
      : throughDayKey;
  final out = <FleetRentPeriod>[];
  for (var k = 0; k < 10000; k++) {
    String from, to, due;
    if (a.period == 'weekly') {
      final f = fleetDayNumber(a.startDayKey) + 7 * k;
      from = fleetDayKeyOf(f);
      to = fleetDayKeyOf(f + 6);
      final weekday = ((((f + 3) % 7) + 7) % 7) + 1;
      due = fleetDayKeyOf(f + ((a.dueDay - weekday + 7) % 7));
    } else {
      from = fleetMonthDay(s[0], s[1] + k, s[2]);
      final next = fleetMonthDay(s[0], s[1] + k + 1, s[2]);
      to = fleetDayKeyOf(fleetDayNumber(next) - 1);
      final f = from.split('-').map(int.parse).toList();
      due = fleetMonthDay(f[0], f[1], a.dueDay);
    }
    if (from.compareTo(stop) > 0) break;
    out.add(FleetRentPeriod(from, to, due));
  }
  return out;
}

/// Rent bills not yet created, through a day. Idempotent by bill id. The
/// period cut by the end day follows the return rule ("days": pro rata).
List<Map<String, Object?>> fleetRentBillsToCreate(
  FleetAssignment a,
  Iterable<String> existingBillIds,
  String throughDayKey, [
  FleetBillingSettings? settings,
]) {
  final have = existingBillIds.toSet();
  final days = settings != null && settings.returnRule == 'days';
  final out = <Map<String, Object?>>[];
  for (final p in fleetRentPeriods(a, throughDayKey)) {
    final id = '${a.id}_${p.periodFrom}';
    if (have.contains(id)) continue;
    var amount = a.rentCents;
    if (days &&
        a.endDayKey.isNotEmpty &&
        a.endDayKey.compareTo(p.periodFrom) >= 0 &&
        a.endDayKey.compareTo(p.periodTo) < 0) {
      final used =
          fleetDayNumber(a.endDayKey) - fleetDayNumber(p.periodFrom) + 1;
      final total =
          fleetDayNumber(p.periodTo) - fleetDayNumber(p.periodFrom) + 1;
      amount = (amount * used / total).round();
    }
    final f = p.periodFrom.split('-').map(int.parse).toList();
    out.add({
      'id': id,
      'businessId': a.businessId.isEmpty ? null : a.businessId,
      'driverId': a.driverId.isEmpty ? null : a.driverId,
      'carId': a.carId.isEmpty ? null : a.carId,
      'assignmentId': a.id,
      'kind': 'rent',
      'label': a.period == 'weekly'
          ? 'Plate fee week of ${_usDate(p.periodFrom)}'
          : 'Plate fee ${_monthsEn[f[1] - 1]} ${f[0]}',
      'periodFrom': p.periodFrom,
      'periodTo': p.periodTo,
      'dueDayKey': p.dueDayKey,
      'amountCents': amount,
      'paidCents': 0,
      'status': 'open',
    });
  }
  return out;
}

String _usDate(String key) {
  final p = key.split('-').map(int.parse).toList();
  return '${_monthsEn[p[1] - 1]} ${p[2]}, ${p[0]}';
}

/// Late fees to create: one per open, unpaid rent bill whose fee day has come
/// (the office's day of the due month, or of the next month when the bill is
/// due after it), from the first month on, with no late fee yet.
List<Map<String, Object?>> fleetLateFeesToCreate(
  List<FleetBill> bills,
  FleetBillingSettings settings,
  String todayKey,
) {
  if (settings.lateFeeCents <= 0 ||
      settings.lateFeeDay < 1 ||
      settings.lateFeeFirstMonth.isEmpty) {
    return const [];
  }
  final charged = {
    for (final b in bills)
      if (b.kind == 'late_fee') b.lateFeeForBillId,
  };
  final out = <Map<String, Object?>>[];
  for (final b in bills) {
    if (b.kind != 'rent' || b.status != 'open' || b.remainingCents <= 0) {
      continue;
    }
    if (b.dueDayKey.isEmpty || charged.contains(b.id)) continue;
    if (b.dueDayKey.substring(0, 7).compareTo(settings.lateFeeFirstMonth) < 0) {
      continue;
    }
    final due = b.dueDayKey.split('-').map(int.parse).toList();
    var fee = fleetMonthDay(due[0], due[1], settings.lateFeeDay);
    if (b.dueDayKey.compareTo(fee) > 0) {
      fee = fleetMonthDay(due[0], due[1] + 1, settings.lateFeeDay);
    }
    if (todayKey.compareTo(fee) < 0) continue;
    out.add({
      'id': '${b.id}_late',
      'businessId': b.businessId.isEmpty ? null : b.businessId,
      'driverId': b.driverId.isEmpty ? null : b.driverId,
      'carId': b.carId.isEmpty ? null : b.carId,
      'assignmentId': b.assignmentId.isEmpty ? null : b.assignmentId,
      'kind': 'late_fee',
      'label': 'Late fee — ${b.label.isEmpty ? 'Plate fee' : b.label}',
      'periodFrom': b.periodFrom.isEmpty ? null : b.periodFrom,
      'periodTo': b.periodTo.isEmpty ? null : b.periodTo,
      'dueDayKey': fee,
      'amountCents': settings.lateFeeCents,
      'paidCents': 0,
      'status': 'open',
      'lateFeeForBillId': b.id,
    });
  }
  return out;
}

class FleetAllocation {
  const FleetAllocation(this.billId, this.cents);

  final String billId;
  final int cents;

  @override
  bool operator ==(Object other) =>
      other is FleetAllocation &&
      other.billId == billId &&
      other.cents == cents;

  @override
  int get hashCode => Object.hash(billId, cents);

  @override
  String toString() => '$billId:$cents';
}

/// Late fees first, then everything else; each by due day then id.
List<FleetBill> _payOrder(Iterable<FleetBill> bills) {
  int rank(FleetBill b) => b.kind == 'late_fee' ? 0 : 1;
  final open =
      bills.where((b) => b.status == 'open' && b.remainingCents > 0).toList()
        ..sort((x, y) {
          final r = rank(x) - rank(y);
          if (r != 0) return r;
          final d = x.dueDayKey.compareTo(y.dueDayKey);
          return d != 0 ? d : x.id.compareTo(y.id);
        });
  return open;
}

(List<FleetAllocation>, int) _spend(Iterable<FleetBill> bills, int cents) {
  var left = cents < 0 ? 0 : cents;
  final out = <FleetAllocation>[];
  for (final b in _payOrder(bills)) {
    if (left <= 0) break;
    final pay = left < b.remainingCents ? left : b.remainingCents;
    out.add(FleetAllocation(b.id, pay));
    left -= pay;
  }
  return (out, left);
}

class FleetPaymentPlan {
  const FleetPaymentPlan({
    required this.ok,
    this.reason = '',
    this.allocations = const [],
    this.creditAddedCents = 0,
  });

  final bool ok;
  final String reason;
  final List<FleetAllocation> allocations;
  final int creditAddedCents;
}

/// Spreads a payment over open bills (late fees first, then oldest due); the
/// leftover becomes driver credit. An amount of zero or less is refused
/// (`fleet_no_amount`).
FleetPaymentPlan fleetAllocatePayment(
  Iterable<FleetBill> openBills,
  int amountCents,
) {
  if (amountCents <= 0) {
    return const FleetPaymentPlan(ok: false, reason: 'fleet_no_amount');
  }
  final (allocations, left) = _spend(openBills, amountCents);
  return FleetPaymentPlan(
    ok: true,
    allocations: allocations,
    creditAddedCents: left,
  );
}

/// Uses a driver's credit on open bills, in the same order as a payment.
({List<FleetAllocation> allocations, int creditLeftCents}) fleetApplyCredit(
  Iterable<FleetBill> openBills,
  int creditCents,
) {
  final (allocations, left) = _spend(openBills, creditCents);
  return (allocations: allocations, creditLeftCents: left);
}

class FleetBalance {
  const FleetBalance({
    required this.owedCents,
    required this.lateCents,
    required this.creditCents,
    this.nextDueDayKey = '',
    this.nextDueCents = 0,
  });

  final int owedCents, lateCents, creditCents, nextDueCents;

  /// The soonest bill due today or later; '' when there is none.
  final String nextDueDayKey;

  bool get hasNextDue => nextDueDayKey.isNotEmpty;
}

/// What a driver owes now. Waived, void and paid bills do not count; "late"
/// is what is past its due day.
FleetBalance fleetDriverBalance(
  Iterable<FleetBill> bills,
  int creditCents,
  String todayKey,
) {
  var owed = 0;
  var late = 0;
  String? nextDay;
  var nextCents = 0;
  for (final b in bills) {
    if (b.status != 'open') continue;
    final r = b.remainingCents;
    if (r <= 0) continue;
    owed += r;
    if (b.dueDayKey.compareTo(todayKey) < 0) {
      late += r;
    } else if (nextDay == null || b.dueDayKey.compareTo(nextDay) < 0) {
      nextDay = b.dueDayKey;
      nextCents = r;
    } else if (b.dueDayKey == nextDay) {
      nextCents += r;
    }
  }
  return FleetBalance(
    owedCents: owed,
    lateCents: late,
    creditCents: creditCents < 0 ? 0 : creditCents,
    nextDueDayKey: nextDay ?? '',
    nextDueCents: nextCents,
  );
}

/// Personal cents (1-99, unique) for active drivers. A driver holding a valid
/// value nobody earlier holds keeps it; the others get the lowest free value
/// (oldest first). Beyond 99 drivers the extra get null.
Map<String, int?> fleetAssignPersonalCents(
  List<({String id, num? personalCents, num createdAt})> activeDrivers,
) {
  final ordered = [...activeDrivers]
    ..sort((x, y) {
      final t = x.createdAt.compareTo(y.createdAt);
      return t != 0 ? t : x.id.compareTo(y.id);
    });
  final taken = <int>{};
  final result = <String, int?>{};
  for (final d in ordered) {
    final v = d.personalCents;
    if (v != null &&
        v == v.truncate() &&
        v >= 1 &&
        v <= 99 &&
        !taken.contains(v.toInt())) {
      taken.add(v.toInt());
      result[d.id] = v.toInt();
    }
  }
  var next = 1;
  for (final d in ordered) {
    if (result.containsKey(d.id)) continue;
    while (next <= 99 && taken.contains(next)) {
      next++;
    }
    if (next > 99) {
      result[d.id] = null;
    } else {
      taken.add(next);
      result[d.id] = next;
    }
  }
  return result;
}

/// Who had the car on a day: the assigned driver and the friend who drove it.
({String? driverId, String? substituteId}) fleetWhoDroveAt(
  Iterable<FleetAssignment> assignments,
  Iterable<FleetFriend> substitutes,
  String carId,
  String dayKey,
) {
  FleetAssignment? a;
  for (final x in assignments) {
    if (x.carId == carId &&
        x.startDayKey.compareTo(dayKey) <= 0 &&
        (x.endDayKey.isEmpty || x.endDayKey.compareTo(dayKey) >= 0)) {
      a = x;
      break;
    }
  }
  if (a == null) return (driverId: null, substituteId: null);
  FleetFriend? s;
  for (final x in substitutes) {
    if (x.carId == carId &&
        !x.voided &&
        x.fromDayKey.compareTo(dayKey) <= 0 &&
        x.toDayKey.compareTo(dayKey) >= 0) {
      s = x;
      break;
    }
  }
  return (driverId: a.driverId, substituteId: s?.id);
}
