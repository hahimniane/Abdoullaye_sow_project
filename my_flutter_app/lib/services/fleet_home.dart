// The Fleet page's "Needs you" list (docs/FLEET.md section 15), ported from
// admin_web/src/lib/fleet-home.ts (`needsItems`, `idlePlates`). Pure: no
// Firebase, no clock of its own. Built once per input, never per row.
//
// Not in the app (the web has them): plate fees on a plate marked "retired"
// (the app does not read a car's status, so a retired plate looks like any
// other), and the header search with "who had this plate on this day".

import 'fleet_claims.dart';
import 'fleet_models.dart';
import 'fleet_requests.dart';
import 'fleet_views.dart';

/// Paperwork shows in Needs you this many days before it runs out.
const fleetNeedsPaperDays = 30;

/// Which of a plate's two papers.
enum FleetPaper { diamond, registration }

/// One thing the office must do. Most money first ([weightCents]).
sealed class FleetNeedsItem {
  const FleetNeedsItem({required this.key, required this.weightCents});

  final String key;
  final int weightCents;
}

/// The bank took a deposit back that a payment was recorded from.
class FleetNeedsRemoved extends FleetNeedsItem {
  const FleetNeedsRemoved({
    required super.key,
    required super.weightCents,
    required this.driverId,
    required this.name,
    required this.amountCents,
    required this.dayKey,
  });

  final String driverId, name, dayKey;
  final int amountCents;
}

/// A driver's payment screenshot the office has to decide.
class FleetNeedsClaim extends FleetNeedsItem {
  const FleetNeedsClaim({
    required super.key,
    required super.weightCents,
    required this.claimId,
    required this.driverId,
    required this.name,
    required this.amountCents,
    required this.match,
  });

  final String claimId, name;

  /// '' until the claim names a driver.
  final String driverId;
  final int? amountCents;

  /// A deposit of the same amount is waiting.
  final bool match;
}

/// A deposit nobody has been paid from yet.
class FleetNeedsDeposit extends FleetNeedsItem {
  const FleetNeedsDeposit({
    required super.key,
    required super.weightCents,
    required this.depositId,
    required this.senderName,
    required this.amountCents,
    required this.dayKey,
  });

  final String depositId, senderName, dayKey;
  final int amountCents;
}

/// A driver who owes something that is already late.
class FleetNeedsLate extends FleetNeedsItem {
  const FleetNeedsLate({
    required super.key,
    required super.weightCents,
    required this.driverId,
    required this.name,
    required this.plate,
    required this.owedCents,
    required this.lateCents,
    required this.active,
  });

  final String driverId, name, plate;
  final int owedCents, lateCents;
  final bool active;
}

/// A plate with no driver now: it earns nothing.
class FleetNeedsIdle extends FleetNeedsItem {
  const FleetNeedsIdle({
    required super.key,
    required super.weightCents,
    required this.carId,
    required this.plate,
    required this.idleDays,
    required this.missedCents,
  });

  final String carId, plate;

  /// Null when no driver ever had it.
  final int? idleDays;

  /// The last plate fee, prorated over the idle days; 0 when unknown.
  final int missedCents;
}

/// A diamond or registration date that is past or within
/// [fleetNeedsPaperDays] days.
class FleetNeedsPaper extends FleetNeedsItem {
  const FleetNeedsPaper({
    required super.key,
    required super.weightCents,
    required this.carId,
    required this.plate,
    required this.paper,
    required this.dayKey,
    required this.daysLeft,
    required this.driverName,
  });

  final String carId, plate, dayKey, driverName;
  final FleetPaper paper;

  /// Negative once it ran out.
  final int daysLeft;
}

/// One line for every paperwork date nobody entered.
class FleetNeedsMissingPaper extends FleetNeedsItem {
  const FleetNeedsMissingPaper({required this.count})
    : super(key: 'missing-paper', weightCents: -1);

  final int count;
}

final _dayKeyPattern = RegExp(r'^\d{4}-\d{2}-\d{2}$');

/// What the office must do, most money first. Bank take-backs and claims the
/// office has to decide come first at equal money because money already
/// moved. Paperwork carries no money, so it sorts after anything owed.
///
/// [claims] are the open claims (empty while they load); [bank] is
/// `bank_status`, null while it loads or when it failed; [driverRows] may be
/// passed in when the caller already has them.
List<FleetNeedsItem> fleetNeedsItems({
  required FleetData data,
  required FleetIndex index,
  required String todayKey,
  Iterable<FleetClaim> claims = const [],
  FleetBankStatus? bank,
  List<FleetDriverRow>? driverRows,
}) {
  final items = <FleetNeedsItem>[];
  String nameOf(String id) => index.driverById[id]?.name ?? '';
  final waiting = [
    for (final w in bank?.waiting ?? const <FleetWaitingDeposit>[])
      if (!w.pending) w,
  ];
  final waitingAmounts = {for (final w in waiting) w.amountCents};

  for (final r in bank?.removed ?? const <FleetRemovedDeposit>[]) {
    items.add(
      FleetNeedsRemoved(
        key: 'removed-${r.paymentId}',
        weightCents: r.amountCents + 2,
        driverId: r.driverId,
        name: nameOf(r.driverId),
        amountCents: r.amountCents,
        dayKey: r.paidDayKey,
      ),
    );
  }
  for (final c in claims) {
    if (!isOpenFleetClaim(c)) continue;
    final amount = c.amountCents;
    final match = amount != null && waitingAmounts.contains(amount);
    // A claim still talking to the driver is not the office's yet.
    if (c.state != FleetClaimState.office &&
        !(c.state == FleetClaimState.waitingBank && match)) {
      continue;
    }
    final driverId = c.driverId ?? '';
    final name = nameOf(driverId);
    items.add(
      FleetNeedsClaim(
        key: 'claim-${c.id}',
        weightCents: (amount ?? 0) + 1,
        claimId: c.id,
        driverId: driverId,
        name: name.isNotEmpty
            ? name
            : (c.fromPhone.isEmpty ? '—' : c.fromPhone),
        amountCents: amount,
        match: match,
      ),
    );
  }
  for (final w in waiting) {
    items.add(
      FleetNeedsDeposit(
        key: 'deposit-${w.id}',
        weightCents: w.amountCents,
        depositId: w.id,
        senderName: w.senderName,
        amountCents: w.amountCents,
        dayKey: w.dateKey,
      ),
    );
  }
  for (final d in driverRows ?? fleetDriverRows(data, index, todayKey)) {
    if (d.lateCents <= 0) continue;
    items.add(
      FleetNeedsLate(
        key: 'late-${d.id}',
        weightCents: d.owedCents,
        driverId: d.id,
        name: d.name,
        plate: d.plate,
        owedCents: d.owedCents,
        lateCents: d.lateCents,
        active: d.active,
      ),
    );
  }
  for (final p in fleetIdlePlates(data, index, todayKey)) {
    items.add(
      FleetNeedsIdle(
        key: 'idle-${p.carId}',
        weightCents: p.missedCents,
        carId: p.carId,
        plate: p.plate,
        idleDays: p.idleDays,
        missedCents: p.missedCents,
      ),
    );
  }
  var missing = 0;
  for (final car in data.cars) {
    final current = index.currentByCar[car.id];
    final driverName = current == null ? '' : nameOf(current.driverId);
    for (final paper in FleetPaper.values) {
      final dayKey = paper == FleetPaper.diamond
          ? car.diamondExpiry
          : car.registrationExpiry;
      final state = fleetExpiryState(
        dayKey,
        todayKey,
        soonDays: fleetNeedsPaperDays,
      );
      if (state == FleetExpiry.missing) {
        missing += 1;
        continue;
      }
      if (state == FleetExpiry.ok) continue;
      items.add(
        FleetNeedsPaper(
          key: 'paper-${car.id}-${paper.name}',
          weightCents: 0,
          carId: car.id,
          plate: car.plate,
          paper: paper,
          dayKey: dayKey,
          daysLeft: fleetDaysBetween(todayKey, dayKey),
          driverName: driverName,
        ),
      );
    }
  }
  if (missing > 0) items.add(FleetNeedsMissingPaper(count: missing));

  // Among equal money (paperwork has none), a deadline comes before a plate
  // never given out, the soonest first.
  int order(FleetNeedsItem i) =>
      i is FleetNeedsPaper ? 1000000 - i.daysLeft : 0;
  items.sort((a, b) {
    final w = b.weightCents - a.weightCents;
    if (w != 0) return w;
    final o = order(b) - order(a);
    return o != 0 ? o : a.key.compareTo(b.key);
  });
  return items;
}

/// The number on the Needs you tab.
int fleetNeedsCount(List<FleetNeedsItem> items) => items.length;

/// A plate with no driver now.
class FleetIdlePlate {
  const FleetIdlePlate({
    required this.carId,
    required this.plate,
    required this.idleDays,
    required this.missedCents,
  });

  final String carId, plate;
  final int? idleDays;
  final int missedCents;
}

/// Plates with no driver now, the longest idle (most rent missed) first.
List<FleetIdlePlate> fleetIdlePlates(
  FleetData data,
  FleetIndex index,
  String todayKey,
) {
  final out = <FleetIdlePlate>[];
  for (final car in data.cars) {
    if (index.currentByCar.containsKey(car.id)) continue;
    final past = [
      for (final a
          in index.assignmentsByCar[car.id] ?? const <FleetAssignment>[])
        if (_dayKeyPattern.hasMatch(a.endDayKey)) a,
    ]..sort((a, b) => b.endDayKey.compareTo(a.endDayKey));
    final last = past.isEmpty ? null : past.first;
    final idle = last == null
        ? null
        : fleetDaysBetween(last.endDayKey, todayKey).clamp(0, 1 << 30);
    final rent = last == null || last.rentCents < 0 ? 0 : last.rentCents;
    final perDay = last?.period == 'weekly' ? rent / 7 : rent / 30;
    out.add(
      FleetIdlePlate(
        carId: car.id,
        plate: car.plate,
        idleDays: idle,
        missedCents: idle == null ? 0 : (perDay * idle).round(),
      ),
    );
  }
  out.sort((a, b) {
    final m = b.missedCents - a.missedCents;
    if (m != 0) return m;
    final d = (b.idleDays ?? -1) - (a.idleDays ?? -1);
    return d != 0 ? d : a.plate.compareTo(b.plate);
  });
  return out;
}
