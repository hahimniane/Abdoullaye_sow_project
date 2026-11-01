import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/parked_car.dart';
import 'package:my_flutter_app/screens/parking_month_end_screen.dart';
import 'package:my_flutter_app/services/business_parking_entry.dart';
import 'package:my_flutter_app/services/lot_ledger.dart' show LotStaff;
import 'package:my_flutter_app/services/parking_month_statement.dart';
import 'package:my_flutter_app/services/parking_team.dart';
import 'package:my_flutter_app/services/staff_expense_credit.dart';
import 'package:my_flutter_app/widgets/parking_whose_car.dart';

/// A team member's own car on the lot (docs/PARKING_TEAM_CARS.md): the
/// "Whose car?" choice, what it sends, and the labels. The fixture-driven
/// mirror cases live in `parking_carryover_test.dart` and
/// `staff_expense_credit_test.dart`.
void main() {
  setUpAll(() async {
    await initializeDateFormatting('en');
    await initializeDateFormatting('fr');
  });

  BusinessParkingEntryDraft draft({
    String forStaffId = '',
    String name = 'Musa Kante',
    String phone = '2015550199',
    BusinessParkingPaymentMethod method = BusinessParkingPaymentMethod.direct,
  }) => BusinessParkingEntryDraft(
    businessId: 'lot',
    forStaffId: forStaffId,
    customerName: name,
    customerPhone: phone,
    carMake: 'Honda',
    carModel: 'Accord',
    carYear: '2012',
    startDate: DateTime(2026, 10, 1),
    paymentMethod: method,
  );

  group('the add payload', () {
    test('a team member sends forStaffId and needs no name or phone', () {
      final team = draft(forStaffId: ' staff-musa ', name: '', phone: '');
      expect(validateBusinessParkingEntry(team), isEmpty);
      final payload = businessParkingEntryPayload(team);
      expect(payload['forStaffId'], 'staff-musa');
      expect(payload['customerName'], '');
      expect(payload['customerPhone'], '');
    });

    test('someone else still needs both, and sends no forStaffId', () {
      final other = draft(name: '', phone: '');
      expect(
        validateBusinessParkingEntry(other),
        containsAll([
          BusinessParkingEntryError.customerNameRequired,
          BusinessParkingEntryError.customerPhoneRequired,
        ]),
      );
      expect(
        businessParkingEntryPayload(draft()).containsKey('forStaffId'),
        isFalse,
        reason: 'an absent field is how the server hears "someone else"',
      );
    });
  });

  group('the edit change', () {
    test('ties, moves and unties; unchanged sends nothing', () {
      expect(businessParkingTeamChange(current: '', next: 'staff-a'), {
        'forStaffId': 'staff-a',
      });
      expect(businessParkingTeamChange(current: 'staff-a', next: 'staff-b'), {
        'forStaffId': 'staff-b',
      });
      expect(businessParkingTeamChange(current: 'staff-a', next: ''), {
        'forStaffId': '',
      });
      expect(
        businessParkingTeamChange(current: 'staff-a', next: ' staff-a '),
        isEmpty,
      );
      expect(businessParkingTeamChange(current: '', next: ''), isEmpty);
    });

    test('the details screen sends it, and shows name and phone to untie', () {
      final screen = File(
        'lib/screens/parked_car_details_screen.dart',
      ).readAsStringSync();
      expect(screen, contains('businessParkingTeamChange('));
      expect(screen, contains("current: (_paymentFields['forStaffId']"));
      // Prefilled from the car, and validated like any car when untying.
      expect(screen, contains('_teamStaffId = widget.parkedCar.forStaffId'));
      expect(screen, contains('_teamCar = _teamStaffId.isNotEmpty'));
      expect(
        screen,
        contains('if (!(canEdit && isBusinessEntry && _teamCar)) ...['),
      );
      expect(screen, contains('isBusinessEntry && !(canEdit && _teamCar)'));
      expect(screen, contains('forStaffId: team ? _teamStaffId : \'\','));
    });
  });

  group('the add screen', () {
    final screen = File('lib/screens/park_car_screen.dart').readAsStringSync();

    test('Someone else is the default and Team member hides the customer', () {
      expect(screen, contains('bool _teamCar = false;'));
      expect(screen, contains('ParkingWhoseCarChoice('));
      expect(screen, contains('if (!_teamCar) ...['));
      expect(screen, contains('forStaffId: team ? _teamStaffId : \'\','));
      expect(
        screen,
        contains("customerName: team ? '' : _nameController.text"),
      );
    });

    test('the picker reuses the Received-by staff list and adds the owner', () {
      expect(screen, contains('for (final c in _staffCustomers)'));
      expect(screen, contains('withBusinessOwner('));
    });

    test('staff are no longer mixed into the customer suggestions', () {
      expect(screen, contains('lotCustomerSources(saved, const [])'));
      expect(
        screen,
        isNot(contains('lotCustomerSources(saved, _staffCustomers)')),
      );
      final loader = screen.indexOf('Future<void> _loadStaffAsCustomers(');
      final body = screen.substring(loader, screen.indexOf('\n  }', loader));
      expect(body, isNot(contains('_lotCustomers')));
    });
  });

  group('the labels', () {
    test('Team, Former team member, or nothing', () {
      expect(parkingTeamTagOf('', {'a'}), ParkingTeamTag.none);
      expect(parkingTeamTagOf('a', {'a', 'b'}), ParkingTeamTag.team);
      expect(parkingTeamTagOf('gone', {'a', 'b'}), ParkingTeamTag.former);
      // The team could not be read: never call anyone "former".
      expect(parkingTeamTagOf('a', const <String>{}), ParkingTeamTag.team);
    });

    test('the parked car model reads forStaffId and forStaffName', () {
      final car = ParkedCar(
        id: 'c1',
        trackingCode: 'PK-1',
        ownerName: 'Musa',
        carMake: 'Honda',
        carModel: 'Accord',
        carYear: '2012',
        vinNumber: '',
        parkingDate: DateTime(2026, 10, 1),
        paymentFields: const {
          'forStaffId': ' staff-musa ',
          'forStaffName': 'Musa Kante',
        },
      );
      expect(car.forStaffId, 'staff-musa');
      expect(car.forStaffName, 'Musa Kante');
      expect(car.isTeamCar, isTrue);
      expect(
        ParkedCar(
          id: 'c2',
          trackingCode: 'PK-2',
          ownerName: 'Mariam',
          carMake: 'Ford',
          carModel: 'Focus',
          carYear: '2010',
          vinNumber: '',
          parkingDate: DateTime(2026, 10, 1),
        ).isTeamCar,
        isFalse,
      );
    });

    test('the list row and Month end show them', () {
      final home = File('lib/screens/home_menu.dart').readAsStringSync();
      expect(home, contains('if (car.isTeamCar) ...['));
      expect(home, contains('parkingTeamTagOf('));
      final monthEnd = File(
        'lib/screens/parking_month_end_screen.dart',
      ).readAsStringSync();
      expect(monthEnd, contains('customer.forStaffId.isNotEmpty'));
    });
  });

  group('the mirrors', () {
    test('parkingCustomerKeyOf puts a team car under the person', () {
      expect(
        parkingCustomerKeyOf('+1 (201) 555-0199', 'Musa', 'staff-musa'),
        'staff:staff-musa',
      );
      expect(
        parkingCustomerKeyOf('+1 (201) 555-0199', 'Musa'),
        'phone:2015550199',
      );
      expect(parkingCustomerKeyOf('', 'Musa  K', '  '), 'name:musa k');
    });

    test('items, carried cars and customers carry forStaffId', () {
      final fixture =
          jsonDecode(
                File(
                  'functions/test/fixtures/parking-carryover-cases.json',
                ).readAsStringSync(),
              )
              as Map<String, dynamic>;
      final k = (fixture['cases'] as List).cast<Map<String, dynamic>>().last;
      final summary = parkingMonthSummary(
        [
          for (final c in k['cars'] as List)
            Map<String, dynamic>.from(c as Map),
        ],
        k['monthKey'] as String,
        DateTime.parse(k['now'] as String),
      );
      final team = summary.customers.firstWhere(
        (c) => c.key.startsWith('staff:'),
      );
      expect(team.forStaffId, 'staff-musa');
      expect(team.cars.single.forStaffId, 'staff-musa');
      expect(team.olderCars.single.forStaffId, 'staff-musa');
      final other = summary.customers.firstWhere(
        (c) => c.key.startsWith('phone:'),
      );
      expect(other.forStaffId, '');
    });

    test(
      'one credit is used once: the own staff: bill first, input order kept',
      () {
        final net = netStaffExpenses(
          [
            (key: 'phone:2015550199', dueCents: 5000),
            (key: 'staff:s1', dueCents: 3000),
          ],
          entries: [
            {
              'id': 'e1',
              'paidByStaffId': 's1',
              'amountCents': 4000,
              'month': '2026-10',
              'spentAtMs': 1,
            },
          ],
          links: {
            's1': {'customerKey': 'phone:2015550199', 'customerName': 'Musa'},
          },
          monthKey: '2026-10',
          staffNames: {'s1': 'Musa Kante'},
        );
        // Same order as the input; the staff: bill took 3000 first, the linked
        // number only what is left (1000).
        expect(
          [for (final c in net.customers) c.key],
          ['phone:2015550199', 'staff:s1'],
        );
        expect(net.customers[1].expenseCreditCents, 3000);
        expect(net.customers[0].expenseCreditCents, 1000);
        expect(net.businessOwes, isEmpty);
      },
    );

    test('a staff: customer needs no link, and Business owes names it', () {
      final net = netStaffExpenses(
        [(key: 'staff:s2', dueCents: 1000)],
        entries: [
          {
            'id': 'e1',
            'paidByStaffId': 's2',
            'amountCents': 2500,
            'month': '2026-10',
            'spentAtMs': 1,
          },
        ],
        monthKey: '2026-10',
        staffNames: {'s2': 'Aminata'},
      );
      expect(net.customers.single.linkedStaffIds, ['s2']);
      expect(net.customers.single.dueCents, 0);
      expect(net.businessOwes.single.customerKey, 'staff:s2');
      expect(net.businessOwes.single.owedCents, 1500);
    });
  });

  group('widgets', () {
    Widget host(Widget child, Locale locale) => MaterialApp(
      locale: locale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(body: SingleChildScrollView(child: child)),
    );

    const team = [
      LotStaff(id: 'owner', name: 'Business owner'),
      LotStaff(id: 'staff-musa', name: 'Musa Kante'),
    ];

    for (final code in ['en', 'fr']) {
      testWidgets('Whose car? offers the choice and the picker ($code)', (
        tester,
      ) async {
        final l10n = lookupAppLocalizations(Locale(code));
        var teamCar = false;
        var picked = '';
        await tester.pumpWidget(
          StatefulBuilder(
            builder: (context, setState) => host(
              ParkingWhoseCarChoice(
                teamCar: teamCar,
                staffId: picked,
                team: team,
                onTeamCarChanged: (v) => setState(() => teamCar = v),
                onStaffChanged: (id) => setState(() => picked = id),
              ),
              Locale(code),
            ),
          ),
        );
        expect(find.text(l10n.parkingWhoseCar), findsOneWidget);
        expect(find.text(l10n.parkingWhoseCarSomeoneElse), findsOneWidget);
        expect(find.text(l10n.parkingWhoseCarTeamMember), findsOneWidget);
        // Someone else is the default: no picker, no hint.
        expect(find.byKey(const Key('parking-team-member-hint')), findsNothing);

        await tester.tap(find.text(l10n.parkingWhoseCarTeamMember));
        await tester.pumpAndSettle();
        expect(teamCar, isTrue);
        expect(find.text(l10n.parkingTeamMemberHint), findsOneWidget);

        await tester.tap(find.text(l10n.parkingTeamMemberPicker));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Musa Kante').last);
        await tester.pumpAndSettle();
        expect(picked, 'staff-musa');
      });

      testWidgets('the Month end card says Team member ($code)', (
        tester,
      ) async {
        final l10n = lookupAppLocalizations(Locale(code));
        final fixture =
            jsonDecode(
                  File(
                    'functions/test/fixtures/parking-carryover-cases.json',
                  ).readAsStringSync(),
                )
                as Map<String, dynamic>;
        final k = (fixture['cases'] as List).cast<Map<String, dynamic>>().last;
        final summary = parkingMonthSummary(
          [
            for (final c in k['cars'] as List)
              Map<String, dynamic>.from(c as Map),
          ],
          k['monthKey'] as String,
          DateTime.parse(k['now'] as String),
        );
        await tester.pumpWidget(
          MaterialApp(
            locale: Locale(code),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Scaffold(
              body: ParkingMonthCustomerList(
                summary: summary,
                view: ParkingMonthView.owing,
                onTap: (_) {},
              ),
            ),
          ),
        );
        expect(tester.takeException(), isNull);
        // One team card, one customer card: the label shows once.
        expect(find.text(l10n.parkingWhoseCarTeamMember), findsOneWidget);
      });

      testWidgets('Team and Former team member labels ($code)', (tester) async {
        final l10n = lookupAppLocalizations(Locale(code));
        await tester.pumpWidget(
          host(
            const Column(
              children: [
                ParkingTeamTagChip(tag: ParkingTeamTag.team),
                ParkingTeamTagChip(tag: ParkingTeamTag.former),
                ParkingTeamTagChip(tag: ParkingTeamTag.none),
              ],
            ),
            Locale(code),
          ),
        );
        expect(find.text(l10n.parkingTeamTag), findsOneWidget);
        expect(find.text(l10n.parkingFormerTeamTag), findsOneWidget);
        expect(find.byKey(const Key('parking-team-tag')), findsNWidgets(2));
      });
    }

    test('French copy is real French, not the English fallback', () {
      final en = lookupAppLocalizations(const Locale('en'));
      final fr = lookupAppLocalizations(const Locale('fr'));
      for (final pair in [
        (en.parkingWhoseCar, fr.parkingWhoseCar),
        (en.parkingWhoseCarSomeoneElse, fr.parkingWhoseCarSomeoneElse),
        (en.parkingWhoseCarTeamMember, fr.parkingWhoseCarTeamMember),
        (en.parkingTeamMemberPicker, fr.parkingTeamMemberPicker),
        (en.parkingTeamMemberRequired, fr.parkingTeamMemberRequired),
        (en.parkingTeamMemberHint, fr.parkingTeamMemberHint),
        (en.parkingTeamTag, fr.parkingTeamTag),
        (en.parkingFormerTeamTag, fr.parkingFormerTeamTag),
      ]) {
        expect(pair.$2, isNot(pair.$1));
        expect(pair.$2, isNotEmpty);
      }
      expect(fr.parkingTeamMemberHint, contains('Soldes du personnel'));
    });
  });
}
