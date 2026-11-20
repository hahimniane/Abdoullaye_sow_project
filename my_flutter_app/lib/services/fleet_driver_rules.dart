// The driver page's two Fleet-admin actions (docs/FLEET.md): "Change plate
// fee" (`assignment_update`) and "Driver has left" (`driver_leave`), mirroring
// admin_web/src/lib/fleet.ts (readPlateFeeInput, estimateFeeEffectiveDay).
// Pure: no Firebase, no clock of its own.

import 'fleet_billing.dart' show fleetRentPeriods;
import 'fleet_models.dart';

/// What "Change plate fee" sends: only what differs from the current
/// assignment. [error] is set when the form is refused.
class FleetPlateFeeInput {
  const FleetPlateFeeInput.ok({this.rentCents, this.dueDay})
    : error = FleetPlateFeeError.none;
  const FleetPlateFeeInput.refused(this.error)
    : rentCents = null,
      dueDay = null;

  final int? rentCents;
  final int? dueDay;
  final FleetPlateFeeError error;

  bool get ok => error == FleetPlateFeeError.none;
}

enum FleetPlateFeeError { none, badInput, nothingChanged }

/// Reads the "Change plate fee" form. Only what differs from the current
/// assignment is sent; nothing changed is refused. The amount is required.
/// Due day is 1-28 for a monthly fee (1-7, the weekday, for a weekly one).
FleetPlateFeeInput fleetReadPlateFeeInput(
  String amountText,
  String dueDayText,
  FleetAssignment current,
) {
  int? rent;
  int? due;
  if (amountText.trim().isEmpty) {
    return const FleetPlateFeeInput.refused(FleetPlateFeeError.badInput);
  }
  final cents = fleetDollarsToCents(amountText);
  if (cents == null || cents <= 0) {
    return const FleetPlateFeeInput.refused(FleetPlateFeeError.badInput);
  }
  if (cents != current.rentCents) rent = cents;
  if (dueDayText.trim().isNotEmpty) {
    final day = int.tryParse(dueDayText.trim());
    final max = current.period == 'weekly' ? 7 : 28;
    if (day == null || day < 1 || day > max) {
      return const FleetPlateFeeInput.refused(FleetPlateFeeError.badInput);
    }
    if (day != current.dueDay) due = day;
  }
  if (rent == null && due == null) {
    return const FleetPlateFeeInput.refused(FleetPlateFeeError.nothingChanged);
  }
  return FleetPlateFeeInput.ok(rentCents: rent, dueDay: due);
}

/// The day a plate-fee change will most likely apply from: the first rent
/// period with no bill yet (the server answers with the real day on saving).
String fleetEstimateFeeEffectiveDay(
  FleetAssignment assignment,
  Iterable<FleetBill> bills,
  String todayKey,
) {
  final have = {for (final b in bills) b.id};
  final horizon = fleetAddDays(todayKey, 70);
  for (final p in fleetRentPeriods(assignment, horizon)) {
    if (!have.contains('${assignment.id}_${p.periodFrom}')) return p.periodFrom;
  }
  return todayKey;
}

/// "Driver has left" shows only for an active driver, to a Fleet admin.
bool fleetCanMarkLeft({required bool admin, required FleetDriver driver}) =>
    admin && driver.isActive;
