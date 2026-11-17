import 'dart:async';
import 'dart:io';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/providers/auth_provider.dart';
import 'package:my_flutter_app/screens/business_profile_screen.dart';
import 'package:my_flutter_app/services/team_staff.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/team_member_card.dart'
    show ParkingLinkCarsLoader;
import 'package:provider/provider.dart';

/// The Team (People) section in the app: edit what a staff member can
/// manage, give or remove "Full access", and link a staff member's Parking
/// bill. Firebase is replaced by streams the test hands in and a fake caller
/// that records what the phone sends and answers (or refuses) as the
/// callables do.

class _Auth extends ChangeNotifier implements AuthProvider {
  _Auth({
    this.owner = false,
    this.realOwner = false,
    this.admin = false,
    this.platformRole,
  });

  final bool owner;
  final bool realOwner;
  final bool admin;
  final String? platformRole;

  /// The business's real owner.
  factory _Auth.realOwner() => _Auth(owner: true, realOwner: true);

  /// A staff member with Full access: an owner to the app, not the real one.
  factory _Auth.fullAccess() => _Auth(owner: true);

  /// Ordinary staff.
  factory _Auth.staff() => _Auth();

  /// A platform super admin.
  factory _Auth.superAdmin() => _Auth(admin: true, platformRole: 'superAdmin');

  @override
  bool get isBusinessOwner => owner;
  @override
  bool get isRealBusinessOwner => realOwner;
  @override
  bool get isAdmin => admin;
  @override
  String? get adminRole => platformRole;
  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.isGetter) return null;
    return super.noSuchMethod(invocation);
  }
}

class _Calls {
  final List<(String, Map<String, Object?>)> log = [];
  Object? Function(String name)? refuse;
  Completer<void>? hold;

  Future<Object?> call(String name, Map<String, Object?> payload) async {
    log.add((name, payload));
    await hold?.future;
    final error = refuse?.call(name);
    if (error != null) throw error;
    return {'success': true};
  }

  List<Map<String, Object?>> of(String name) => [
    for (final c in log)
      if (c.$1 == name) c.$2,
  ];
}

FirebaseFunctionsException _refusal(
  String reason, {
  String code = 'permission-denied',
}) => FirebaseFunctionsException(
  code: code,
  message: 'refused',
  details: {'reason': reason},
);

final _members = [
  const TeamMember(
    id: 'owner1',
    name: 'Keren Owner',
    email: 'owner@x.com',
    phone: '',
    role: 'businessOwner',
    permissions: [],
  ),
  const TeamMember(
    id: 'staff1',
    name: 'Abdoulaye Sow',
    email: 'abd@x.com',
    phone: '+13475628973',
    role: 'staff',
    permissions: ['parking', 'ledger'],
  ),
  const TeamMember(
    id: 'staff2',
    name: 'Hassimiou Niane',
    email: 'has@x.com',
    phone: '',
    role: 'staff',
    permissions: ['parking'],
    fullAccess: true,
  ),
];

final _cars = <Map<String, dynamic>>[
  {'id': 'c1', 'customerName': 'Abd Sow', 'customerPhone': '+1 (347) 562-8973'},
  {
    'id': 'c2',
    'customerName': 'Keren Customer',
    'customerPhone': '+19175550000',
  },
];

Future<List<Map<String, dynamic>>> _loadCars(String businessId) async => _cars;

Future<void> _pump(
  WidgetTester tester,
  AuthProvider auth,
  _Calls calls, {
  Locale locale = const Locale('en'),
  double width = 430,
  Map<String, dynamic> links = const {},
  List<TeamMember>? members,
  ParkingLinkCarsLoader? loadCars,
}) async {
  tester.view.physicalSize = Size(width, 4800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ChangeNotifierProvider<AuthProvider>.value(
      value: auth,
      child: MaterialApp(
        theme: AppTheme.light,
        locale: locale,
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        home: Scaffold(
          body: SingleChildScrollView(
            child: TeamPanel(
              key: UniqueKey(),
              businessId: 'b1',
              canAddStaff: false,
              membersStream: Stream.value(members ?? _members),
              parkingLinksStream: Stream.value(links),
              service: TeamStaffService(caller: calls.call),
              loadParkingCars: loadCars ?? _loadCars,
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Finder _key(String key) => find.byKey(Key(key));

Future<void> _tap(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

Future<void> _confirm(WidgetTester tester, String label) async {
  await tester.tap(find.widgetWithText(FilledButton, label).last);
  await tester.pumpAndSettle();
}

void main() {
  group('Who sees Full access', () {
    testWidgets(
      'the real owner can give it to staff and take it back, with the tag',
      (tester) async {
        await _pump(tester, _Auth.realOwner(), _Calls());
        expect(_key('team-full-access:staff1'), findsOneWidget);
        expect(
          find.descendant(
            of: _key('team-full-access:staff1'),
            matching: find.text('Give full access'),
          ),
          findsOneWidget,
        );
        expect(
          find.descendant(
            of: _key('team-full-access:staff2'),
            matching: find.text('Remove full access'),
          ),
          findsOneWidget,
        );
        // The tag, and the same explanation as the website.
        expect(
          find.descendant(
            of: _key('team-tag:staff2'),
            matching: find.text('Full access'),
          ),
          findsOneWidget,
        );
        expect(
          find.descendant(
            of: _key('team-tag:staff1'),
            matching: find.text('Staff'),
          ),
          findsOneWidget,
        );
        expect(
          find.descendant(
            of: _key('team-tag:owner1'),
            matching: find.text('Owner'),
          ),
          findsOneWidget,
        );
        expect(
          find.text(
            "Full access: everything the owner can do here, including settings, prices and staff. Transferring the business and its Stripe and bank stay the owner's.",
          ),
          findsNWidgets(2),
        );
        // Never on the owner.
        expect(_key('team-full-access:owner1'), findsNothing);
      },
    );

    testWidgets('a full-access person never sees the buttons, only the tag', (
      tester,
    ) async {
      await _pump(tester, _Auth.fullAccess(), _Calls());
      expect(_key('team-full-access:staff1'), findsNothing);
      expect(_key('team-full-access:staff2'), findsNothing);
      expect(find.text('Give full access'), findsNothing);
      expect(find.text('Remove full access'), findsNothing);
      // The tag and the note are still there to read.
      expect(
        find.descendant(
          of: _key('team-tag:staff2'),
          matching: find.text('Full access'),
        ),
        findsOneWidget,
      );
      expect(_key('team-full-access-note:staff2'), findsOneWidget);
      expect(_key('team-full-access-note:staff1'), findsNothing);
    });

    testWidgets('ordinary staff and a signed-out view never see them', (
      tester,
    ) async {
      await _pump(tester, _Auth.staff(), _Calls());
      expect(find.text('Give full access'), findsNothing);
      expect(find.text('Remove full access'), findsNothing);
      expect(find.text('Save permissions'), findsNothing);
      expect(find.text('Link'), findsNothing);
      expect(find.text('Unlink'), findsNothing);
    });

    testWidgets(
      'a platform super admin can; a platform admin who is not super cannot',
      (tester) async {
        await _pump(tester, _Auth.superAdmin(), _Calls());
        expect(_key('team-full-access:staff1'), findsOneWidget);
        await _pump(
          tester,
          _Auth(admin: true, platformRole: 'admin'),
          _Calls(),
        );
        expect(_key('team-full-access:staff1'), findsNothing);
      },
    );
  });

  group('Giving and removing Full access', () {
    testWidgets('give: asked first, then sent with the permissions unchanged', (
      tester,
    ) async {
      final calls = _Calls();
      await _pump(tester, _Auth.realOwner(), calls);
      await _tap(tester, _key('team-full-access:staff1'));
      expect(find.text('Give full access?'), findsOneWidget);
      expect(calls.log, isEmpty);
      await _confirm(tester, 'Give full access');
      expect(calls.of('updateBusinessStaffPermissions'), [
        {
          'businessId': 'b1',
          'staffUid': 'staff1',
          'businessPermissions': ['parking', 'ledger'],
          'fullAccess': true,
        },
      ]);
      expect(find.text('Full access given.'), findsOneWidget);
    });

    testWidgets('remove: sends fullAccess false', (tester) async {
      final calls = _Calls();
      await _pump(tester, _Auth.realOwner(), calls);
      await _tap(tester, _key('team-full-access:staff2'));
      expect(find.text('Remove full access?'), findsOneWidget);
      await _confirm(tester, 'Remove full access');
      final sent = calls.of('updateBusinessStaffPermissions').single;
      expect(sent['fullAccess'], false);
      expect(sent['staffUid'], 'staff2');
      expect(find.text('Full access removed.'), findsOneWidget);
    });

    testWidgets('cancelling sends nothing', (tester) async {
      final calls = _Calls();
      await _pump(tester, _Auth.realOwner(), calls);
      await _tap(tester, _key('team-full-access:staff1'));
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(calls.log, isEmpty);
    });

    testWidgets('a server refusal is said in words, and the button works again', (
      tester,
    ) async {
      final calls = _Calls()
        ..refuse = (_) => _refusal('full_access_owner_only');
      await _pump(tester, _Auth.realOwner(), calls);
      await _tap(tester, _key('team-full-access:staff1'));
      await _confirm(tester, 'Give full access');
      expect(
        find.text(
          'Only the business owner or a Laawol super admin can change full access.',
        ),
        findsOneWidget,
      );
      expect(find.text('Full access given.'), findsNothing);
      final button = tester.widget<OutlinedButton>(
        _key('team-full-access:staff1'),
      );
      expect(button.onPressed, isNotNull);
    });
  });

  group('Editing permissions', () {
    testWidgets('Save stays off until something changes', (tester) async {
      await _pump(tester, _Auth.fullAccess(), _Calls());
      final save = tester.widget<FilledButton>(
        _key('team-save-permissions:staff1'),
      );
      expect(save.onPressed, isNull);
      // The chips show what the person holds.
      expect(
        tester
            .widget<FilterChip>(
              find.descendant(
                of: _key('team-member:staff1'),
                matching: _key('permission-chip:parking'),
              ),
            )
            .selected,
        isTrue,
      );
      expect(
        tester
            .widget<FilterChip>(
              find.descendant(
                of: _key('team-member:staff1'),
                matching: _key('permission-chip:invoices'),
              ),
            )
            .selected,
        isFalse,
      );
    });

    testWidgets('tick one, save, confirm: sent as the new list', (
      tester,
    ) async {
      final calls = _Calls();
      await _pump(tester, _Auth.realOwner(), calls);
      await _tap(
        tester,
        find.descendant(
          of: _key('team-member:staff1'),
          matching: _key('permission-chip:invoices'),
        ),
      );
      await _tap(tester, _key('team-save-permissions:staff1'));
      expect(find.text('Save permissions?'), findsOneWidget);
      await _confirm(tester, 'Save permissions');
      expect(calls.of('updateBusinessStaffPermissions'), [
        {
          'businessId': 'b1',
          'staffUid': 'staff1',
          'businessPermissions': ['parking', 'ledger', 'invoices'],
        },
      ]);
      expect(
        calls
            .of('updateBusinessStaffPermissions')
            .single
            .containsKey('fullAccess'),
        isFalse,
      );
      expect(find.text('Staff permissions saved.'), findsOneWidget);
      // Saved: nothing left to save.
      expect(
        tester
            .widget<FilledButton>(_key('team-save-permissions:staff1'))
            .onPressed,
        isNull,
      );
    });

    testWidgets('untick one: it is dropped from what is sent', (tester) async {
      final calls = _Calls();
      await _pump(tester, _Auth.fullAccess(), calls);
      await _tap(
        tester,
        find.descendant(
          of: _key('team-member:staff1'),
          matching: _key('permission-chip:ledger'),
        ),
      );
      await _tap(tester, _key('team-save-permissions:staff1'));
      await _confirm(tester, 'Save permissions');
      expect(
        calls
            .of('updateBusinessStaffPermissions')
            .single['businessPermissions'],
        ['parking'],
      );
    });

    testWidgets(
      'a refusal is said in words and the edit is kept for another try',
      (tester) async {
        final calls = _Calls()
          ..refuse = (_) => FirebaseFunctionsException(
            code: 'permission-denied',
            message: 'Only business owners can update staff permissions',
          );
        await _pump(tester, _Auth.realOwner(), calls);
        await _tap(
          tester,
          find.descendant(
            of: _key('team-member:staff1'),
            matching: _key('permission-chip:invoices'),
          ),
        );
        await _tap(tester, _key('team-save-permissions:staff1'));
        await _confirm(tester, 'Save permissions');
        expect(
          find.text(
            'Your account is not allowed to do this. Ask the business owner.',
          ),
          findsOneWidget,
        );
        expect(
          tester
              .widget<FilledButton>(_key('team-save-permissions:staff1'))
              .onPressed,
          isNotNull,
        );
      },
    );

    testWidgets(
      'while saving, everything on the card waits, and it always comes back',
      (tester) async {
        final calls = _Calls()..hold = Completer<void>();
        await _pump(tester, _Auth.realOwner(), calls);
        await _tap(
          tester,
          find.descendant(
            of: _key('team-member:staff1'),
            matching: _key('permission-chip:invoices'),
          ),
        );
        await _tap(tester, _key('team-save-permissions:staff1'));
        await tester.tap(
          find.widgetWithText(FilledButton, 'Save permissions').last,
        );
        await tester.pump();
        expect(
          tester
              .widget<FilledButton>(_key('team-save-permissions:staff1'))
              .onPressed,
          isNull,
        );
        expect(
          tester
              .widget<OutlinedButton>(_key('team-full-access:staff1'))
              .onPressed,
          isNull,
        );
        calls.hold!.complete();
        await tester.pumpAndSettle();
        expect(calls.of('updateBusinessStaffPermissions'), hasLength(1));
        expect(
          tester
              .widget<OutlinedButton>(_key('team-full-access:staff1'))
              .onPressed,
          isNotNull,
        );
      },
    );

    testWidgets('ordinary staff see what is held but cannot change it', (
      tester,
    ) async {
      await _pump(tester, _Auth.staff(), _Calls());
      final chip = tester.widget<FilterChip>(
        find.descendant(
          of: _key('team-member:staff1'),
          matching: _key('permission-chip:parking'),
        ),
      );
      expect(chip.selected, isTrue);
      expect(chip.onSelected, isNull);
    });
  });

  group('The Parking bill link', () {
    const staffLink = {
      'staff1': {
        'customerKey': 'phone:3475628973',
        'customerName': 'Abd Sow',
        'customerPhone': '+1 (347) 562-8973',
      },
    };

    testWidgets('shows Not linked, or who it is linked to', (tester) async {
      await _pump(tester, _Auth.realOwner(), _Calls(), links: staffLink);
      expect(
        tester.widget<Text>(_key('team-parking-link:staff1')).data,
        'Abd Sow • +1 (347) 562-8973',
      );
      expect(
        tester.widget<Text>(_key('team-parking-link:staff2')).data,
        'Not linked',
      );
      expect(find.text('Change'), findsOneWidget);
      expect(find.text('Unlink'), findsOneWidget);
      expect(find.text('Link'), findsOneWidget);
    });

    testWidgets(
      'Link: the likely customer comes first; picking one sends the link',
      (tester) async {
        final calls = _Calls();
        await _pump(tester, _Auth.realOwner(), calls);
        await _tap(tester, _key('team-link-parking:staff1'));
        expect(find.text('Link a parking bill'), findsOneWidget);
        expect(find.text('Suggested'), findsOneWidget);
        expect(find.text('Likely match'), findsOneWidget);
        expect(find.text('Everyone else'), findsOneWidget);
        expect(find.text('2 parked cars'), findsNothing);
        await tester.tap(_key('team-link-choice:phone:3475628973'));
        await tester.pumpAndSettle();
        expect(calls.of('updateLotExpenseEntry'), [
          {
            'action': 'link_staff_parking',
            'businessId': 'b1',
            'staffId': 'staff1',
            'customerKey': 'phone:3475628973',
            'customerName': 'Abd Sow',
            'customerPhone': '+1 (347) 562-8973',
          },
        ]);
        expect(find.text('Parking bill linked.'), findsOneWidget);
      },
    );

    testWidgets('the picker searches by name', (tester) async {
      await _pump(tester, _Auth.realOwner(), _Calls());
      await _tap(tester, _key('team-link-parking:staff1'));
      await tester.enterText(_key('team-link-search'), 'keren');
      await tester.pumpAndSettle();
      expect(_key('team-link-choice:phone:9175550000'), findsOneWidget);
      expect(_key('team-link-choice:phone:3475628973'), findsNothing);
      await tester.enterText(_key('team-link-search'), 'nobody at all');
      await tester.pumpAndSettle();
      expect(find.text('No parking customer matches.'), findsOneWidget);
    });

    testWidgets('a picker that cannot load says so, and Try again loads it', (
      tester,
    ) async {
      var fail = true;
      await _pump(
        tester,
        _Auth.realOwner(),
        _Calls(),
        loadCars: (_) async {
          if (fail) throw StateError('offline');
          return _cars;
        },
      );
      await _tap(tester, _key('team-link-parking:staff1'));
      expect(_key('team-link-failed'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      fail = false;
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(_key('team-link-failed'), findsNothing);
      expect(_key('team-link-choice:phone:3475628973'), findsOneWidget);
    });

    testWidgets('no cars in a year: the picker says so', (tester) async {
      await _pump(
        tester,
        _Auth.realOwner(),
        _Calls(),
        loadCars: (_) async => const [],
      );
      await _tap(tester, _key('team-link-parking:staff1'));
      expect(
        find.text('No car was parked in the last twelve months.'),
        findsOneWidget,
      );
    });

    testWidgets('Unlink asks first, then sends an empty customer key', (
      tester,
    ) async {
      final calls = _Calls();
      await _pump(tester, _Auth.realOwner(), calls, links: staffLink);
      await _tap(tester, _key('team-unlink-parking:staff1'));
      expect(find.text('Unlink the parking bill?'), findsOneWidget);
      expect(calls.log, isEmpty);
      await _confirm(tester, 'Unlink');
      final sent = calls.of('updateLotExpenseEntry').single;
      expect(sent['customerKey'], '');
      expect(sent['action'], 'link_staff_parking');
      expect(sent['staffId'], 'staff1');
      expect(find.text('Parking bill unlinked.'), findsOneWidget);
    });

    testWidgets('a refusal is said in words', (tester) async {
      final calls = _Calls()..refuse = (_) => _refusal('link_owner_only');
      await _pump(tester, _Auth.realOwner(), calls);
      await _tap(tester, _key('team-link-parking:staff1'));
      await tester.tap(_key('team-link-choice:phone:3475628973'));
      await tester.pumpAndSettle();
      expect(
        find.text('Only the business owner can link a parking bill.'),
        findsOneWidget,
      );
      expect(find.text('Parking bill linked.'), findsNothing);
    });

    testWidgets(
      'a platform admin may link; a full-access person and staff may only read',
      (tester) async {
        await _pump(tester, _Auth(admin: true), _Calls());
        expect(_key('team-link-parking:staff1'), findsOneWidget);

        await _pump(tester, _Auth.fullAccess(), _Calls(), links: staffLink);
        expect(_key('team-link-parking:staff1'), findsNothing);
        expect(_key('team-unlink-parking:staff1'), findsNothing);
        // They can still read who it is linked to.
        expect(_key('team-parking-link:staff1'), findsOneWidget);

        await _pump(tester, _Auth.staff(), _Calls());
        expect(find.text('Parking bill'), findsNothing);
      },
    );
  });

  group('In French at 320 px', () {
    testWidgets('the team list with every control does not overflow', (
      tester,
    ) async {
      await _pump(
        tester,
        _Auth.realOwner(),
        _Calls(),
        locale: const Locale('fr'),
        width: 320,
        links: const {
          'staff1': {
            'customerKey': 'phone:3475628973',
            'customerName': 'Abd Sow Customer With A Long Name',
            'customerPhone': '+1 (347) 562-8973',
          },
        },
      );
      expect(find.text('Donner l’accès complet'), findsNothing);
      expect(find.text("Donner l'accès complet"), findsOneWidget);
      expect(find.text("Retirer l'accès complet"), findsOneWidget);
      expect(find.text('Facture de parking'), findsNWidgets(2));
      expect(find.text('Enregistrer les autorisations'), findsNWidgets(2));
      expect(tester.takeException(), isNull);
    });

    testWidgets('the Parking bill picker and a refusal do not overflow', (
      tester,
    ) async {
      final calls = _Calls()..refuse = (_) => _refusal('link_owner_only');
      await _pump(
        tester,
        _Auth.realOwner(),
        calls,
        locale: const Locale('fr'),
        width: 320,
      );
      await _tap(tester, _key('team-link-parking:staff1'));
      expect(find.text('Lier une facture de parking'), findsOneWidget);
      expect(find.text('Correspondance probable'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.tap(_key('team-link-choice:phone:3475628973'));
      await tester.pumpAndSettle();
      expect(
        find.text(
          "Seul le propriétaire de l'entreprise peut lier une facture de parking.",
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('the Full access confirmation reads in French', (tester) async {
      final calls = _Calls();
      await _pump(
        tester,
        _Auth.realOwner(),
        calls,
        locale: const Locale('fr'),
        width: 320,
      );
      await _tap(tester, _key('team-full-access:staff1'));
      expect(find.text("Donner l'accès complet ?"), findsOneWidget);
      expect(find.textContaining('Abdoulaye Sow'), findsWidgets);
      expect(tester.takeException(), isNull);
    });
  });

  group('The platform admin\'s Full access', () {
    final people = File(
      'lib/screens/user_management_screen.dart',
    ).readAsStringSync();
    final provider = File(
      'lib/providers/auth_provider.dart',
    ).readAsStringSync();

    test(
      'is offered to a super admin on a staff member, with the same words',
      () {
        expect(people, contains("key: const Key('person-full-access')"));
        expect(people, contains('superAdminRole'));
        expect(people, contains("person.role == 'staff'"));
        expect(people, contains('l10n.pplFullAccessExplained'));
        expect(people, contains("fullAccess: data['fullAccess'] == true"));
        expect(people, contains('teamRefusalText(l10n, teamRefusalOf(error))'));
      },
    );

    test('rides the staff-permissions callable with a boolean fullAccess', () {
      expect(provider, contains("'updateBusinessStaffPermissions'"));
      expect(provider, contains("'fullAccess': fullAccess,"));
    });
  });
}
