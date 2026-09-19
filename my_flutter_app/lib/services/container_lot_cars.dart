/// The cars a business can pick straight off its lot when loading a
/// container - the "Is this car parked in your lot?" answer, app side.
///
/// Pure Dart over the raw `parkedCars` rows the screens already hold and the
/// VIN → container join `containerVinLinks` already builds, so the list is a
/// join in memory and never a query. Tested without Firebase in
/// `test/container_lot_cars_test.dart`.
library;

import 'business_parking_entry.dart'
    show ParkingKind, parkingRowKind;
import 'container_manifest.dart' show ContainerVinLink;

String _s(Object? value, [int max = 200]) {
  final t = (value ?? '').toString().trim();
  return t.length > max ? t.substring(0, max) : t;
}

/// One parked car offered by the picker.
class LotCarChoice {
  const LotCarChoice({
    required this.id,
    required this.vin,
    required this.make,
    required this.model,
    required this.year,
    required this.ownerName,
    required this.ownerPhone,
    this.onContainer,
  });

  /// The `parkedCars` document id when the row carried one, else the VIN.
  final String id;
  final String vin;
  final String make;
  final String model;
  final String year;
  final String ownerName;
  final String ownerPhone;

  /// The open container (loading or shipped) already holding this VIN, when
  /// there is one. Shown but not pickable: a car cannot be on two lists.
  final ContainerVinLink? onContainer;

  bool get isTaken => onContainer != null;

  bool get hasVehicle => make.isNotEmpty || model.isNotEmpty || year.isNotEmpty;

  /// "2019 Toyota Camry", or "" when the row never said what the car is -
  /// the screen shows its own "Car" copy for that.
  String get vehicleLabel =>
      [year, make, model].where((p) => p.isNotEmpty).join(' ');
}

/// Whether a `parkedCars` row is a car standing in the lot right now: not
/// cancelled, not past its end date, and not a booking still in checkout.
/// Reads through [parkingRowKind] so this and the parking scoreboard never
/// disagree about what "in the lot" means.
bool parkedCarIsInLot(Map<String, dynamic> row, {DateTime? now}) {
  final kind = parkingRowKind(row, now: now);
  return kind == ParkingKind.inLot || kind == ParkingKind.reserved;
}

/// The pickable list: every row in the lot with a VIN, joined to the open
/// container that already holds it. Free cars first, then taken ones, each
/// group by vehicle then VIN so the list reads the way the yard is walked.
List<LotCarChoice> lotCarChoices(
  Iterable<Map<String, dynamic>> rows,
  Map<String, ContainerVinLink> links, {
  DateTime? now,
}) {
  final out = <LotCarChoice>[];
  for (final row in rows) {
    final vin = _s(row['vinNumber'], 17).toUpperCase();
    if (vin.isEmpty) continue;
    if (!parkedCarIsInLot(row, now: now)) continue;
    final id = _s(row['id'], 120);
    out.add(LotCarChoice(
      id: id.isNotEmpty ? id : vin,
      vin: vin,
      make: _s(row['carMake'], 80),
      model: _s(row['carModel'], 80),
      year: _s(row['carYear'], 8),
      ownerName: _s(row['ownerName'], 120),
      ownerPhone: _s(row['ownerPhone'], 40).isNotEmpty
          ? _s(row['ownerPhone'], 40)
          : _s(row['customerPhone'], 40),
      onContainer: links[vin],
    ));
  }
  out.sort((a, b) {
    if (a.isTaken != b.isTaken) return a.isTaken ? 1 : -1;
    final byLabel = a.vehicleLabel
        .toLowerCase()
        .compareTo(b.vehicleLabel.toLowerCase());
    if (byLabel != 0) return byLabel;
    return a.vin.compareTo(b.vin);
  });
  return out;
}

/// The choices matching what was typed: a VIN fragment, part of the owner's
/// name, or the make/model/year. Blank shows everything.
List<LotCarChoice> filterLotCarChoices(
  Iterable<LotCarChoice> choices,
  String query,
) {
  final q = query.trim().toLowerCase();
  if (q.isEmpty) return choices.toList();
  return [
    for (final c in choices)
      if (c.vin.toLowerCase().contains(q) ||
          c.ownerName.toLowerCase().contains(q) ||
          c.vehicleLabel.toLowerCase().contains(q))
        c,
  ];
}
