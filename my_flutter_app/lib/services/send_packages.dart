import '../utils/callable_data.dart';
import 'container_manifest.dart';
import 'waiting_package_service.dart' show ContainerCallableCaller;
import 'waiting_packages.dart'
    show AssignLinesResult, assignLinesRequest, waitingLines;

/// Send packages (docs/SHIPPING_SIMPLE_HOME.md, part S): several waiting air
/// packages leave together on one flight. The plan is pure; the sheet runs it
/// through three existing callables - `createContainer`,
/// `assignContainerLines`, `setContainerStatus` - and remembers the shipment
/// between steps so a retry never makes a second one.

// ---------------------------------------------------------------------------
// Which packages, and where.
// ---------------------------------------------------------------------------

/// The waiting air packages of customers that can go on a flight, newest
/// first. A package that never named a country rides with nobody here: the
/// server judges a shipment by one country.
List<ContainerLine> sendablePackages(Iterable<ContainerLine> lines) => [
  for (final line in waitingLines(lines))
    if (line.isAirPackage &&
        line.ownerKind == containerOwnerCustomer &&
        line.id.trim().isNotEmpty &&
        line.destinationCountryId.trim().isNotEmpty)
      line,
];

/// One country with packages waiting to go there.
class SendCountry {
  const SendCountry({
    required this.id,
    required this.name,
    required this.count,
  });

  final String id;
  final String name;
  final int count;
}

/// The countries [packages] are going to, by name, with how many each.
List<SendCountry> sendCountries(Iterable<ContainerLine> packages) {
  final names = <String, String>{};
  final counts = <String, int>{};
  for (final line in packages) {
    final id = line.destinationCountryId.trim();
    if (id.isEmpty) continue;
    counts[id] = (counts[id] ?? 0) + 1;
    final name = line.destinationCountryName.trim();
    if (name.isNotEmpty) names.putIfAbsent(id, () => name);
  }
  final out = [
    for (final entry in counts.entries)
      SendCountry(
        id: entry.key,
        name: names[entry.key] ?? entry.key,
        count: entry.value,
      ),
  ]..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
  return out;
}

/// The packages in [packages] going to [countryId], in their order.
List<ContainerLine> packagesToCountry(
  Iterable<ContainerLine> packages,
  String countryId,
) => [
  for (final line in packages)
    if (line.destinationCountryId.trim() == countryId.trim()) line,
];

// ---------------------------------------------------------------------------
// The flight's date, name and waybill.
// ---------------------------------------------------------------------------

/// "YYYY-MM-DD", the way the server stores `plannedDepartureDate`.
String flightDayKey(DateTime day) =>
    '${day.year.toString().padLeft(4, '0')}-'
    '${day.month.toString().padLeft(2, '0')}-'
    '${day.day.toString().padLeft(2, '0')}';

/// "MM/DD/YYYY": month first, as every date in the app reads.
String flightDateText(DateTime day) =>
    '${day.month.toString().padLeft(2, '0')}/'
    '${day.day.toString().padLeft(2, '0')}/'
    '${day.year.toString().padLeft(4, '0')}';

/// "Flight 11/14/2026" ("Vol 11/14/2026"): the working name of a shipment
/// that has no airway bill yet. [word] is the localized "Flight".
String flightLabel(String word, DateTime day) =>
    '$word ${flightDateText(day)}';

/// Why [raw] is not an airway bill, or null when it is fine - including when
/// it is empty, since the number is optional. Mirrors the server's
/// `AIR_WAYBILL` check on `airWaybillOf(raw)`.
String? sendWaybillRefusal(String raw) {
  final waybill = airWaybillOf(raw);
  if (waybill.isEmpty) return null;
  return airWaybillPattern.hasMatch(waybill) ? null : 'air_waybill_invalid';
}

// ---------------------------------------------------------------------------
// The plan.
// ---------------------------------------------------------------------------

/// What one Send asks of the server. Built from what staff chose; nothing
/// here reads the screen.
class SendPlan {
  const SendPlan({
    required this.businessId,
    required this.countryId,
    required this.countryName,
    required this.flightDate,
    required this.lineIds,
    required this.flightWord,
    this.airWaybill = '',
  });

  final String businessId;
  final String countryId;
  final String countryName;

  /// The day the flight leaves (a calendar day; time is ignored).
  final DateTime flightDate;

  /// The packages going, each once.
  final List<String> lineIds;

  /// The localized word for the working name ("Flight" / "Vol").
  final String flightWord;

  /// What staff typed; normalized by [waybill].
  final String airWaybill;

  /// The airway bill as the server stores it, or '' when none was given.
  String get waybill => airWaybillOf(airWaybill);

  /// The working name, only when there is no airway bill to name the
  /// shipment by.
  String get label => waybill.isEmpty ? flightLabel(flightWord, flightDate) : '';

  String get plannedDepartureDate => flightDayKey(flightDate);

  /// Step 1: `createContainer`.
  Map<String, Object?> createRequest() => {
    'businessId': businessId.trim(),
    'shipMode': containerShipModeAir,
    if (waybill.isNotEmpty) 'airWaybill': waybill,
    if (label.isNotEmpty) 'label': label,
    'destinationCountryId': countryId.trim(),
    'destinationCountryName': countryName.trim(),
    'plannedDepartureDate': plannedDepartureDate,
  };

  /// Step 2: `assignContainerLines` on [containerId].
  Map<String, Object?> assignRequest(
    String containerId, {
    bool acknowledgeProblems = false,
  }) => assignLinesRequest(
    businessId,
    containerId,
    lineIds,
    acknowledgeProblems: acknowledgeProblems,
  );

  /// Step 3: `setContainerStatus` to shipped, which is what sends customers
  /// their "left" WhatsApp, exactly as for a container.
  Map<String, Object?> statusRequest(String containerId) => {
    'businessId': businessId.trim(),
    'containerId': containerId.trim(),
    'status': containerStatusShipped,
  };
}

/// An empty, still-loading air shipment from an earlier Send that was closed
/// before it finished, for the same country, day and name - or null. Only an
/// empty one is picked up again; one that holds packages is finished from the
/// console (nothing is silently deleted or reused under someone's feet).
ShippingContainer? reusableEmptyShipment(
  SendPlan plan,
  Iterable<ShippingContainer> containers,
  Iterable<ContainerLine> lines,
) {
  final occupied = {
    for (final line in lines)
      if (line.containerId.isNotEmpty) line.containerId,
  };
  for (final box in containers) {
    if (!box.isAir || !box.isLoading) continue;
    if (box.businessId != plan.businessId.trim()) continue;
    if (box.destinationCountryId != plan.countryId.trim()) continue;
    if (box.plannedDepartureDate != plan.plannedDepartureDate) continue;
    if (box.lineCount > 0 || occupied.contains(box.id)) continue;
    final sameName = plan.waybill.isNotEmpty
        ? box.airWaybill == plan.waybill
        : (box.airWaybill.isEmpty && box.label == plan.label);
    if (sameName) return box;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Running it.
// ---------------------------------------------------------------------------

/// Which callable comes next.
enum SendStep { create, assign, ship, done }

/// Runs a [SendPlan] through the callables, one step at a time, and
/// remembers where it got to. A failure leaves [step] on the step that
/// failed and [containerId] on the shipment already made, so [run] again
/// continues from there: `createContainer` is never called twice.
///
/// Errors are thrown as they came (a `FirebaseFunctionsException` from a
/// refusal) for the sheet to show.
class SendRunner {
  SendRunner({
    required this.plan,
    required this.caller,
    String reuseContainerId = '',
  }) : containerId = reuseContainerId.trim() {
    if (containerId.isNotEmpty) step = SendStep.assign;
  }

  final SendPlan plan;
  final ContainerCallableCaller caller;

  /// The shipment, once step 1 made (or picked up) one.
  String containerId;
  SendStep step = SendStep.create;
  AssignLinesResult? assigned;

  bool get isDone => step == SendStep.done;

  /// Picks up a shipment that already exists (an empty one from an earlier
  /// Send, or one a lost answer left behind) instead of making another. Only
  /// before step 1 has run.
  void adopt(String existingContainerId) {
    final id = existingContainerId.trim();
    if (step != SendStep.create || id.isEmpty) return;
    containerId = id;
    step = SendStep.assign;
  }

  /// Whether a shipment exists that a failure left unfinished.
  bool get startedShipment => containerId.isNotEmpty && !isDone;

  /// How many packages the plan sends.
  int get count => plan.lineIds.length;

  /// Continues from [step] to the end. [acknowledgeProblems] repeats the
  /// assign call after the sheet showed a sender's warning.
  Future<void> run({bool acknowledgeProblems = false}) async {
    if (step == SendStep.create) {
      final data = await caller('createContainer', plan.createRequest());
      final id = callableString(callableMap(data)['containerId']).trim();
      if (id.isEmpty) {
        throw StateError('createContainer answered without a containerId');
      }
      containerId = id;
      step = SendStep.assign;
    }
    if (step == SendStep.assign) {
      final data = await caller(
        'assignContainerLines',
        plan.assignRequest(
          containerId,
          acknowledgeProblems: acknowledgeProblems,
        ),
      );
      assigned = AssignLinesResult.fromCallable(data, sent: count);
      step = SendStep.ship;
    }
    if (step == SendStep.ship) {
      await caller('setContainerStatus', plan.statusRequest(containerId));
      step = SendStep.done;
    }
  }
}
