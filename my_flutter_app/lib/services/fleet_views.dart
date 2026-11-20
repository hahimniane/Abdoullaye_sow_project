// What the Fleet screens show, worked out once per snapshot (never per row or
// per build): the payments by period, driver and car rows with their filters,
// paperwork, a driver's tenure and track record, the tiles. Mirrors
// admin_web/src/lib/fleet.ts. Pure.

import 'fleet_billing.dart';
import 'fleet_models.dart';

String _lower(Object? v) => (v ?? '').toString().trim().toLowerCase();

/// Whether a lowercase haystack holds every word typed.
bool fleetMatchesSearch(String haystack, String needle) {
  final words = needle
      .trim()
      .toLowerCase()
      .split(RegExp(r'\s+'))
      .where((w) => w.isNotEmpty);
  return words.every(haystack.contains);
}

int _byName(String a, String b) => a.toLowerCase().compareTo(b.toLowerCase());

// ---------------------------------------------------------------------------
// Payments by period.
// ---------------------------------------------------------------------------

enum FleetPeriodKind { week, month }

/// A week (Monday to Sunday) or a calendar month, as inclusive day keys.
class FleetPeriod {
  const FleetPeriod(this.kind, this.from, this.to);

  final FleetPeriodKind kind;
  final String from, to;

  bool contains(String dayKey) =>
      dayKey.compareTo(from) >= 0 && dayKey.compareTo(to) <= 0;

  @override
  bool operator ==(Object other) =>
      other is FleetPeriod &&
      other.kind == kind &&
      other.from == from &&
      other.to == to;

  @override
  int get hashCode => Object.hash(kind, from, to);

  @override
  String toString() => '$kind $from..$to';
}

/// The period of [kind] holding [dayKey].
FleetPeriod fleetPeriodContaining(FleetPeriodKind kind, String dayKey) {
  if (kind == FleetPeriodKind.week) {
    final from = fleetAddDays(dayKey, -(fleetWeekday(dayKey) - 1));
    return FleetPeriod(kind, from, fleetAddDays(from, 6));
  }
  final m = fleetMonthOf(dayKey);
  final y = int.parse(m.substring(0, 4));
  final mo = int.parse(m.substring(5, 7));
  final last = fleetDayKeyOf(fleetDayNumber(fleetMonthDay(y, mo + 1, 1)) - 1);
  return FleetPeriod(kind, '$m-01', last);
}

/// The period [n] steps before (negative n) or after this one.
FleetPeriod fleetShiftPeriod(FleetPeriod p, int n) {
  if (p.kind == FleetPeriodKind.week) {
    final from = fleetAddDays(p.from, 7 * n);
    return FleetPeriod(p.kind, from, fleetAddDays(from, 6));
  }
  return fleetPeriodContaining(
    p.kind,
    '${fleetShiftMonth(fleetMonthOf(p.from), n)}-01',
  );
}

enum FleetCellState { full, part, owed, none }

/// One driver in a period: what they paid, what their bills asked for, and
/// how that stands.
class FleetPeriodRow {
  const FleetPeriodRow({
    required this.driverId,
    required this.name,
    required this.plate,
    required this.active,
    required this.paidCents,
    required this.dueCents,
    required this.billPaidCents,
    required this.state,
    required this.extraOwedCents,
    required this.owedCents,
    required this.lateCents,
    required this.search,
  });

  final String driverId, name, plate, search;
  final bool active;

  /// Recorded payments with a paid day in the period.
  final int paidCents;

  /// Rent bills due in the period (waived and void left out) and what is paid
  /// on them.
  final int dueCents, billPaidCents;

  /// The colour of the period, from its rent bill alone: paid in full, part
  /// or owed by the bill's own `paidCents` against its amount. With no rent
  /// bill (imported history) it is paid when payments landed and empty when
  /// none did.
  final FleetCellState state;

  /// Late fees and charges still owed that fall due in the period. Shown
  /// apart ("+ fee owed") and never turns the colour; a period that carries
  /// one counts as "Owes" in the filters.
  final int extraOwedCents;

  /// Everything the driver owes right now, and the part past due.
  final int owedCents, lateCents;
}

class FleetPeriodGrid {
  const FleetPeriodGrid(this.rows, this.paidCents, this.dueCents);

  final List<FleetPeriodRow> rows;
  final int paidCents, dueCents;
}

/// One row per driver for the period. A driver who left shows only when they
/// have something in it.
FleetPeriodGrid fleetPeriodRows(
  FleetData data,
  FleetIndex index,
  FleetPeriod period,
  String todayKey,
) {
  final paid = <String, int>{};
  for (final p in data.payments) {
    if (!p.isRecorded || !period.contains(p.paidDayKey)) continue;
    paid[p.driverId] = (paid[p.driverId] ?? 0) + p.amountCents;
  }
  final due = <String, int>{};
  final duePaid = <String, int>{};
  final extra = <String, int>{};
  for (final b in data.bills) {
    if (b.status == 'void' || b.status == 'waived') continue;
    if (!period.contains(b.dueDayKey)) continue;
    if (b.kind == 'rent') {
      due[b.driverId] = (due[b.driverId] ?? 0) + b.amountCents;
      duePaid[b.driverId] = (duePaid[b.driverId] ?? 0) + b.paidCents;
    } else {
      extra[b.driverId] = (extra[b.driverId] ?? 0) + b.remainingCents;
    }
  }
  final rows = <FleetPeriodRow>[];
  var totalPaid = 0;
  var totalDue = 0;
  for (final d in data.drivers) {
    final p = paid[d.id] ?? 0;
    final dueCents = due[d.id] ?? 0;
    final billPaid = duePaid[d.id] ?? 0;
    final extraOwed = extra[d.id] ?? 0;
    var state = FleetCellState.none;
    if (dueCents > 0) {
      state = billPaid >= dueCents
          ? FleetCellState.full
          : (billPaid > 0 ? FleetCellState.part : FleetCellState.owed);
    } else if (p > 0) {
      state = FleetCellState.full;
    }
    if (!d.isActive && p == 0 && dueCents == 0 && extraOwed == 0) continue;
    final current = index.currentByDriver[d.id];
    final plate = current == null
        ? ''
        : index.carById[current.carId]?.plate ?? '';
    final balance = fleetDriverBalance(
      index.billsByDriver[d.id] ?? const [],
      d.creditCents,
      todayKey,
    );
    totalPaid += p;
    totalDue += dueCents;
    rows.add(
      FleetPeriodRow(
        driverId: d.id,
        name: d.name,
        plate: plate,
        active: d.isActive,
        paidCents: p,
        dueCents: dueCents,
        billPaidCents: billPaid,
        state: state,
        extraOwedCents: extraOwed,
        owedCents: balance.owedCents,
        lateCents: balance.lateCents,
        search: _lower('${d.name} ${d.phone} $plate'),
      ),
    );
  }
  rows.sort((a, b) => _byName(a.name, b.name));
  return FleetPeriodGrid(rows, totalPaid, totalDue);
}

enum FleetDriverView { active, left, all }

enum FleetPeriodSort { name, owed, paid }

class FleetPaymentsFilter {
  const FleetPaymentsFilter({
    this.view = FleetDriverView.active,
    this.state,
    this.late = false,
    this.query = '',
    this.sort = FleetPeriodSort.name,
  });

  final FleetDriverView view;

  /// Only drivers whose period reads owed / part / full.
  final FleetCellState? state;
  final bool late;
  final String query;
  final FleetPeriodSort sort;

  FleetPaymentsFilter copyWith({
    FleetDriverView? view,
    FleetCellState? state,
    bool clearState = false,
    bool? late,
    String? query,
    FleetPeriodSort? sort,
  }) => FleetPaymentsFilter(
    view: view ?? this.view,
    state: clearState ? null : (state ?? this.state),
    late: late ?? this.late,
    query: query ?? this.query,
    sort: sort ?? this.sort,
  );

  bool get narrowed => state != null || late || query.trim().isNotEmpty;
}

/// The chip a period row answers to: a period whose plate fee is paid but
/// which still carries a late fee or a charge is owed, not paid, so every
/// driver is in exactly one of Owes / Part paid / Paid in full.
FleetCellState fleetFilterStateOf(FleetPeriodRow r) =>
    r.state == FleetCellState.full && r.extraOwedCents > 0
    ? FleetCellState.owed
    : r.state;

bool _inView(bool active, FleetDriverView v) => switch (v) {
  FleetDriverView.active => active,
  FleetDriverView.left => !active,
  FleetDriverView.all => true,
};

/// The rows on screen: the view, the chips, the search, in the chosen order.
List<FleetPeriodRow> fleetFilterPeriodRows(
  List<FleetPeriodRow> rows,
  FleetPaymentsFilter f,
) {
  final query = f.query.trim();
  final out = rows
      .where(
        (r) =>
            _inView(r.active, f.view) &&
            (f.state == null || fleetFilterStateOf(r) == f.state) &&
            (!f.late || r.lateCents > 0) &&
            (query.isEmpty || fleetMatchesSearch(r.search, query)),
      )
      .toList();
  switch (f.sort) {
    case FleetPeriodSort.owed:
      out.sort((a, b) {
        final c = b.owedCents - a.owedCents;
        return c != 0 ? c : _byName(a.name, b.name);
      });
    case FleetPeriodSort.paid:
      out.sort((a, b) {
        final c = b.paidCents - a.paidCents;
        return c != 0 ? c : _byName(a.name, b.name);
      });
    case FleetPeriodSort.name:
      out.sort((a, b) => _byName(a.name, b.name));
  }
  return out;
}

class FleetPeriodCounts {
  const FleetPeriodCounts({
    required this.active,
    required this.left,
    required this.all,
    required this.owed,
    required this.part,
    required this.paid,
    required this.late,
  });

  final int active, left, all, owed, part, paid, late;
}

FleetPeriodCounts fleetPeriodCounts(
  List<FleetPeriodRow> rows,
  FleetDriverView view,
) {
  final inView = rows.where((r) => _inView(r.active, view)).toList();
  int n(bool Function(FleetPeriodRow) test) => inView.where(test).length;
  return FleetPeriodCounts(
    active: rows.where((r) => r.active).length,
    left: rows.where((r) => !r.active).length,
    all: rows.length,
    owed: n((r) => fleetFilterStateOf(r) == FleetCellState.owed),
    part: n((r) => fleetFilterStateOf(r) == FleetCellState.part),
    paid: n((r) => fleetFilterStateOf(r) == FleetCellState.full),
    late: n((r) => r.lateCents > 0),
  );
}

// ---------------------------------------------------------------------------
// Tiles.
// ---------------------------------------------------------------------------

class FleetTiles {
  const FleetTiles({
    required this.collectedCents,
    required this.owedCents,
    required this.lateDrivers,
    required this.lateCents,
    required this.owingDrivers,
    required this.plateFeesBilledCents,
    required this.plateFeesPaidCents,
  });

  final int collectedCents, owedCents, lateCents;

  /// What this month's plate-fee (rent) bills ask for (waived and void left
  /// out), and what has been paid on those same bills.
  final int plateFeesBilledCents, plateFeesPaidCents;
  final int lateDrivers, owingDrivers;
}

/// Collected this month, owed now, and how many drivers have a late bill.
FleetTiles fleetTiles(FleetData data, FleetIndex index, String todayKey) {
  final month = fleetMonthOf(todayKey);
  var collected = 0;
  for (final p in data.payments) {
    if (p.isRecorded && fleetMonthOf(p.paidDayKey) == month) {
      collected += p.amountCents;
    }
  }
  var owed = 0, late = 0, lateCents = 0, owing = 0;
  for (final d in data.drivers) {
    final b = fleetDriverBalance(
      index.billsByDriver[d.id] ?? const [],
      d.creditCents,
      todayKey,
    );
    owed += b.owedCents;
    if (b.owedCents > 0) owing++;
    if (b.lateCents > 0) {
      late++;
      lateCents += b.lateCents;
    }
  }
  // The plate-fee bills due this month that stand: what they ask for and what
  // has been paid on them. Late fees, charges and old debts paid this month
  // are not part of this share.
  var billed = 0, billedPaid = 0;
  for (final b in data.bills) {
    if (b.kind != 'rent' || b.status == 'waived' || b.status == 'void') {
      continue;
    }
    if (fleetMonthOf(b.dueDayKey) != month) continue;
    billed += b.amountCents;
    billedPaid += b.paidCents;
  }
  return FleetTiles(
    collectedCents: collected,
    owedCents: owed,
    lateDrivers: late,
    lateCents: lateCents,
    owingDrivers: owing,
    plateFeesBilledCents: billed,
    plateFeesPaidCents: billedPaid < billed ? billedPaid : billed,
  );
}

/// The paid share of this month's plate-fee bills with both amounts, so it
/// cannot be read as collected-over-billed. [percent] is whole, [paidCents]
/// never above [billedCents].
({int percent, int paidCents, int billedCents}) fleetPlateFeesShare(
  int billedCents,
  int paidCents,
) {
  final billed = billedCents < 0 ? 0 : billedCents;
  final paid = paidCents < 0 ? 0 : (paidCents > billed ? billed : paidCents);
  final percent = billed > 0 ? (paid * 100 / billed).round() : 0;
  return (percent: percent, paidCents: paid, billedCents: billed);
}

// ---------------------------------------------------------------------------
// Drivers.
// ---------------------------------------------------------------------------

class FleetDriverRow {
  const FleetDriverRow({
    required this.id,
    required this.name,
    required this.phone,
    required this.active,
    required this.plate,
    required this.carId,
    required this.owedCents,
    required this.lateCents,
    required this.creditCents,
    required this.rentCents,
    required this.search,
  });

  final String id, name, phone, plate, carId, search;
  final bool active;
  final int owedCents, lateCents, creditCents, rentCents;
}

List<FleetDriverRow> fleetDriverRows(
  FleetData data,
  FleetIndex index,
  String todayKey,
) {
  final rows = [
    for (final d in data.drivers)
      () {
        final current = index.currentByDriver[d.id];
        final car = current == null ? null : index.carById[current.carId];
        final plate = car?.plate ?? '';
        final balance = fleetDriverBalance(
          index.billsByDriver[d.id] ?? const [],
          d.creditCents,
          todayKey,
        );
        return FleetDriverRow(
          id: d.id,
          name: d.name,
          phone: d.phone,
          active: d.isActive,
          plate: plate,
          carId: car?.id ?? '',
          owedCents: balance.owedCents,
          lateCents: balance.lateCents,
          creditCents: balance.creditCents,
          rentCents: current == null || current.rentCents < 0
              ? 0
              : current.rentCents,
          search: _lower('${d.name} ${d.phone} $plate'),
        );
      }(),
  ];
  rows.sort((a, b) {
    if (a.active != b.active) return a.active ? -1 : 1;
    return _byName(a.name, b.name);
  });
  return rows;
}

enum FleetDriverSort { name, owed }

class FleetDriverFilter {
  const FleetDriverFilter({
    this.view = FleetDriverView.active,
    this.owes = false,
    this.late = false,
    this.credit = false,
    this.noCar = false,
    this.noFee = false,
    this.query = '',
    this.sort = FleetDriverSort.name,
  });

  final FleetDriverView view;
  final bool owes, late, credit, noCar, noFee;
  final String query;
  final FleetDriverSort sort;

  FleetDriverFilter copyWith({
    FleetDriverView? view,
    bool? owes,
    bool? late,
    bool? credit,
    bool? noCar,
    bool? noFee,
    String? query,
    FleetDriverSort? sort,
  }) => FleetDriverFilter(
    view: view ?? this.view,
    owes: owes ?? this.owes,
    late: late ?? this.late,
    credit: credit ?? this.credit,
    noCar: noCar ?? this.noCar,
    noFee: noFee ?? this.noFee,
    query: query ?? this.query,
    sort: sort ?? this.sort,
  );

  bool get narrowed =>
      owes || late || credit || noCar || noFee || query.trim().isNotEmpty;
}

bool _owes(FleetDriverRow r) => r.owedCents > 0;
bool _late(FleetDriverRow r) => r.lateCents > 0;
bool _credit(FleetDriverRow r) => r.creditCents > 0;
bool _noCar(FleetDriverRow r) => r.active && r.carId.isEmpty;
bool _noFee(FleetDriverRow r) =>
    r.active && r.carId.isNotEmpty && r.rentCents <= 0;

List<FleetDriverRow> fleetFilterDriverRows(
  List<FleetDriverRow> rows,
  FleetDriverFilter f,
) {
  final query = f.query.trim();
  final out = rows
      .where(
        (r) =>
            _inView(r.active, f.view) &&
            (!f.owes || _owes(r)) &&
            (!f.late || _late(r)) &&
            (!f.credit || _credit(r)) &&
            (!f.noCar || _noCar(r)) &&
            (!f.noFee || _noFee(r)) &&
            (query.isEmpty || fleetMatchesSearch(r.search, query)),
      )
      .toList();
  switch (f.sort) {
    case FleetDriverSort.owed:
      out.sort((a, b) {
        final c = b.owedCents - a.owedCents;
        return c != 0 ? c : _byName(a.name, b.name);
      });
    case FleetDriverSort.name:
      out.sort((a, b) => _byName(a.name, b.name));
  }
  return out;
}

class FleetDriverCounts {
  const FleetDriverCounts({
    required this.active,
    required this.left,
    required this.all,
    required this.owes,
    required this.late,
    required this.credit,
    required this.noCar,
    required this.noFee,
  });

  final int active, left, all, owes, late, credit, noCar, noFee;
}

FleetDriverCounts fleetDriverCounts(
  List<FleetDriverRow> rows,
  FleetDriverView view,
) {
  final inView = rows.where((r) => _inView(r.active, view)).toList();
  return FleetDriverCounts(
    active: rows.where((r) => r.active).length,
    left: rows.where((r) => !r.active).length,
    all: rows.length,
    owes: inView.where(_owes).length,
    late: inView.where(_late).length,
    credit: inView.where(_credit).length,
    noCar: inView.where(_noCar).length,
    noFee: inView.where(_noFee).length,
  );
}

// ---------------------------------------------------------------------------
// Cars and paperwork.
// ---------------------------------------------------------------------------

enum FleetExpiry { missing, expired, soon, ok }

final _dayKeyPattern = RegExp(r'^\d{4}-\d{2}-\d{2}$');

/// A car paper's state: past, within [soonDays] days, not entered, or fine.
FleetExpiry fleetExpiryState(
  String dayKey,
  String todayKey, {
  int soonDays = 60,
}) {
  if (!_dayKeyPattern.hasMatch(dayKey)) return FleetExpiry.missing;
  final left = fleetDaysBetween(todayKey, dayKey);
  if (left < 0) return FleetExpiry.expired;
  return left <= soonDays ? FleetExpiry.soon : FleetExpiry.ok;
}

const _severity = {
  FleetExpiry.expired: 0,
  FleetExpiry.soon: 1,
  FleetExpiry.missing: 2,
  FleetExpiry.ok: 3,
};

class FleetCarRow {
  const FleetCarRow({
    required this.id,
    required this.plate,
    required this.company,
    required this.driverId,
    required this.driverName,
    required this.registrationExpiry,
    required this.diamondExpiry,
    required this.registration,
    required this.diamond,
    required this.search,
  });

  final String id, plate, company, driverId, driverName, search;
  final String registrationExpiry, diamondExpiry;
  final FleetExpiry registration, diamond;

  bool get hasDriver => driverId.isNotEmpty;

  /// The worse of the two papers.
  FleetExpiry get worst =>
      _severity[registration]! <= _severity[diamond]! ? registration : diamond;

  /// The earlier of the two entered dates, '' with none.
  String get soonestKey {
    final dates = [
      registrationExpiry,
      diamondExpiry,
    ].where(_dayKeyPattern.hasMatch).toList()..sort();
    return dates.isEmpty ? '' : dates.first;
  }
}

List<FleetCarRow> fleetCarRows(
  FleetData data,
  FleetIndex index,
  String todayKey,
) {
  final rows = [
    for (final c in data.cars)
      () {
        final current = index.currentByCar[c.id];
        final driver = current == null
            ? null
            : index.driverById[current.driverId];
        return FleetCarRow(
          id: c.id,
          plate: c.plate,
          company: c.company,
          driverId: driver?.id ?? '',
          driverName: driver?.name ?? '',
          registrationExpiry: c.registrationExpiry,
          diamondExpiry: c.diamondExpiry,
          registration: fleetExpiryState(c.registrationExpiry, todayKey),
          diamond: fleetExpiryState(c.diamondExpiry, todayKey),
          search: _lower(
            '${c.plate} ${c.company} ${c.vehicleType} ${driver?.name ?? ''}',
          ),
        );
      }(),
  ];
  rows.sort((a, b) => a.plate.compareTo(b.plate));
  return rows;
}

/// Cars by the soonest paper date; cars with no date at all last.
List<FleetCarRow> fleetPaperworkRows(List<FleetCarRow> cars) {
  final rows = [...cars];
  rows.sort((a, b) {
    final aHas = a.soonestKey.isNotEmpty;
    final bHas = b.soonestKey.isNotEmpty;
    if (aHas != bHas) return aHas ? -1 : 1;
    final d = a.soonestKey.compareTo(b.soonestKey);
    return d != 0 ? d : a.plate.compareTo(b.plate);
  });
  return rows;
}

Map<FleetExpiry, int> fleetPaperworkCounts(List<FleetCarRow> rows) {
  final counts = {for (final e in FleetExpiry.values) e: 0};
  for (final r in rows) {
    counts[r.worst] = counts[r.worst]! + 1;
  }
  return counts;
}

enum FleetCarView { all, driver, free }

/// The plates the Paperwork mode counts and lists: those a driver has now (the
/// default) or every plate.
enum FleetPaperworkScope { driver, all }

List<FleetCarRow> fleetCarsInPaperworkScope(
  List<FleetCarRow> rows,
  FleetPaperworkScope scope,
) => scope == FleetPaperworkScope.all
    ? [...rows]
    : [
        for (final r in rows)
          if (r.hasDriver) r,
      ];

class FleetCarFilter {
  const FleetCarFilter({
    this.view = FleetCarView.all,
    this.paper,
    this.query = '',
  });

  final FleetCarView view;

  /// Only cars whose worst paper reads this (expired / soon / missing).
  final FleetExpiry? paper;
  final String query;

  FleetCarFilter copyWith({
    FleetCarView? view,
    FleetExpiry? paper,
    bool clearPaper = false,
    String? query,
  }) => FleetCarFilter(
    view: view ?? this.view,
    paper: clearPaper ? null : (paper ?? this.paper),
    query: query ?? this.query,
  );
}

/// Cars after the view, the paperwork state and the search; by plate, or by
/// the soonest paper when [byExpiry].
List<FleetCarRow> fleetFilterCarRows(
  List<FleetCarRow> rows,
  FleetCarFilter f, {
  bool byExpiry = false,
}) {
  final query = f.query.trim();
  final out = (byExpiry ? fleetPaperworkRows(rows) : [...rows])
      .where(
        (r) =>
            (f.view == FleetCarView.all ||
                (f.view == FleetCarView.driver ? r.hasDriver : !r.hasDriver)) &&
            (f.paper == null || r.worst == f.paper) &&
            (query.isEmpty || fleetMatchesSearch(r.search, query)),
      )
      .toList();
  if (!byExpiry) out.sort((a, b) => a.plate.compareTo(b.plate));
  return out;
}

/// One stretch of a car's life with a driver, newest first in
/// [fleetCarTimeline].
class FleetTimelineEntry {
  const FleetTimelineEntry({
    required this.id,
    required this.driverId,
    required this.driverName,
    required this.startDayKey,
    required this.endDayKey,
    required this.rentCents,
    required this.period,
    required this.friends,
  });

  final String id, driverId, driverName, startDayKey, endDayKey, period;
  final int rentCents;

  /// Friends who drove the car during this assignment (not voided).
  final List<FleetFriend> friends;
}

List<FleetTimelineEntry> fleetCarTimeline(String carId, FleetIndex index) {
  final friends = (index.friendsByCar[carId] ?? const <FleetFriend>[])
      .where((f) => !f.voided)
      .toList();
  final out = [
    for (final a in index.assignmentsByCar[carId] ?? const <FleetAssignment>[])
      FleetTimelineEntry(
        id: a.id,
        driverId: a.driverId,
        driverName: index.driverById[a.driverId]?.name ?? '',
        startDayKey: a.startDayKey,
        endDayKey: a.endDayKey,
        rentCents: a.rentCents,
        period: a.period,
        friends: [
          for (final f in friends)
            if (f.driverId == a.driverId &&
                f.fromDayKey.compareTo(
                      a.endDayKey.isEmpty ? '9999-12-31' : a.endDayKey,
                    ) <=
                    0 &&
                f.toDayKey.compareTo(a.startDayKey) >= 0)
              f,
        ]..sort((x, y) => y.fromDayKey.compareTo(x.fromDayKey)),
      ),
  ];
  out.sort((a, b) => b.startDayKey.compareTo(a.startDayKey));
  return out;
}

/// The car on a plate now (toDayKey '') followed by the cars it was on
/// before, newest first.
class FleetPlateCar {
  const FleetPlateCar({
    required this.vehicleType,
    required this.vin,
    required this.ownership,
    required this.fromDayKey,
    required this.toDayKey,
  });

  final String vehicleType, vin, ownership, fromDayKey, toDayKey;
}

List<FleetPlateCar> fleetPlateCarHistory(FleetCar? car) {
  if (car == null) return const [];
  String t(Object? v) => (v ?? '').toString().trim();
  String owner(Object? v) => t(v) == 'driver' ? 'driver' : 'company';
  final past =
      [
          for (final h in car.vehicleHistory)
            FleetPlateCar(
              vehicleType: t(h['vehicleType']),
              vin: t(h['vin']),
              ownership: owner(h['ownership']),
              fromDayKey: t(h['fromDayKey']),
              toDayKey: t(h['toDayKey']),
            ),
        ].where((h) => h.vehicleType.isNotEmpty || h.vin.isNotEmpty).toList()
        ..sort((a, b) => b.toDayKey.compareTo(a.toDayKey));
  final now = FleetPlateCar(
    vehicleType: car.vehicleType,
    vin: car.vin,
    ownership: car.ownership,
    fromDayKey: car.vehicleSince,
    toDayKey: '',
  );
  return now.vehicleType.isNotEmpty || now.vin.isNotEmpty
      ? [now, ...past]
      : past;
}

/// Cars with no driver now (the ones "Give a plate" may pick).
List<FleetCar> fleetFreeCars(FleetData data, FleetIndex index) {
  final out =
      data.cars.where((c) => !index.currentByCar.containsKey(c.id)).toList()
        ..sort((a, b) => a.plate.compareTo(b.plate));
  return out;
}

// ---------------------------------------------------------------------------
// The driver profile: tenure and the track record.
// ---------------------------------------------------------------------------

/// A gap longer than this between two assignments reads as "left ... back".
const fleetLeftGapDays = 30;

class FleetTenure {
  const FleetTenure(this.joinedDayKey, this.days);

  /// Start of the first assignment, '' when the driver never had a car.
  final String joinedDayKey;

  /// Days a car was assigned (overlaps and gaps do not count).
  final int days;
}

FleetTenure fleetDriverTenure(
  Iterable<FleetAssignment> assignments,
  String todayKey,
) {
  final spans =
      [
            for (final a in assignments)
              (
                from: a.startDayKey,
                to: a.endDayKey.isEmpty ? todayKey : a.endDayKey,
              ),
          ]
          .where((s) => s.from.isNotEmpty && s.to.compareTo(s.from) >= 0)
          .toList()
        ..sort((a, b) => a.from.compareTo(b.from));
  var days = 0;
  var curFrom = '';
  var curTo = '';
  for (final span in spans) {
    if (curFrom.isNotEmpty && span.from.compareTo(curTo) <= 0) {
      if (span.to.compareTo(curTo) > 0) curTo = span.to;
      continue;
    }
    if (curFrom.isNotEmpty) days += fleetDaysBetween(curFrom, curTo);
    curFrom = span.from;
    curTo = span.to;
  }
  if (curFrom.isNotEmpty) days += fleetDaysBetween(curFrom, curTo);
  return FleetTenure(spans.isEmpty ? '' : spans.first.from, days);
}

/// "3 years 2 months" is composed by the screen from these parts.
({int years, int months, int days}) fleetTenureParts(int totalDays) {
  final total = totalDays < 0 ? 0 : totalDays;
  var years = total ~/ 365;
  var months = ((total - years * 365) / 30.4375).floor();
  if (months >= 12) {
    years += 1;
    months = 0;
  }
  return (years: years, months: months, days: total);
}

enum FleetProfileKind {
  joined,
  carGiven,
  carReturned,
  rentChange,
  leftBack,
  license,
  friend,
  lateFee,
  charge,
  waived,
  note,
}

class FleetProfileEntry {
  const FleetProfileEntry({
    required this.kind,
    required this.dayKey,
    this.plate = '',
    this.rentCents = 0,
    this.fromRentCents = 0,
    this.period = '',
    this.leftDayKey = '',
    this.fromDayKey = '',
    this.toDayKey = '',
    this.license = '',
    this.name = '',
    this.label = '',
    this.amountCents = 0,
    this.text = '',
    this.noteId = '',
    this.voided = false,
    this.by = '',
  });

  final FleetProfileKind kind;
  final String dayKey, plate, period, leftDayKey, fromDayKey, toDayKey;
  final String license, name, label, text, noteId, by;
  final int rentCents, fromRentCents, amountCents;
  final bool voided;
}

/// The New York day a time in milliseconds falls on ('' for 0).
String fleetDayOfMs(int ms) {
  if (ms <= 0) return '';
  return fleetDayKeyOf(
    DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true)
            .subtract(Duration(hours: _nyOffsetHours(ms)))
            .millisecondsSinceEpoch ~/
        86400000,
  );
}

// New York's offset at a time (daylight saving: second Sunday of March to
// the first Sunday of November). Close enough for the day a note was made.
int _nyOffsetHours(int ms) {
  final d = DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true);
  DateTime nthSunday(int year, int month, int n) {
    final first = DateTime.utc(year, month, 1);
    final shift = (7 - first.weekday) % 7;
    return DateTime.utc(year, month, 1 + shift + 7 * (n - 1), 7);
  }

  final start = nthSunday(d.year, 3, 2);
  final end = nthSunday(d.year, 11, 1);
  return !d.isBefore(start) && d.isBefore(end) ? 4 : 5;
}

/// A driver's track record, newest first: joined, cars given and returned,
/// rent changes, left and came back (a gap over [fleetLeftGapDays]), old TLC
/// licences, friends who drove, money events and office notes.
List<FleetProfileEntry> fleetDriverTimeline(
  FleetDriver driver,
  FleetIndex index,
) {
  final entries = <FleetProfileEntry>[];
  String plateOf(String carId) => index.carById[carId]?.plate ?? '';
  final assignments =
      [...(index.assignmentsByDriver[driver.id] ?? const <FleetAssignment>[])]
          .where((a) => a.startDayKey.isNotEmpty)
          .toList()
        ..sort((a, b) => a.startDayKey.compareTo(b.startDayKey));

  for (var i = 0; i < assignments.length; i++) {
    final a = assignments[i];
    final plate = plateOf(a.carId);
    if (i == 0) {
      entries.add(
        FleetProfileEntry(
          kind: FleetProfileKind.joined,
          dayKey: a.startDayKey,
          plate: plate,
        ),
      );
    }
    entries.add(
      FleetProfileEntry(
        kind: FleetProfileKind.carGiven,
        dayKey: a.startDayKey,
        plate: plate,
        rentCents: a.rentCents,
        period: a.period,
      ),
    );
    if (a.endDayKey.isNotEmpty) {
      entries.add(
        FleetProfileEntry(
          kind: FleetProfileKind.carReturned,
          dayKey: a.endDayKey,
          plate: plate,
        ),
      );
    }
    if (i == 0) continue;
    final prev = assignments[i - 1];
    if (prev.rentCents != a.rentCents) {
      entries.add(
        FleetProfileEntry(
          kind: FleetProfileKind.rentChange,
          dayKey: a.startDayKey,
          plate: plate,
          fromRentCents: prev.rentCents,
          rentCents: a.rentCents,
          period: a.period,
        ),
      );
    }
    if (prev.endDayKey.isNotEmpty &&
        fleetDaysBetween(prev.endDayKey, a.startDayKey) > fleetLeftGapDays) {
      entries.add(
        FleetProfileEntry(
          kind: FleetProfileKind.leftBack,
          dayKey: a.startDayKey,
          leftDayKey: prev.endDayKey,
        ),
      );
    }
  }

  for (final h in driver.licenseHistory) {
    final license = (h['license'] ?? '').toString().trim();
    if (license.isEmpty) continue;
    entries.add(
      FleetProfileEntry(
        kind: FleetProfileKind.license,
        dayKey: (h['toDayKey'] ?? '').toString(),
        license: license,
        fromDayKey: (h['fromDayKey'] ?? '').toString(),
        toDayKey: (h['toDayKey'] ?? '').toString(),
      ),
    );
  }

  for (final f in index.friendsByDriver[driver.id] ?? const <FleetFriend>[]) {
    if (f.voided) continue;
    entries.add(
      FleetProfileEntry(
        kind: FleetProfileKind.friend,
        dayKey: f.fromDayKey,
        name: f.name,
        plate: plateOf(f.carId),
        fromDayKey: f.fromDayKey,
        toDayKey: f.toDayKey,
      ),
    );
  }

  for (final b in index.billsByDriver[driver.id] ?? const <FleetBill>[]) {
    if (b.status == 'waived') {
      entries.add(
        FleetProfileEntry(
          kind: FleetProfileKind.waived,
          dayKey: b.waivedAtMs > 0 ? fleetDayOfMs(b.waivedAtMs) : b.dueDayKey,
          label: b.label.isEmpty ? b.kind : b.label,
          amountCents: b.amountCents,
          text: b.waivedReason,
        ),
      );
    }
    if (b.status == 'void') continue;
    if (b.kind == 'late_fee') {
      entries.add(
        FleetProfileEntry(
          kind: FleetProfileKind.lateFee,
          dayKey: b.dueDayKey,
          label: b.label,
          amountCents: b.amountCents,
        ),
      );
    } else if (b.kind == 'charge') {
      entries.add(
        FleetProfileEntry(
          kind: FleetProfileKind.charge,
          dayKey: b.dueDayKey,
          label: b.label,
          amountCents: b.amountCents,
        ),
      );
    }
  }

  for (final n in index.notesByDriver[driver.id] ?? const <FleetNote>[]) {
    entries.add(
      FleetProfileEntry(
        kind: FleetProfileKind.note,
        dayKey: fleetDayOfMs(n.atMs),
        noteId: n.id,
        text: n.text,
        voided: n.voided,
        by: n.byName,
      ),
    );
  }

  // Newest first; on one day, what was added last shows on top.
  final order = {for (var i = 0; i < entries.length; i++) entries[i]: i};
  entries.sort((a, b) {
    final d = b.dayKey.compareTo(a.dayKey);
    return d != 0 ? d : order[b]! - order[a]!;
  });
  return entries;
}

// ---------------------------------------------------------------------------
// A driver's bills and payments on their page.
// ---------------------------------------------------------------------------

enum FleetBillView { open, paid, waived, all }

enum FleetPaymentView { all, zelle, cash, import, other }

bool fleetBillInView(FleetBill bill, FleetBillView view) {
  // A bill made by a fault of ours is on no list and in no count.
  if (bill.billedByMistake) return false;
  switch (view) {
    case FleetBillView.all:
      return true;
    case FleetBillView.waived:
      return bill.status == 'waived' || bill.status == 'void';
    case FleetBillView.open:
      return bill.status == 'open';
    case FleetBillView.paid:
      return bill.status == 'paid';
  }
}

bool fleetPaymentInView(FleetPayment p, FleetPaymentView view) {
  if (view == FleetPaymentView.all) return true;
  final m = p.shownMethod;
  if (view == FleetPaymentView.other) {
    return !const ['zelle', 'cash', 'import'].contains(m);
  }
  return m == view.name;
}

/// "Fleet is on" for a business: the service is listed.
bool fleetServiceOn(Iterable<String> services) =>
    services.contains(fleetServiceKey);

/// Whether the business doc says Fleet is on (or lists the service).
bool fleetEnabled(Map<String, dynamic>? business) {
  final fleet = business?['fleet'];
  if (fleet is Map && fleet['enabled'] == true) return true;
  final services = business?['enabledServices'];
  return services is List && services.any((s) => '$s' == fleetServiceKey);
}
