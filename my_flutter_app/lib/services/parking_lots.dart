import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'business_activity_queries.dart' show parkedCarsOnLotSpec;
import 'business_parking_entry.dart'
    show BusinessParkingTotals, businessParkingTotals;

/// Several parking lots for one business (docs/PARKING_LOTS.md), app side.
///
/// A deliberate mirror of the server's pure module
/// (`functions/parking_lots.js`) and of the console's
/// `admin_web/src/lib/parking-lots.ts`, whose test cases
/// `test/parking_lots_test.dart` repeats. A lot is only where a car stands:
/// prices and bills are the business's, so nothing here touches money.
///
/// Everything above [ParkingLotsService] is pure (no Firebase, no widgets).

String _text(Object? value, [int max = 200]) {
  final collapsed = (value ?? '').toString().replaceAll(RegExp(r'\s+'), ' ');
  final trimmed = collapsed.trim();
  return trimmed.length <= max ? trimmed : trimmed.substring(0, max);
}

int _whole(Object? value) {
  final number = num.tryParse('${value ?? ''}');
  if (number == null || !number.isFinite) return 0;
  final truncated = number.truncate();
  return truncated > 0 ? truncated : 0;
}

/// The id of a business's first lot (the server's `mainLotId`).
String mainParkingLotId(String businessId) => '${_text(businessId, 180)}_main';

/// One `parkingLots` row.
class ParkingLot {
  const ParkingLot({
    required this.id,
    required this.name,
    this.addressLine1 = '',
    this.city = '',
    this.state = '',
    this.zipCode = '',
    this.totalSpaces = 0,
    this.blockedSpaces = 0,
    this.open = true,
    this.isMain = false,
    this.sortOrder = 0,
  });

  /// A `parkingLots` document's data plus its id.
  factory ParkingLot.fromRow(Map<String, dynamic> row) => ParkingLot(
    id: _text(row['id']),
    name: _text(row['name'], 60),
    addressLine1: _text(row['addressLine1']),
    city: _text(row['city'], 120),
    state: _text(row['state'], 80),
    zipCode: _text(row['zipCode'], 20),
    totalSpaces: _whole(row['totalSpaces']),
    blockedSpaces: _whole(row['blockedSpaces']),
    // Absent means open; only an explicit `false` closes a lot.
    open: row['active'] != false,
    isMain: row['isMain'] == true,
    sortOrder: num.tryParse('${row['sortOrder'] ?? ''}')?.toInt() ?? 0,
  );

  final String id;
  final String name;
  final String addressLine1;
  final String city;
  final String state;
  final String zipCode;
  final int totalSpaces;
  final int blockedSpaces;

  /// Cars can be parked in it. A closed lot keeps its history.
  final bool open;

  /// The business's first lot: where a car with no lot is read as standing.
  final bool isMain;
  final int sortOrder;

  /// Spaces staff can use: the lot's spaces minus the blocked ones.
  int get usableSpaces {
    final usable = totalSpaces - blockedSpaces;
    return usable > 0 ? usable : 0;
  }

  /// The address as one line, '' when the lot has none of its own.
  String get addressLine =>
      [addressLine1, city, state].where((part) => part.isNotEmpty).join(', ');
}

/// Every lot, open ones first, in the order staff see them (the server's
/// `openLots`): `sortOrder`, the first lot before the others, then name.
List<ParkingLot> sortedParkingLots(Iterable<Map<String, dynamic>>? rows) {
  final lots = [
    for (final row in rows ?? const <Map<String, dynamic>>[])
      ParkingLot.fromRow(row),
  ].where((lot) => lot.id.isNotEmpty).toList();
  lots.sort((a, b) {
    final byOpen = (b.open ? 1 : 0) - (a.open ? 1 : 0);
    if (byOpen != 0) return byOpen;
    final byOrder = a.sortOrder - b.sortOrder;
    if (byOrder != 0) return byOrder;
    final byMain = (b.isMain ? 1 : 0) - (a.isMain ? 1 : 0);
    if (byMain != 0) return byMain;
    return a.name.toLowerCase().compareTo(b.name.toLowerCase());
  });
  return lots;
}

List<ParkingLot> openParkingLots(Iterable<ParkingLot> lots) =>
    lots.where((lot) => lot.open).toList();

/// The lot a car stands in. A car parked before lots existed, and one the old
/// phone app parked, carries none: it is in the business's first lot.
String parkingLotIdOf(Map<String, dynamic>? car, String businessId) {
  final own = _text(car?['parkingLotId']);
  if (own.isNotEmpty) return own;
  final business = _text(businessId, 180);
  return mainParkingLotId(
    business.isNotEmpty ? business : _text(car?['businessId'], 180),
  );
}

/// The lot's name for a car: the lot's current name, else the copy the car
/// carries.
String parkingLotNameOf(
  Map<String, dynamic>? car,
  String businessId,
  Iterable<ParkingLot> lots,
) {
  final id = parkingLotIdOf(car, businessId);
  for (final lot in lots) {
    if (lot.id == id && lot.name.isNotEmpty) return lot.name;
  }
  return _text(car?['parkingLotName'], 60);
}

/// Whether staff are asked for a lot at all: only a business with two or more
/// open lots.
bool asksForParkingLot(Iterable<ParkingLot> lots) =>
    openParkingLots(lots).length >= 2;

/// One lot's live figures over the cars in view.
class ParkingLotFigures {
  const ParkingLotFigures({required this.lot, required this.totals});

  final ParkingLot lot;

  /// The same math as the business's own scoreboard, over this lot's cars
  /// only; `spacesTotal` is the lot's usable spaces.
  final BusinessParkingTotals totals;

  String get lotId => lot.id;

  /// Cars in the lot now (walk-ups standing there plus bookings holding a
  /// space).
  int get used => totals.spacesUsed;

  /// Spaces still free; never negative.
  int get free {
    final left = totals.spacesTotal - totals.spacesUsed;
    return left > 0 ? left : 0;
  }

  /// Whether the lot says it has no space left (a lot with no spaces set is
  /// never "full").
  bool get isFull =>
      totals.spacesTotal > 0 && totals.spacesUsed >= totals.spacesTotal;
}

/// Whether a lot's figures say it has no space left (null: unknown, so not).
bool parkingLotIsFull(ParkingLotFigures? figures) => figures?.isFull ?? false;

/// The figures of every lot that is open or still holds cars or money, from
/// the cars in view (the live, open work the home listens to). Closed lots
/// with nothing in them are left out.
List<ParkingLotFigures> parkingLotFigures({
  required Iterable<ParkingLot> lots,
  required Iterable<Map<String, dynamic>> rows,
  required String businessId,
  DateTime? now,
}) {
  final byLot = <String, List<Map<String, dynamic>>>{
    for (final lot in lots) lot.id: <Map<String, dynamic>>[],
  };
  for (final row in rows) {
    byLot[parkingLotIdOf(row, businessId)]?.add(row);
  }
  final out = <ParkingLotFigures>[];
  for (final lot in lots) {
    final totals = businessParkingTotals(
      byLot[lot.id] ?? const [],
      spacesTotal: lot.usableSpaces,
      now: now,
    );
    if (!lot.open && totals.spacesUsed == 0 && totals.owed <= 0) continue;
    out.add(ParkingLotFigures(lot: lot, totals: totals));
  }
  return out;
}

/// Whether a car is in the lot the list is narrowed to ('' keeps every car).
bool parkingLotMatchesFilter(
  Map<String, dynamic> car,
  String businessId,
  String lotFilter,
) => lotFilter.isEmpty || parkingLotIdOf(car, businessId) == lotFilter;

/// The lot the form opens on: the one this person used last on this device,
/// when it is still open and has room; else the first open lot with room;
/// else the first open lot (the server then says it is full).
String defaultParkingLotId(
  Iterable<ParkingLot> lots,
  String businessId,
  String remembered, [
  Iterable<ParkingLotFigures> figures = const [],
]) {
  final open = openParkingLots(lots);
  bool hasRoom(ParkingLot lot) =>
      !parkingLotIsFull(figures.where((f) => f.lotId == lot.id).firstOrNull);
  final withRoom = open.where(hasRoom).toList();
  for (final lot in withRoom) {
    if (lot.id == remembered) return lot.id;
  }
  if (withRoom.isNotEmpty) return withRoom.first.id;
  for (final lot in open) {
    if (lot.id == remembered) return lot.id;
  }
  if (open.isNotEmpty) return open.first.id;
  return mainParkingLotId(businessId);
}

/// What the owner types for a lot.
class ParkingLotDraft {
  const ParkingLotDraft({
    this.name = '',
    this.addressLine1 = '',
    this.city = '',
    this.state = '',
    this.zipCode = '',
    this.totalSpaces = '',
    this.blockedSpaces = '',
    this.open = true,
  });

  /// A draft that reads a stored lot back.
  factory ParkingLotDraft.from(ParkingLot? lot) => lot == null
      ? const ParkingLotDraft()
      : ParkingLotDraft(
          name: lot.name,
          addressLine1: lot.addressLine1,
          city: lot.city,
          state: lot.state,
          zipCode: lot.zipCode,
          totalSpaces: '${lot.totalSpaces}',
          blockedSpaces: lot.blockedSpaces > 0 ? '${lot.blockedSpaces}' : '',
          open: lot.open,
        );

  final String name;
  final String addressLine1;
  final String city;
  final String state;
  final String zipCode;
  final String totalSpaces;
  final String blockedSpaces;
  final bool open;
}

/// What is wrong with a lot as typed, in the server's own vocabulary.
enum ParkingLotError {
  nameRequired('lot_name_required'),
  nameTaken('lot_name_taken'),
  spacesInvalid('lot_spaces_invalid'),
  blockedInvalid('lot_blocked_invalid');

  const ParkingLotError(this.reason);

  /// The server's `details.reason`.
  final String reason;
}

/// The server's `normalizeLot`, told before the trip.
List<ParkingLotError> parkingLotDraftErrors(
  ParkingLotDraft draft,
  Iterable<ParkingLot> lots, {
  String lotId = '',
}) {
  final errors = <ParkingLotError>[];
  final name = _text(draft.name, 60);
  if (name.isEmpty) {
    errors.add(ParkingLotError.nameRequired);
  } else if (lots.any(
    (lot) => lot.id != lotId && lot.name.toLowerCase() == name.toLowerCase(),
  )) {
    errors.add(ParkingLotError.nameTaken);
  }
  int? whole(String typed) {
    final number = num.tryParse(typed);
    if (number == null || !number.isFinite || number != number.truncate()) {
      return null;
    }
    return number.toInt();
  }

  final typedTotal = draft.totalSpaces.trim();
  final total = typedTotal.isEmpty ? null : whole(typedTotal);
  if (total == null || total < 0 || total > 100000) {
    errors.add(ParkingLotError.spacesInvalid);
  }
  final typedBlocked = draft.blockedSpaces.trim();
  final blocked = typedBlocked.isEmpty ? 0 : whole(typedBlocked);
  if (blocked == null || blocked < 0 || (total != null && blocked > total)) {
    errors.add(ParkingLotError.blockedInvalid);
  }
  return errors;
}

/// The refusal reasons the server gives (`parking_lots.LOT_MESSAGES`); the
/// screens turn each into a sentence in the reader's language.
const parkingLotRefusalReasons = <String>{
  'lot_name_required',
  'lot_name_taken',
  'lot_spaces_invalid',
  'lot_blocked_invalid',
  'lot_not_found',
  'lot_closed',
  'lot_full',
  'lot_has_cars',
  'lot_last_open',
  'lot_limit',
};

/// The lot refusal a failed call carries, or '' when the failure is not one.
String parkingLotRefusalReason(Object? failure) {
  if (failure is! FirebaseFunctionsException) return '';
  final details = failure.details;
  if (details is! Map) return '';
  final reason = _text(details['reason'], 60);
  return parkingLotRefusalReasons.contains(reason) ? reason : '';
}

/// `updateBusinessParkingEntry` action `lot_save`.
Map<String, dynamic> parkingLotSaveRequest(
  String businessId,
  ParkingLotDraft draft, {
  String lotId = '',
}) => <String, dynamic>{
  'action': 'lot_save',
  'businessId': businessId,
  if (lotId.isNotEmpty) 'lotId': lotId,
  'lot': <String, dynamic>{
    'name': _text(draft.name, 60),
    'addressLine1': _text(draft.addressLine1),
    'city': _text(draft.city, 120),
    'state': _text(draft.state, 80),
    'zipCode': _text(draft.zipCode, 20),
    'totalSpaces': _whole(draft.totalSpaces),
    'blockedSpaces': _whole(draft.blockedSpaces),
    'active': draft.open,
  },
};

/// `updateBusinessParkingEntry` action `lot_move`.
Map<String, dynamic> parkingLotMoveRequest(
  String entryId,
  String parkingLotId,
) => <String, dynamic>{
  'action': 'lot_move',
  'entryId': entryId,
  'parkingLotId': parkingLotId,
};

/// `updateBusinessParkingEntry` action `lot_booking`.
Map<String, dynamic> parkingLotBookingRequest(
  String businessId,
  String lotId,
) => <String, dynamic>{
  'action': 'lot_booking',
  'businessId': businessId,
  'lotId': lotId,
};

/// The business's own lot settings, as read before any lot is saved (a
/// business that never set lots up has one lot: its own parking settings).
class ParkingBusinessSettings {
  const ParkingBusinessSettings({
    this.totalSpaces = 0,
    this.blockedSpaces = 0,
    this.bookingLotId = '',
  });

  factory ParkingBusinessSettings.fromBusiness(Map<String, dynamic>? data) =>
      ParkingBusinessSettings(
        totalSpaces: _whole(data?['parkingTotalSpaces']),
        blockedSpaces: _whole(data?['parkingBlockedSpaces']),
        bookingLotId: _text(data?['parkingBookingLotId']),
      );

  final int totalSpaces;
  final int blockedSpaces;

  /// Where online bookings go ('' until the owner chooses).
  final String bookingLotId;
}

/// What the settings list shows: the stored lots, or - before the first save -
/// the one lot that is the business's own settings, under the default name.
List<ParkingLot> parkingLotsOrFirst({
  required List<ParkingLot> stored,
  required String businessId,
  required ParkingBusinessSettings settings,
  String firstName = 'Lot 1',
}) {
  if (stored.isNotEmpty) return stored;
  return [
    ParkingLot(
      id: '',
      name: firstName,
      totalSpaces: settings.totalSpaces,
      blockedSpaces: settings.blockedSpaces,
      isMain: true,
    ),
  ];
}

/// The lot online bookings go to: the owner's choice while it is an open lot,
/// else the first open lot.
String parkingBookingLotIdOf(
  Iterable<ParkingLot> lots,
  ParkingBusinessSettings settings,
) {
  final open = openParkingLots(lots);
  for (final lot in open) {
    if (lot.id == settings.bookingLotId) return lot.id;
  }
  return open.isEmpty ? '' : open.first.id;
}

/// What `lot_move` answered.
class ParkingLotMoveResult {
  const ParkingLotMoveResult({
    required this.moved,
    required this.parkingLotId,
    required this.parkingLotName,
  });

  factory ParkingLotMoveResult.fromCallable(Object? data) {
    final row = data is Map ? data : const <Object?, Object?>{};
    return ParkingLotMoveResult(
      moved: row['moved'] != false,
      parkingLotId: _text(row['parkingLotId']),
      parkingLotName: _text(row['parkingLotName'], 60),
    );
  }

  /// False when the car was already in that lot (nothing changed).
  final bool moved;
  final String parkingLotId;
  final String parkingLotName;
}

String _lastLotKey(String businessId) => 'laawol.parkingLastLot.$businessId';

/// The lots, behind one seam so screens take a fake in tests (the same
/// pattern as [BusinessParkingService]).
class ParkingLotsService {
  ParkingLotsService({
    FirebaseFirestore? firestore,
    FirebaseFunctions? functions,
  }) : _firestore = firestore,
       _functions = functions;

  final FirebaseFirestore? _firestore;
  final FirebaseFunctions? _functions;

  FirebaseFirestore get _db => _firestore ?? FirebaseFirestore.instance;
  FirebaseFunctions get _fn => _functions ?? FirebaseFunctions.instance;

  /// The business's lots, live (readable by its own people).
  Stream<List<ParkingLot>> watchLots(String businessId) => _db
      .collection('parkingLots')
      .where('businessId', isEqualTo: businessId)
      .snapshots()
      .map(
        (snap) => sortedParkingLots([
          for (final doc in snap.docs) {...doc.data(), 'id': doc.id},
        ]),
      );

  /// The business's own parking numbers and booking lot.
  Future<ParkingBusinessSettings> readSettings(String businessId) async {
    final snap = await _db.collection('businesses').doc(businessId).get();
    return ParkingBusinessSettings.fromBusiness(snap.data());
  }

  /// How full each open lot is right now: the cars holding a space today or
  /// later, counted per lot. Empty when the read fails (then the form simply
  /// does not know which lot is full; the server still refuses a full one).
  Future<List<ParkingLotFigures>> readFigures(
    String businessId,
    List<ParkingLot> lots,
  ) async {
    try {
      final snap = await parkedCarsOnLotSpec(
        businessId,
        DateTime.now(),
      ).build(_db).get();
      return parkingLotFigures(
        lots: lots,
        rows: [
          for (final doc in snap.docs) {...doc.data(), 'id': doc.id},
        ],
        businessId: businessId,
      );
    } catch (_) {
      return const [];
    }
  }

  Future<void> saveLot({
    required String businessId,
    required ParkingLotDraft draft,
    String lotId = '',
  }) async {
    await _fn
        .httpsCallable('updateBusinessParkingEntry')
        .call<Object?>(parkingLotSaveRequest(businessId, draft, lotId: lotId));
  }

  /// Makes the business's first lot real (the server creates it from the
  /// business's own settings) and points online bookings at [lotId].
  Future<void> setBookingLot({
    required String businessId,
    required String lotId,
  }) async {
    await _fn
        .httpsCallable('updateBusinessParkingEntry')
        .call<Object?>(parkingLotBookingRequest(businessId, lotId));
  }

  Future<ParkingLotMoveResult> moveCar({
    required String entryId,
    required String parkingLotId,
  }) async {
    final response = await _fn
        .httpsCallable('updateBusinessParkingEntry')
        .call<Object?>(parkingLotMoveRequest(entryId, parkingLotId));
    return ParkingLotMoveResult.fromCallable(response.data);
  }

  /// The lot this person used last on this device ('' when none).
  Future<String> rememberedLot(String businessId) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return _text(prefs.getString(_lastLotKey(businessId)));
    } catch (_) {
      return '';
    }
  }

  Future<void> rememberLot(String businessId, String lotId) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_lastLotKey(businessId), lotId);
    } catch (_) {
      // Nothing kept: the form then opens on the first lot with room.
    }
  }
}
