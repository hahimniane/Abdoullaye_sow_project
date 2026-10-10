/// Waiting packages, app side: a box, barrel or car a customer drops off
/// before anyone knows which container it will ride.
///
/// A waiting package is an ordinary container line (same collection, same
/// tracking code for life) with `containerId: ""` and `containerStatus:
/// "waiting"`, plus what a counter needs to take it in: the country it is
/// for, its size in inches, a price in US dollars and what has been paid on
/// it. The callables are the authority (`addWaitingPackage`,
/// `assignContainerLines`, `setContainerLinePrice`,
/// `recordContainerLinePayment`...; docs/WAITING_PACKAGES.md). This module is
/// the pure half the sheets use so a bad entry is refused before the round
/// trip, with the same code the server would answer, and so a row, a chip or
/// a refusal reads as a sentence.
///
/// Mirrors `functions/container_manifest.js` (`destinationMismatch`,
/// `lineVolumeCubicFeet`, `cleanLineIds`...) and `functions/container_payments.js`
/// (`linePaymentStanding`, `validateLinePayment`), and the console's
/// `admin_web/src/lib/waiting-packages.ts`. Pure Dart, tested without Firebase.
library;

import '../models/destination_country.dart';
import '../utils/money_input.dart';
import 'container_manifest.dart';
import 'invoice_ledger.dart' show invoiceCentsToInput, invoicePaymentMethods;
import 'lot_ledger.dart' show lotDateOf;

const _cubicInchesPerCubicFoot = 1728;

// ---------------------------------------------------------------------------
// Size: inches in, cubic feet out.
// ---------------------------------------------------------------------------

final RegExp _typedInches = RegExp(r'^\d+(\.\d+)?$');

/// One typed measurement in inches: blank is null, anything that is not a
/// positive number up to the server's cap is NaN, so a form can tell "not
/// filled in" from "filled in wrong". A decimal comma reads as a point.
double? readInches(String raw) {
  final typed = raw.trim().replaceAll(',', '.');
  if (typed.isEmpty) return null;
  if (!_typedInches.hasMatch(typed)) return double.nan;
  return containerDimension(typed) ?? double.nan;
}

/// Length x width x height in cubic feet (inches cubed over 1728) to two
/// decimals; null when any side is missing. Mirrors `lineVolumeCubicFeet`.
double? volumeCubicFeet(double? length, double? width, double? height) {
  final sides = [length, width, height];
  if (sides.any((s) => s == null || s.isNaN || s <= 0)) return null;
  final cubicInches = length! * width! * height!;
  return (cubicInches / _cubicInchesPerCubicFoot * 100).round() / 100;
}

/// 12 -> "12", 12.5 -> "12.5": a measurement without trailing zeros.
String trimNumber(double value) {
  final rounded = (value * 100).round() / 100;
  return rounded == rounded.roundToDouble()
      ? rounded.round().toString()
      : rounded.toString();
}

/// The size a line carries.
class PackageSize {
  const PackageSize({
    required this.lengthIn,
    required this.widthIn,
    required this.heightIn,
    required this.volumeCuFt,
  });

  final double lengthIn;
  final double widthIn;
  final double heightIn;
  final double volumeCuFt;

  /// "40 × 30 × 20 in" - the same text the labels print.
  String get dimensionsText =>
      '${trimNumber(lengthIn)} × ${trimNumber(widthIn)} × ${trimNumber(heightIn)} in';

  /// "13.89 ft³".
  String get volumeText => '${trimNumber(volumeCuFt)} ft³';
}

/// The size a line carries, or null when any side is missing.
PackageSize? packageSize(ContainerLine line) {
  final volume = volumeCubicFeet(line.lengthIn, line.widthIn, line.heightIn);
  if (volume == null) return null;
  return PackageSize(
    lengthIn: line.lengthIn!,
    widthIn: line.widthIn!,
    heightIn: line.heightIn!,
    volumeCuFt: volume,
  );
}

// ---------------------------------------------------------------------------
// Price and payments: integer cents end to end.
// ---------------------------------------------------------------------------

/// Where a package stands on money, as the chips say it. A price that was
/// never set is not "unpaid": there is nothing to pay yet.
enum PackagePaymentStatus { noPrice, unpaid, partial, paid, payOnArrival }

class PackagePayment {
  const PackagePayment({
    required this.status,
    required this.priceCents,
    required this.paidCents,
    required this.balanceCents,
    required this.payOnArrival,
  });

  final PackagePaymentStatus status;

  /// Null until a price is set.
  final int? priceCents;
  final int paidCents;

  /// What is still owed; null while there is no price.
  final int? balanceCents;
  final bool payOnArrival;

  bool get hasPrice => priceCents != null;
}

/// Where a package stands on money. Paid in full wins over everything; a
/// payment on account reads partial even when the rest is due on arrival (the
/// balance says what is left). Mirrors `linePaymentStanding`.
PackagePayment packagePayment(ContainerLine line) => packageStanding(
      priceCents: line.priceCents,
      paidCents: line.paidCents,
      payOnArrival: line.payOnArrival,
    );

/// [packagePayment] for the three numbers themselves, so a sheet can follow
/// the server's answers (the price it saved, the total paid it returned)
/// without waiting for the live line to catch up.
PackagePayment packageStanding({
  required int? priceCents,
  required int paidCents,
  required bool payOnArrival,
}) {
  final price = priceCents;
  final paid = paidCents;
  final PackagePaymentStatus status;
  if (price == null) {
    status = payOnArrival
        ? PackagePaymentStatus.payOnArrival
        : PackagePaymentStatus.noPrice;
  } else if (paid >= price) {
    status = PackagePaymentStatus.paid;
  } else if (paid > 0) {
    status = PackagePaymentStatus.partial;
  } else if (payOnArrival) {
    status = PackagePaymentStatus.payOnArrival;
  } else {
    status = PackagePaymentStatus.unpaid;
  }
  return PackagePayment(
    status: status,
    priceCents: price,
    paidCents: paid,
    balanceCents: price == null ? null : (price - paid < 0 ? 0 : price - paid),
    payOnArrival: payOnArrival,
  );
}

/// Whether the money half of a line is worth showing: a package nobody priced
/// shows nothing on a container (most lines predate prices), but a waiting
/// one always can be priced.
bool packageHasMoney(ContainerLine line) =>
    line.priceCents != null || line.payOnArrival;

/// A typed price: blank is "no price yet" (null cents, no error); anything
/// unreadable, zero or beyond what a package can cost is `price_invalid`.
/// One reader (`readMoneyInput`) so "45,50" means forty-five dollars fifty
/// here as everywhere.
class PriceReading {
  const PriceReading({this.cents, this.error});

  final int? cents;
  final String? error;
}

PriceReading readPackagePrice(String raw) {
  final read = readMoneyInput(raw);
  if (read.isEmpty) return const PriceReading();
  final cents = read.cents;
  if (cents == null || cents <= 0 || cents > containerMaxCents) {
    return const PriceReading(error: 'price_invalid');
  }
  return PriceReading(cents: cents);
}

/// The server's checks on `setContainerLinePrice`: readable, sane, and not
/// below what is paid (nor cleared once money has been paid).
List<String> validatePackagePrice(String raw, int paidCents) {
  final reading = readPackagePrice(raw);
  if (reading.error != null) return [reading.error!];
  if ((reading.cents ?? 0) < paidCents) return const ['price_below_paid'];
  return const [];
}

/// The server's checks on `recordContainerLinePayment`, in its order: a real
/// amount, a price to pay against, never above the balance, a known method.
/// Mirrors `validateLinePayment`.
List<String> validatePackagePayment({
  required String amount,
  required String method,
  required PackagePayment standing,
}) {
  final errors = <String>[];
  final cents = readMoneyInput(amount).cents;
  if (cents == null || cents <= 0) {
    errors.add('amount_required');
  } else if (cents > containerMaxCents) {
    errors.add('amount_too_large');
  } else if (standing.balanceCents == null) {
    errors.add('price_required');
  } else if (cents > standing.balanceCents!) {
    errors.add('payment_exceeds_balance');
  }
  if (!invoicePaymentMethods.contains(method.trim())) {
    errors.add('payment_method_invalid');
  }
  return errors;
}

/// "Pay the whole balance": the amount field's text for what is left.
String wholeBalanceInput(PackagePayment standing) {
  final balance = standing.balanceCents ?? 0;
  return balance > 0 ? invoiceCentsToInput(balance) : '';
}

/// One row of `containerLinePayments`: who took what, and when. A mistaken
/// payment is struck through (`reverted`), never erased.
class ContainerLinePayment {
  const ContainerLinePayment({
    required this.id,
    required this.lineId,
    required this.amountCents,
    required this.method,
    required this.note,
    required this.receivedByStaffId,
    required this.revertedByStaffId,
    required this.createdAt,
    required this.revertedAt,
    required this.reverted,
  });

  final String id;
  final String lineId;
  final int amountCents;
  final String method;
  final String note;
  final String receivedByStaffId;
  final String revertedByStaffId;
  final DateTime? createdAt;
  final DateTime? revertedAt;
  final bool reverted;

  factory ContainerLinePayment.fromMap(String id, Map<String, dynamic> d) {
    String text(Object? v, int max) {
      final t = (v ?? '').toString().trim();
      return t.length > max ? t.substring(0, max) : t;
    }

    final amount = d['amountCents'];
    return ContainerLinePayment(
      id: id,
      lineId: text(d['lineId'], containerMaxLabel),
      amountCents: amount is num && amount.isFinite && amount > 0
          ? amount.round()
          : 0,
      method: text(d['method'], 40),
      note: text(d['note'], 200),
      receivedByStaffId: text(d['receivedByStaffId'], containerMaxLabel),
      revertedByStaffId: text(d['revertedByStaffId'], containerMaxLabel),
      createdAt: lotDateOf(d['createdAt']),
      revertedAt: lotDateOf(d['revertedAt']),
      reverted: d['reverted'] == true,
    );
  }
}

/// A package's payments, newest first, reverted ones kept (and marked) so the
/// history is whole.
List<ContainerLinePayment> sortPaymentsNewestFirst(
  Iterable<ContainerLinePayment> payments,
) {
  final out = payments.toList();
  out.sort((a, b) {
    final x = a.createdAt, y = b.createdAt;
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return y.compareTo(x);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Where the package is going, and whether a container may take it.
// ---------------------------------------------------------------------------

/// A country as the register form carries it.
class DestinationRef {
  const DestinationRef(this.id, this.name);

  final String id;
  final String name;
}

/// The destination a new package opens with: the business's main
/// destination, else the first one it lists (by name, so the answer does not
/// depend on the order the rows arrived in). Null when it lists none, and the
/// form asks.
DestinationRef? defaultWaitingDestination(
  Iterable<DestinationCountry> destinations,
) {
  final list = [
    for (final d in destinations)
      if (d.id.trim().isNotEmpty) d,
  ];
  if (list.isEmpty) return null;
  list.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
  final pick = list.where((d) => d.isMain).firstOrNull ?? list.first;
  return DestinationRef(pick.id, pick.name);
}

/// Whether a container may take a package: both must be going to the same
/// place. A line that never named a destination (loaded before they existed)
/// rides anywhere; one that did needs a container that has decided too. A
/// refusal code, or null when allowed. Mirrors `destinationMismatch`.
String? destinationMismatch(ContainerLine line, ShippingContainer? container) {
  final wanted = line.destinationCountryId.trim();
  if (wanted.isEmpty) return null;
  final going = (container?.destinationCountryId ?? '').trim();
  if (going.isEmpty) return 'container_destination_required';
  return going == wanted ? null : 'destination_mismatch';
}

/// One waiting package against one container: the reason it cannot go on it,
/// or null when it can.
class AssignableLine {
  const AssignableLine(this.line, this.refusal);

  final ContainerLine line;
  final String? refusal;

  bool get blocked => refusal != null;
}

List<AssignableLine> assignableLines(
  Iterable<ContainerLine> waiting,
  ShippingContainer container,
) =>
    [
      for (final line in waiting)
        AssignableLine(line, destinationMismatch(line, container)),
    ];

/// The packages dropped off and not on any container yet, newest first.
List<ContainerLine> waitingLines(Iterable<ContainerLine> lines) {
  final out = [
    for (final line in lines)
      if (line.isWaiting) line,
  ];
  out.sort((a, b) {
    final x = a.createdAt, y = b.createdAt;
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return y.compareTo(x);
  });
  return out;
}

/// The packages a search box narrows the list to, in the list's own order;
/// the whole list for a query under two characters. The same search the
/// containers screen uses (VIN, customer, receiver, phone).
List<ContainerLine> filterWaitingPackages(
  Iterable<ContainerLine> lines,
  String query,
) {
  final list = lines.toList();
  if (query.trim().length < 2) return list;
  final hits = {
    for (final hit in searchContainerLines(list, const {}, query)) hit.line.id,
  };
  return [
    for (final line in list)
      if (hits.contains(line.id)) line,
  ];
}

/// "Select all matching": the ids of every package the container can take
/// that the filter shows, added to what is already ticked, never past the
/// server's limit of one hundred a call.
List<String> selectAllMatching(
  Iterable<AssignableLine> visible,
  Iterable<String> selected, {
  int limit = containerMaxAssignLines,
}) {
  final next = <String>{...selected};
  for (final entry in visible) {
    if (entry.blocked || entry.line.id.isEmpty) continue;
    if (next.length >= limit) break;
    next.add(entry.line.id);
  }
  return next.toList();
}

/// Too many ticked for one call: the code the server would answer with.
String? assignSelectionRefusal(int count) =>
    count > containerMaxAssignLines || count <= 0 ? 'line_ids_invalid' : null;

// ---------------------------------------------------------------------------
// The register form.
// ---------------------------------------------------------------------------

/// Error codes for a package dropped off before any container: the line's own
/// checks, then the two things a waiting package cannot do without - a
/// customer (stock is not "dropped off") and a destination. Mirrors
/// `validateWaitingPackage`.
List<String> validateWaitingPackage(ContainerLineDraft draft) {
  final errors = validateContainerLine(draft);
  if (draft.ownerKind.trim() == containerOwnerStock) {
    errors.add('owner_kind_invalid');
  }
  if (draft.destinationCountryId.trim().isEmpty) {
    errors.add('package_destination_required');
  }
  return errors;
}

/// What a package carries beyond its line: country, size, payOnArrival, and
/// the price when [withPrice]. [clearEmptySize] sends explicit nulls for an
/// empty size, so editing a package can take its size away (an omitted field
/// keeps the stored one).
Map<String, Object?> _packageExtras(
  ContainerLineDraft draft, {
  required bool withPrice,
  required bool clearEmptySize,
}) {
  final sides = [
    containerDimension(draft.lengthIn),
    containerDimension(draft.widthIn),
    containerDimension(draft.heightIn),
  ];
  final complete = sides.every((s) => s != null);
  final price = draft.priceCents;
  return {
    'destinationCountryId': draft.destinationCountryId.trim(),
    'destinationCountryName': draft.destinationCountryName.trim(),
    if (complete) ...{
      'lengthIn': sides[0],
      'widthIn': sides[1],
      'heightIn': sides[2],
    } else if (clearEmptySize) ...{
      'lengthIn': null,
      'widthIn': null,
      'heightIn': null,
    },
    if (withPrice && price != null) 'priceCents': price,
    'payOnArrival': draft.payOnArrival,
  };
}

/// The `addWaitingPackage` request body, flat as the server reads it.
Map<String, Object?> addWaitingPackageRequest(
  String businessId,
  ContainerLineDraft draft,
) =>
    {
      'businessId': businessId.trim(),
      ...containerLineRecord(draft),
      ..._packageExtras(draft, withPrice: true, clearEmptySize: false),
    };

/// The `updateContainerLine` request for an edited waiting package: no
/// container, and the package's own fields alongside the line's. The price
/// goes through `setContainerLinePrice` (it is audited and checked against
/// what has been paid), so it is left out here.
Map<String, Object?> updateWaitingPackageRequest(
  String businessId,
  String lineId,
  ContainerLineDraft draft,
) =>
    {
      'businessId': businessId.trim(),
      'lineId': lineId.trim(),
      'containerId': '',
      'line': {
        ...containerLineRecord(draft),
        ..._packageExtras(draft, withPrice: false, clearEmptySize: true),
      },
    };

/// Whether saving an edit changes the price or the pay-on-arrival switch, so
/// `setContainerLinePrice` is called after the line is updated.
bool packagePriceChanged(ContainerLine line, ContainerLineDraft draft) =>
    line.priceCents != draft.priceCents ||
    line.payOnArrival != draft.payOnArrival;

/// The `setContainerLinePrice` request; a null price clears it.
Map<String, Object?> setPackagePriceRequest(
  String businessId,
  String lineId, {
  required int? priceCents,
  required bool payOnArrival,
}) =>
    {
      'businessId': businessId.trim(),
      'lineId': lineId.trim(),
      'priceCents': priceCents,
      'payOnArrival': payOnArrival,
    };

/// The `recordContainerLinePayment` request.
Map<String, Object?> recordPackagePaymentRequest(
  String businessId,
  String lineId, {
  required int amountCents,
  required String method,
  String note = '',
}) =>
    {
      'businessId': businessId.trim(),
      'lineId': lineId.trim(),
      'amountCents': amountCents,
      'method': method.trim(),
      'note': note.trim().length > 200 ? note.trim().substring(0, 200) : note.trim(),
    };

/// The `revertContainerLinePayment` request.
Map<String, Object?> revertPackagePaymentRequest(
  String businessId,
  String paymentId,
) =>
    {'businessId': businessId.trim(), 'paymentId': paymentId.trim()};

/// The `assignContainerLines` request. Duplicates dropped; the caller checks
/// the count first ([assignSelectionRefusal]).
Map<String, Object?> assignLinesRequest(
  String businessId,
  String containerId,
  Iterable<String> lineIds,
) =>
    {
      'businessId': businessId.trim(),
      'containerId': containerId.trim(),
      'lineIds': {
        for (final id in lineIds)
          if (id.trim().isNotEmpty) id.trim(),
      }.toList(),
    };

/// The `unassignContainerLine` request: back to the waiting list.
Map<String, Object?> unassignLineRequest(String businessId, String lineId) =>
    {'businessId': businessId.trim(), 'lineId': lineId.trim()};

/// The `removeContainerLine` request for a waiting package: no container.
Map<String, Object?> removeWaitingPackageRequest(
  String businessId,
  String lineId,
) =>
    {
      'businessId': businessId.trim(),
      'containerId': '',
      'lineId': lineId.trim(),
    };

/// What the register sheet answers when it closes: the package it saved (or
/// corrected), and whether the person asked to print its label right away.
class WaitingPackageSaved {
  const WaitingPackageSaved({
    required this.lineId,
    this.trackingCode = '',
    this.printLabel = false,
    this.edited = false,
    this.line,
  });

  final String lineId;
  final String trackingCode;
  final bool printLabel;

  /// The package as it was just saved - enough to name it on a label before
  /// the live list has caught up with the server.
  final ContainerLine? line;

  /// An existing package was corrected rather than a new one registered.
  final bool edited;
}
