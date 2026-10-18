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
import '../utils/callable_data.dart';
import '../utils/money_input.dart';
import 'container_manifest.dart';
import 'invoice_ledger.dart' show invoiceCentsToInput, invoicePaymentMethods;
import 'line_pieces.dart';
import 'lot_ledger.dart' show lotDateOf;
import 'zelle_check.dart' show BankCheck;

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

// ---------------------------------------------------------------------------
// Groups: a package split across containers keeps its money on the root.
// ---------------------------------------------------------------------------

/// Every group among [lines], by root id: one pass over the lines a screen
/// already holds, so a list reads a row's group money with one lookup. A
/// line never split is a group of one. Mirrors `lineGroupSummary`.
Map<String, LineGroupSummary> lineGroupsByRoot(Iterable<ContainerLine> lines) {
  final byRoot = <String, List<LineGroupEntry>>{};
  for (final line in lines) {
    if (line.id.isEmpty) continue;
    (byRoot[line.rootLineId.isEmpty ? line.id : line.rootLineId] ??= [])
        .add(LineGroupEntry(line.id, line.groupFields));
  }
  return {
    for (final entry in byRoot.entries)
      entry.key: lineGroupSummary(entry.value, entry.key),
  };
}

/// The group [line] belongs to, from [groups] ([lineGroupsByRoot]); the line
/// alone when its group is not among them.
LineGroupSummary lineGroupOf(
  ContainerLine line,
  Map<String, LineGroupSummary> groups,
) {
  final root = line.rootLineId.isEmpty ? line.id : line.rootLineId;
  return groups[root] ??
      lineGroupSummary([LineGroupEntry(line.id, line.groupFields)], root);
}

/// Whether [group] holds its root line. A part's group read without its
/// root (the root not among the lines a screen holds) has only the part's
/// own price and none of the payments, which live on the root: never show
/// that as the package's balance.
bool groupHasRoot(LineGroupSummary group) =>
    group.parts.any((part) => part.id == group.rootLineId);

/// Where a package stands on money for its whole group: the parts' prices
/// added up against what the root was paid. For a line never split this is
/// [packagePayment].
PackagePayment groupPayment(LineGroupSummary group) => packageStanding(
      priceCents: group.priceCents,
      paidCents: group.paidCents,
      payOnArrival: group.payOnArrival,
    );

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

/// `setContainerLinePrice` refuses a total below a collected request's
/// pickup fee (`price_below_pickup_fee`): the fee is inside the price and
/// only what is above it is spread over the pieces. A cleared price (null)
/// is not judged here.
bool packagePriceBelowPickupFee(int? priceCents, int pickupFeeCents) =>
    priceCents != null && pickupFeeCents > 0 && priceCents < pickupFeeCents;

/// The server's checks on `recordContainerLinePayment`, in its order: a real
/// amount, a price to pay against, never above the balance, a known method,
/// and who took the money (as parking and lot payments ask). Mirrors
/// `validateLinePayment`.
///
/// [staffIds] is everyone in the business the phone knows of: when it is
/// given, a receiver who is not among them is `received_by_invalid`, the code
/// the server answers for someone who is not a person of this business. An
/// empty list (the team could not be read) leaves that check to the server.
List<String> validatePackagePayment({
  required String amount,
  required String method,
  required PackagePayment standing,
  required String receivedByStaffId,
  Iterable<String> staffIds = const [],
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
  final receiver = receivedByStaffId.trim();
  if (receiver.isEmpty) {
    errors.add('received_by_required');
  } else {
    final known = {for (final id in staffIds) id.trim()}..remove('');
    if (known.isNotEmpty && !known.contains(receiver)) {
      errors.add('received_by_invalid');
    }
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
    this.recordedByStaffId = '',
    required this.revertedByStaffId,
    required this.createdAt,
    required this.revertedAt,
    required this.reverted,
    this.bankCheck,
  });

  /// What the owner's bank showed for this payment (null: never checked).
  final BankCheck? bankCheck;

  final String id;
  final String lineId;
  final int amountCents;
  final String method;
  final String note;

  /// Who held the money (chosen when it was recorded).
  final String receivedByStaffId;

  /// Who typed it in; empty on older rows, which stored only the person who
  /// entered them (as the receiver).
  final String recordedByStaffId;
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
      recordedByStaffId: text(d['recordedByStaffId'], containerMaxLabel),
      revertedByStaffId: text(d['revertedByStaffId'], containerMaxLabel),
      createdAt: lotDateOf(d['createdAt']),
      revertedAt: lotDateOf(d['revertedAt']),
      reverted: d['reverted'] == true,
      bankCheck: BankCheck.fromMap(d['bankCheck'], date: lotDateOf),
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
  // A line with pieces carries its sizes and prices in them; the server
  // works the line's own out from the pieces.
  if (draft.usesPieces) {
    return {
      'destinationCountryId': draft.destinationCountryId.trim(),
      'destinationCountryName': draft.destinationCountryName.trim(),
      'payOnArrival': draft.payOnArrival,
    };
  }
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

/// Money taken at the counter as the package is registered: how much, how it
/// arrived, who took it, and an optional note - typed as the sheet holds it.
/// [intakePaymentErrors] checks it and [intakePaymentRecord] sends it.
class IntakePaymentDraft {
  const IntakePaymentDraft({
    this.amount = '',
    this.method = 'cash',
    this.receivedByStaffId = '',
    this.note = '',
  });

  /// US dollars as typed ("45", "45,50").
  final String amount;
  final String method;
  final String receivedByStaffId;
  final String note;
}

/// The amount field's opening text when "money received now" is switched on:
/// the whole price, which is what most customers hand over.
String intakeAmountInput(int? priceCents) =>
    priceCents == null || priceCents <= 0 ? '' : invoiceCentsToInput(priceCents);

/// The checks on money taken at registration: the same ones as a payment
/// recorded later ([validatePackagePayment]), against a package with nothing
/// paid yet - so no price is `price_required` and more than the price is
/// `payment_exceeds_balance`.
List<String> intakePaymentErrors(
  IntakePaymentDraft payment, {
  required int? priceCents,
  Iterable<String> staffIds = const [],
}) =>
    validatePackagePayment(
      amount: payment.amount,
      method: payment.method,
      standing: packageStanding(
        priceCents: priceCents,
        paidCents: 0,
        payOnArrival: false,
      ),
      receivedByStaffId: payment.receivedByStaffId,
      staffIds: staffIds,
    );

/// The `payment` object `addWaitingPackage` takes. The note only when there
/// is one, cut to the server's 200 characters.
Map<String, Object?> intakePaymentRecord(IntakePaymentDraft payment) {
  final note = payment.note.trim();
  return {
    'amountCents': readMoneyInput(payment.amount).cents ?? 0,
    'method': payment.method.trim(),
    'receivedByStaffId': payment.receivedByStaffId.trim(),
    if (note.isNotEmpty)
      'note': note.length > 200 ? note.substring(0, 200) : note,
  };
}

/// The `addWaitingPackage` request body, flat as the server reads it: the
/// pieces of a package that is not a car (`pieces`), or a car. With
/// [payment] - money handed over at the counter - the package is registered
/// and paid (in part or in full) in one call. A payment needs the price on
/// the same package (the pieces' total), so it is never sent without one.
Map<String, Object?> addWaitingPackageRequest(
  String businessId,
  ContainerLineDraft draft, {
  IntakePaymentDraft? payment,
}) =>
    {
      'businessId': businessId.trim(),
      ...containerLineRecord(draft),
      ..._packageExtras(draft, withPrice: true, clearEmptySize: false),
      if (payment != null && draft.totalCents != null)
        'payment': intakePaymentRecord(payment),
    };

/// The `updateContainerLine` request for an edited waiting package: no
/// container, and the package's own fields alongside the line's. A car's
/// price goes through `setContainerLinePrice` (it is audited and checked
/// against what has been paid), so it is left out here; the pieces of any
/// other package carry their own prices, ids kept.
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
/// `setContainerLinePrice` is called after the line is updated. A line with
/// pieces has its prices saved with them by `updateContainerLine`: only the
/// switch is left, sent with the new total unchanged.
bool packagePriceChanged(ContainerLine line, ContainerLineDraft draft) {
  if (draft.usesPieces) return line.payOnArrival != draft.payOnArrival;
  return line.priceCents != draft.priceCents ||
      line.payOnArrival != draft.payOnArrival;
}

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
  required String receivedByStaffId,
  String note = '',
}) =>
    {
      'businessId': businessId.trim(),
      'lineId': lineId.trim(),
      'amountCents': amountCents,
      'method': method.trim(),
      'receivedByStaffId': receivedByStaffId.trim(),
      'note': note.trim().length > 200 ? note.trim().substring(0, 200) : note.trim(),
    };

/// The `revertContainerLinePayment` request.
Map<String, Object?> revertPackagePaymentRequest(
  String businessId,
  String paymentId,
) =>
    {'businessId': businessId.trim(), 'paymentId': paymentId.trim()};

/// The `assignContainerLines` request. Duplicates dropped; the caller checks
/// the count first ([assignSelectionRefusal]). [pieceCounts] is how many
/// pieces of a package go in when not all of them do: only those below the
/// package's own count (and of a package that is sent) are named, so a
/// request that moves whole packages is the one it always was.
Map<String, Object?> assignLinesRequest(
  String businessId,
  String containerId,
  Iterable<String> lineIds, {
  Map<String, int> pieceCounts = const {},
  Map<String, int> pieceTotals = const {},
}) {
  final ids = {
    for (final id in lineIds)
      if (id.trim().isNotEmpty) id.trim(),
  }.toList();
  final counts = <String, int>{
    for (final id in ids)
      if (pieceCounts[id] != null &&
          pieceCounts[id]! >= 1 &&
          pieceCounts[id]! < (pieceTotals[id] ?? 0))
        id: pieceCounts[id]!,
  };
  return {
    'businessId': businessId.trim(),
    'containerId': containerId.trim(),
    'lineIds': ids,
    if (counts.isNotEmpty) 'pieceCounts': counts,
  };
}

/// One part a split left waiting: the line it was split from, the new
/// line, its code and how many pieces it holds.
class AssignedPart {
  const AssignedPart({
    required this.lineId,
    required this.partLineId,
    required this.trackingCode,
    required this.pieceCount,
  });

  final String lineId;
  final String partLineId;
  final String trackingCode;
  final int pieceCount;
}

/// What `assignContainerLines` answered: `{success, assigned,
/// alreadyAssigned, parts: [{lineId, partLineId, trackingCode, pieceCount}]}`.
class AssignLinesResult {
  const AssignLinesResult({
    required this.assigned,
    this.alreadyAssigned = 0,
    this.parts = const [],
  });

  final int assigned;

  /// Already on this container (a retried request that had landed).
  final int alreadyAssigned;
  final List<AssignedPart> parts;

  /// Read defensively: iOS hands nested maps over as `Map<Object?, Object?>`,
  /// and an older server answers without `parts`. [sent] is how many
  /// packages were asked for, the count when the answer has none.
  factory AssignLinesResult.fromCallable(Object? data, {int sent = 0}) {
    final map = callableMap(data);
    int count(Object? v) => v is num && v.isFinite && v > 0 ? v.round() : 0;
    final raw = map['parts'];
    return AssignLinesResult(
      assigned: map['assigned'] is num ? count(map['assigned']) : sent,
      alreadyAssigned: count(map['alreadyAssigned']),
      parts: [
        if (raw is List)
          for (final item in raw)
            if (item is Map && callableString(item['partLineId']).isNotEmpty)
              AssignedPart(
                lineId: callableString(item['lineId']),
                partLineId: callableString(item['partLineId']),
                trackingCode: callableString(item['trackingCode']).toUpperCase(),
                pieceCount: count(item['pieceCount']),
              ),
      ],
    );
  }
}

/// What the split sheet previews for a package when [going] of its pieces
/// go in: its own code rides with them, and the rest stay waiting under the
/// code the server will give the new part (`partTrackingCode`, one past the
/// group's highest part). [lines] are the lines the screen holds, so the
/// group's other parts are known; the server decides, this only says it
/// first.
class SplitPreview {
  const SplitPreview({
    required this.going,
    required this.total,
    required this.code,
    required this.partCode,
  });

  final int going;
  final int total;
  final String code;

  /// The waiting part's code, "" when nothing stays.
  final String partCode;

  int get staying => total - going;
  bool get splits => going < total;
}

SplitPreview splitPreview(
  ContainerLine line,
  int going,
  Iterable<ContainerLine> lines,
) {
  final total = line.pieceCount;
  final n = going < 1 ? 1 : (going > total ? total : going);
  if (n >= total) {
    return SplitPreview(
        going: total, total: total, code: line.trackingCode, partCode: '');
  }
  final rootId = line.rootLineId.isEmpty ? line.id : line.rootLineId;
  final group = [
    for (final l in lines)
      if ((l.rootLineId.isEmpty ? l.id : l.rootLineId) == rootId) l,
  ];
  final root = group.where((l) => l.id == rootId).firstOrNull ?? line;
  // The root's code; a part's own ends in "-k" when its root is not held.
  final rootCode = root.id == rootId
      ? root.trackingCode
      : line.trackingCode.replaceFirst(RegExp(r'-\d+$'), '');
  final next = nextPartIndex(
    {'lastPartIndex': root.lastPartIndex},
    [for (final l in group) {'partIndex': l.partIndex}],
  );
  return SplitPreview(
    going: n,
    total: total,
    code: line.trackingCode,
    partCode: rootCode.isEmpty ? '' : partTrackingCode(rootCode, next),
  );
}

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
    this.paidCents = 0,
  });

  final String lineId;
  final String trackingCode;
  final bool printLabel;

  /// What was paid on it at the counter as it was registered (cents).
  final int paidCents;

  /// The package as it was just saved - enough to name it on a label before
  /// the live list has caught up with the server.
  final ContainerLine? line;

  /// An existing package was corrected rather than a new one registered.
  final bool edited;
}
