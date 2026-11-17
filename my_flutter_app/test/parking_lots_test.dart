import 'dart:convert';
import 'dart:io';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/business_parking_entry.dart';
import 'package:my_flutter_app/services/parking_lots.dart';

/// The pure parking-lot rules (docs/PARKING_LOTS.md), held to the same cases
/// as the console's `admin_web/src/lib/parking-lots.test.ts` and to the
/// server's refusal list (`functions/parking_lots.js`).

final _rows = <Map<String, dynamic>>[
  {
    'id': 'lot-2',
    'businessId': 'b1',
    'name': 'Lot 2',
    'totalSpaces': 40,
    'sortOrder': 1,
    'addressLine1': '9 Second Street',
    'city': 'Bronx',
  },
  {
    'id': 'b1_main',
    'businessId': 'b1',
    'name': 'Lot 1',
    'totalSpaces': 60,
    'blockedSpaces': 4,
    'isMain': true,
    'sortOrder': 0,
  },
  {
    'id': 'lot-3',
    'businessId': 'b1',
    'name': 'Lot 3',
    'totalSpaces': 7,
    'sortOrder': 2,
    'active': false,
  },
];

final _lots = sortedParkingLots(_rows);

ParkingLotFigures _told(String id, int used, int total) => ParkingLotFigures(
  lot: ParkingLot(id: id, name: id, totalSpaces: total),
  totals: BusinessParkingTotals(
    inLot: used,
    reserved: 0,
    left: 0,
    collected: 0,
    owed: 0,
    spacesTotal: total,
    spacesUsed: used,
  ),
);

Map<String, dynamic> _walkUp(String id, {String lot = ''}) => {
  'id': id,
  'businessId': 'b1',
  'source': 'business',
  'status': 'active',
  if (lot.isNotEmpty) 'parkingLotId': lot,
  'parkingDate': DateTime.now().subtract(const Duration(days: 1)),
};

void main() {
  test('lots list open ones first, the first lot leading', () {
    expect(_lots.map((l) => [l.id, l.open]).toList(), [
      ['b1_main', true],
      ['lot-2', true],
      ['lot-3', false],
    ]);
    expect(openParkingLots(_lots).map((l) => l.id), ['b1_main', 'lot-2']);
    expect(_lots[0].blockedSpaces, 4);
    expect(_lots[0].usableSpaces, 56);
    expect(sortedParkingLots(null), isEmpty);
  });

  test('a car with no lot stands in the first lot', () {
    expect(mainParkingLotId('b1'), 'b1_main');
    expect(parkingLotIdOf(const {}, 'b1'), 'b1_main');
    expect(parkingLotIdOf({'parkingLotId': ''}, 'b1'), 'b1_main');
    expect(parkingLotIdOf({'parkingLotId': 'lot-2'}, 'b1'), 'lot-2');
    expect(parkingLotIdOf({'businessId': 'b1'}, ''), 'b1_main');
    expect(parkingLotNameOf(const {}, 'b1', _lots), 'Lot 1');
    expect(
      parkingLotNameOf(
        {'parkingLotId': 'lot-2', 'parkingLotName': 'Old name'},
        'b1',
        _lots,
      ),
      'Lot 2',
    );
    // No lots listed: the copy the car carries, or nothing.
    expect(
      parkingLotNameOf(
        {'parkingLotId': 'x', 'parkingLotName': 'Lot 9'},
        'b1',
        const [],
      ),
      'Lot 9',
    );
    expect(parkingLotNameOf(const {}, 'b1', const []), '');
  });

  test('staff are asked for a lot only with two or more open lots', () {
    expect(asksForParkingLot(_lots), isTrue);
    expect(asksForParkingLot(_lots.take(1)), isFalse);
    expect(asksForParkingLot([_lots[0], _lots[2]]), isFalse);
    expect(asksForParkingLot(const []), isFalse);
  });

  test('the form opens on the last lot used, when open and with room', () {
    expect(defaultParkingLotId(_lots, 'b1', 'lot-2'), 'lot-2');
    expect(defaultParkingLotId(_lots, 'b1', ''), 'b1_main');
    // A remembered lot that has since closed is not offered.
    expect(defaultParkingLotId(_lots, 'b1', 'lot-3'), 'b1_main');
    expect(defaultParkingLotId(const [], 'b1', 'lot-2'), 'b1_main');
    expect(_told('x', 2, 2).isFull, isTrue);
    expect(_told('x', 1, 2).isFull, isFalse);
    expect(_told('x', 3, 0).isFull, isFalse);
    expect(parkingLotIsFull(null), isFalse);
    // A full remembered lot is skipped for one with room; with every lot
    // full the remembered one stays and the server says it is full.
    expect(
      defaultParkingLotId(_lots, 'b1', 'lot-2', [
        _told('lot-2', 2, 2),
        _told('b1_main', 1, 60),
      ]),
      'b1_main',
    );
    expect(
      defaultParkingLotId(_lots, 'b1', 'lot-2', [_told('lot-2', 1, 2)]),
      'lot-2',
    );
    expect(
      defaultParkingLotId(_lots, 'b1', 'lot-2', [
        _told('lot-2', 2, 2),
        _told('b1_main', 60, 60),
      ]),
      'lot-2',
    );
  });

  test('what the owner types is checked as the server checks it', () {
    List<ParkingLotError> errorsOf(String name, String total, String blocked) =>
        parkingLotDraftErrors(
          ParkingLotDraft(
            name: name,
            totalSpaces: total,
            blockedSpaces: blocked,
          ),
          _lots,
        );
    expect(errorsOf('Lot 4', '10', ''), isEmpty);
    expect(errorsOf('', '10', ''), [ParkingLotError.nameRequired]);
    expect(errorsOf('lot 1', '10', ''), [ParkingLotError.nameTaken]);
    expect(errorsOf('Lot 4', '', ''), [ParkingLotError.spacesInvalid]);
    // As the server answers it (checked against normalizeLot): a negative
    // total is also less than zero blocked spaces.
    expect(errorsOf('Lot 4', '-1', ''), [
      ParkingLotError.spacesInvalid,
      ParkingLotError.blockedInvalid,
    ]);
    expect(errorsOf('Lot 4', '1.5', ''), [ParkingLotError.spacesInvalid]);
    expect(errorsOf('Lot 4', '2', '3'), [ParkingLotError.blockedInvalid]);
    // Renaming a lot to its own name is not a clash.
    expect(
      parkingLotDraftErrors(
        const ParkingLotDraft(name: 'Lot 1', totalSpaces: '5'),
        _lots,
        lotId: 'b1_main',
      ),
      isEmpty,
    );
  });

  test('the figures count each lot over its own cars', () {
    final figures = parkingLotFigures(
      lots: _lots,
      rows: [
        _walkUp('a'),
        _walkUp('b', lot: 'b1_main'),
        _walkUp('c', lot: 'lot-2'),
        {..._walkUp('d', lot: 'lot-2'), 'voided': true},
      ],
      businessId: 'b1',
    );
    // The closed, empty lot is left out.
    expect(figures.map((f) => f.lotId), ['b1_main', 'lot-2']);
    expect(figures[0].used, 2);
    expect(figures[0].free, 54);
    expect(figures[1].used, 1);
    expect(figures[1].free, 39);
    expect(figures.any((f) => f.isFull), isFalse);
    expect(parkingLotMatchesFilter(_walkUp('a'), 'b1', 'b1_main'), isTrue);
    expect(parkingLotMatchesFilter(_walkUp('a'), 'b1', 'lot-2'), isFalse);
    expect(parkingLotMatchesFilter(_walkUp('a'), 'b1', ''), isTrue);
  });

  test('the requests name the action the server routes', () {
    final draft = ParkingLotDraft.from(_lots[1]);
    expect(parkingLotSaveRequest('b1', draft, lotId: 'lot-2'), {
      'action': 'lot_save',
      'businessId': 'b1',
      'lotId': 'lot-2',
      'lot': {
        'name': 'Lot 2',
        'addressLine1': '9 Second Street',
        'city': 'Bronx',
        'state': '',
        'zipCode': '',
        'totalSpaces': 40,
        'blockedSpaces': 0,
        'active': true,
      },
    });
    expect(
      parkingLotSaveRequest('b1', const ParkingLotDraft()).containsKey('lotId'),
      isFalse,
    );
    expect(parkingLotMoveRequest('car-1', 'lot-2'), {
      'action': 'lot_move',
      'entryId': 'car-1',
      'parkingLotId': 'lot-2',
    });
    expect(parkingLotBookingRequest('b1', 'lot-2'), {
      'action': 'lot_booking',
      'businessId': 'b1',
      'lotId': 'lot-2',
    });
    final server = File('functions/index.js').readAsStringSync();
    expect(
      server,
      matches(
        RegExp(
          r'PARKING_LOT_ACTIONS = Object\.freeze\(\s*\["lot_save", "lot_booking", "lot_move"\]\);',
        ),
      ),
    );
  });

  test('a car is parked in a lot only when one was asked for', () {
    BusinessParkingEntryDraft draft(String lot) => BusinessParkingEntryDraft(
      businessId: 'b1',
      customerName: 'A',
      customerPhone: '+13475550101',
      carMake: 'Toyota',
      carModel: 'Corolla',
      carYear: '2018',
      startDate: DateTime(2026, 11, 1),
      parkingLotId: lot,
    );
    expect(
      businessParkingEntryPayload(draft('lot-2'))['parkingLotId'],
      'lot-2',
    );
    // An absent field is how the server hears "the first open lot".
    expect(
      businessParkingEntryPayload(draft('')).containsKey('parkingLotId'),
      isFalse,
    );
  });

  test('refusals are read from details.reason, never from the message', () {
    FirebaseFunctionsException failure(Object? details) =>
        FirebaseFunctionsException(
          message: 'English words',
          code: 'failed-precondition',
          details: details,
        );
    expect(
      parkingLotRefusalReason(failure({'reason': 'lot_full'})),
      'lot_full',
    );
    expect(parkingLotRefusalReason(failure({'reason': 'other'})), '');
    expect(parkingLotRefusalReason(failure(null)), '');
    expect(parkingLotRefusalReason(StateError('x')), '');
  });

  test('every refusal the server gives is known here and has French', () {
    final source = File('functions/parking_lots.js').readAsStringSync();
    final block = RegExp(
      r'LOT_MESSAGES = Object\.freeze\(\{(.*?)\}\);',
      dotAll: true,
    ).firstMatch(source)!.group(1)!;
    final serverReasons = RegExp(
      r'(lot_[a-z_]+):',
    ).allMatches(block).map((m) => m.group(1)!).toSet();
    expect(parkingLotRefusalReasons, serverReasons);

    // Each reason is a sentence in both languages (the ARB keys).
    const keys = {
      'lot_name_required': 'pltRefusalNameRequired',
      'lot_name_taken': 'pltRefusalNameTaken',
      'lot_spaces_invalid': 'pltRefusalSpacesInvalid',
      'lot_blocked_invalid': 'pltRefusalBlockedInvalid',
      'lot_not_found': 'pltRefusalNotFound',
      'lot_closed': 'pltRefusalClosed',
      'lot_full': 'pltRefusalFull',
      'lot_has_cars': 'pltRefusalHasCars',
      'lot_last_open': 'pltRefusalLastOpen',
      'lot_limit': 'pltRefusalLimit',
    };
    expect(keys.keys.toSet(), serverReasons);
    final en =
        jsonDecode(File('lib/l10n/app_en.arb').readAsStringSync())
            as Map<String, dynamic>;
    final fr =
        jsonDecode(File('lib/l10n/app_fr.arb').readAsStringSync())
            as Map<String, dynamic>;
    for (final key in keys.values) {
      expect(en[key], isA<String>(), reason: key);
      expect(fr[key], isA<String>(), reason: key);
      expect(fr[key], isNot(en[key]), reason: '$key is not translated');
    }
  });

  test('every plt string exists in both languages', () {
    final en =
        jsonDecode(File('lib/l10n/app_en.arb').readAsStringSync())
            as Map<String, dynamic>;
    final fr =
        jsonDecode(File('lib/l10n/app_fr.arb').readAsStringSync())
            as Map<String, dynamic>;
    final enKeys = en.keys.where((k) => k.startsWith('plt')).toSet();
    final frKeys = fr.keys.where((k) => k.startsWith('plt')).toSet();
    expect(enKeys, isNotEmpty);
    expect(frKeys, enKeys);
  });

  test('settings before the first save show the one lot', () {
    final shown = parkingLotsOrFirst(
      stored: const [],
      businessId: 'b1',
      settings: const ParkingBusinessSettings(
        totalSpaces: 30,
        blockedSpaces: 2,
      ),
    );
    expect(shown.single.id, '');
    expect(shown.single.name, 'Lot 1');
    expect(shown.single.totalSpaces, 30);
    expect(shown.single.blockedSpaces, 2);
    expect(
      parkingBookingLotIdOf(
        _lots,
        const ParkingBusinessSettings(bookingLotId: 'lot-2'),
      ),
      'lot-2',
    );
    // A closed or unknown booking lot falls back to the first open lot.
    expect(
      parkingBookingLotIdOf(
        _lots,
        const ParkingBusinessSettings(bookingLotId: 'lot-3'),
      ),
      'b1_main',
    );
  });

  test('the home list, the car page and the profile are wired to the lots', () {
    final home = File('lib/screens/home_menu.dart').readAsStringSync();
    expect(home, contains('ParkingLotStrip('));
    expect(home, contains('parkingLotMatchesFilter('));
    expect(home, contains('ParkingLotBadge('));
    final details = File(
      'lib/screens/parked_car_details_screen.dart',
    ).readAsStringSync();
    expect(details, contains('ParkingLotMove('));
    final profile = File(
      'lib/screens/business_profile_screen.dart',
    ).readAsStringSync();
    expect(profile, contains('const ParkingLotsEntryRow()'));
    final park = File('lib/screens/park_car_screen.dart').readAsStringSync();
    expect(park, contains('ParkingLotChooser('));
    expect(park, contains('parkingLotId: _lotChoice.asks'));
  });
}
