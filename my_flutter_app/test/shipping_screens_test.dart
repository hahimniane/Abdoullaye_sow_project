import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/destination_country.dart';
import 'package:my_flutter_app/providers/auth_provider.dart';
import 'package:my_flutter_app/screens/containers_screen.dart';
import 'package:my_flutter_app/screens/waiting_packages_screen.dart';
import 'package:my_flutter_app/services/container_delivery.dart'
    show PackageAccess;
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/package_request_feed.dart';
import 'package:my_flutter_app/services/package_requests.dart'
    show PackageProofSettings;
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/whatsapp_widgets.dart';
import 'package:provider/provider.dart';

import 'fixtures/fake_package_requests.dart';

/// The shipping side of "bring the app up to the website": Undo shipped on a
/// container, WhatsApp Send again and the counter warning, the waiting
/// list's Missing proof / Air / Sea chips with their counts, and the
/// containers' destination filter. Firebase is replaced by a fake caller that
/// records what the phone sends and answers (or refuses) as the callables do.

class _Auth extends ChangeNotifier implements AuthProvider {
  _Auth({this.owner = false, this.admin = false});

  final bool owner;
  final bool admin;

  @override
  bool get isBusinessOwner => owner;
  @override
  bool get isAdmin => admin;
  @override
  PackageAccess get packageAccess => PackageAccess.full;
  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.isGetter) return null;
    return super.noSuchMethod(invocation);
  }
}

class _Calls {
  final List<(String, Map<String, Object?>)> log = [];
  Object? Function(String name)? refuse;
  Object? answer;
  Completer<void>? hold;

  Future<Object?> call(String name, Map<String, Object?> payload) async {
    log.add((name, payload));
    await hold?.future;
    final error = refuse?.call(name);
    if (error != null) throw error;
    return answer;
  }

  List<Map<String, Object?>> of(String name) => [
    for (final c in log)
      if (c.$1 == name) c.$2,
  ];
}

FirebaseFunctionsException _refusal(
  String reason, {
  String code = 'failed-precondition',
}) => FirebaseFunctionsException(
  code: code,
  message: 'refused',
  details: {'reason': reason},
);

ShippingContainer _box(
  String id, {
  String status = 'loading',
  String destination = 'guinea',
  String destinationName = 'Guinea',
  String label = 'Box',
}) => ShippingContainer.fromMap(id, {
  'businessId': 'b1',
  'label': label,
  'status': status,
  'shipMode': 'sea',
  'destinationCountryId': destination,
  'destinationCountryName': destinationName,
});

ContainerLine _line(String id, [Map<String, dynamic> extra = const {}]) =>
    ContainerLine.fromMap(id, {
      'businessId': 'b1',
      'containerId': '',
      'containerStatus': containerLineStatusWaiting,
      'kind': containerLineKindBarrels,
      'quantity': 1,
      'ownerKind': containerOwnerCustomer,
      'customerName': 'Fatou Diallo',
      'customerPhone': '+164655501',
      'receiverName': 'Mariama Bah',
      'receiverPhone': '+224621234567',
      'trackingCode': 'CL-$id',
      'destinationCountryId': 'guinea',
      'destinationCountryName': 'Guinea',
      'createdAt': DateTime(2026, 10, 1, 9, 30),
      ...extra,
    });

Map<String, dynamic> _failedUpdate = {
  'update': 'received',
  'results': [
    {
      'role': 'sender',
      'status': 'sent',
      'delivery': 'failed',
      'reason': 'Message undeliverable',
    },
    {'role': 'receiver', 'status': 'sent', 'delivery': 'read'},
  ],
};

const _proofed = {
  'photoPaths': ['packagePhotos/b1/uid1/photo-proofed-ok.jpg'],
  'senderConfirmation': {'status': 'confirmed'},
};

Future<void> _pump(
  WidgetTester tester,
  Widget home, {
  Locale locale = const Locale('en'),
  double width = 430,
  AuthProvider? auth,
}) async {
  tester.view.physicalSize = Size(width, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  Widget app = MaterialApp(
    theme: AppTheme.light,
    locale: locale,
    supportedLocales: AppLocalizations.supportedLocales,
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    home: home,
  );
  if (auth != null) {
    app = ChangeNotifierProvider<AuthProvider>.value(value: auth, child: app);
  }
  await tester.pumpWidget(app);
  await tester.pumpAndSettle();
}

Widget _detail(ContainerFeed feed, _Calls calls, {String containerId = 'c1'}) =>
    ContainerDetailScreen(
      businessId: 'b1',
      containerId: containerId,
      feed: feed,
      staff: const [],
      customers: const [],
      knownCars: const [],
      destinations: const [],
      onCustomerRecorded: () {},
      callable: calls.call,
    );

Widget _waitingScreen(
  List<ContainerLine> lines,
  _Calls calls, {
  PackageProofSettings settings = const PackageProofSettings(),
  Set<String> saved = const {},
  bool airOnly = false,
}) => WaitingPackagesScreen(
  businessId: 'b1',
  feed: ContainerFeed.fixed('b1', lines: lines),
  proofSettings: settings,
  caller: calls.call,
  initialSavedIds: saved,
  airOnly: airOnly,
);

void main() {
  group('Undo shipped on a container', () {
    ContainerFeed feed(String status, {List<ContainerLine> lines = const []}) =>
        ContainerFeed.fixed(
          'b1',
          containers: [_box('c1', status: status)],
          lines: lines,
        );

    testWidgets('the owner puts a shipped container back, after confirming', (
      tester,
    ) async {
      final calls = _Calls();
      await _pump(
        tester,
        _detail(feed('shipped'), calls),
        auth: _Auth(owner: true),
      );
      expect(find.byKey(const Key('container-undo-shipped')), findsOneWidget);
      await tester.ensureVisible(
        find.byKey(const Key('container-undo-shipped')),
      );
      await tester.tap(find.byKey(const Key('container-undo-shipped')));
      await tester.pumpAndSettle();
      // Asked first: nothing is sent until it is confirmed.
      expect(find.text('Put back to loading?'), findsOneWidget);
      expect(calls.log, isEmpty);
      await tester.tap(
        find.widgetWithText(FilledButton, 'Put back to loading'),
      );
      await tester.pumpAndSettle();
      expect(calls.of('undoContainerShipped'), [
        {'businessId': 'b1', 'containerId': 'c1'},
      ]);
      expect(find.text('Back to loading.'), findsOneWidget);
    });

    testWidgets('cancelling sends nothing', (tester) async {
      final calls = _Calls();
      await _pump(
        tester,
        _detail(feed('shipped'), calls),
        auth: _Auth(owner: true),
      );
      await tester.ensureVisible(
        find.byKey(const Key('container-undo-shipped')),
      );
      await tester.tap(find.byKey(const Key('container-undo-shipped')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(calls.log, isEmpty);
    });

    testWidgets('a server refusal is said in words', (tester) async {
      final calls = _Calls()
        ..refuse = (_) =>
            _refusal('container_undo_owner_only', code: 'permission-denied');
      await _pump(
        tester,
        _detail(feed('arrived'), calls),
        auth: _Auth(owner: true),
      );
      await tester.ensureVisible(
        find.byKey(const Key('container-undo-shipped')),
      );
      await tester.tap(find.byKey(const Key('container-undo-shipped')));
      await tester.pumpAndSettle();
      await tester.tap(
        find.widgetWithText(FilledButton, 'Put back to loading'),
      );
      await tester.pumpAndSettle();
      expect(
        find.text(
          'Only the owner can put a shipped container back to loading.',
        ),
        findsOneWidget,
      );
      expect(find.text('Back to loading.'), findsNothing);
      // The button works again afterwards.
      final button = tester.widget<ContainerActionButton>(
        find.byKey(const Key('container-undo-shipped')),
      );
      expect(button.busy, isFalse);
      expect(button.enabled, isTrue);
    });

    testWidgets(
      'an arrived container with cars is refused here, before the server',
      (tester) async {
        final calls = _Calls();
        final car = _line('car1', {
          'containerId': 'c1',
          'containerStatus': 'arrived',
          'kind': containerLineKindCar,
          'vinNumber': '1HGCM82633A004352',
          'quantity': 1,
        });
        await _pump(
          tester,
          _detail(feed('arrived', lines: [car]), calls),
          auth: _Auth(owner: true),
        );
        await tester.ensureVisible(
          find.byKey(const Key('container-undo-shipped')),
        );
        await tester.tap(find.byKey(const Key('container-undo-shipped')));
        await tester.pumpAndSettle();
        expect(
          find.text(
            "This container arrived with cars on it, so it can't go back to loading.",
          ),
          findsOneWidget,
        );
        expect(calls.log, isEmpty);
      },
    );

    testWidgets(
      'a platform admin sees it; ordinary staff and a loading box do not',
      (tester) async {
        final calls = _Calls();
        await _pump(
          tester,
          _detail(feed('shipped'), calls),
          auth: _Auth(admin: true),
        );
        expect(find.byKey(const Key('container-undo-shipped')), findsOneWidget);

        await _pump(tester, _detail(feed('shipped'), calls), auth: _Auth());
        expect(find.byKey(const Key('container-undo-shipped')), findsNothing);

        await _pump(tester, _detail(feed('shipped'), calls));
        expect(find.byKey(const Key('container-undo-shipped')), findsNothing);

        await _pump(
          tester,
          _detail(feed('loading'), calls),
          auth: _Auth(owner: true),
        );
        expect(find.byKey(const Key('container-undo-shipped')), findsNothing);
      },
    );

    testWidgets(
      'in French at 320 px: the button and its confirmation do not overflow',
      (tester) async {
        final calls = _Calls();
        await _pump(
          tester,
          _detail(feed('shipped'), calls),
          auth: _Auth(owner: true),
          locale: const Locale('fr'),
          width: 320,
        );
        expect(find.text("Annuler l'expédition"), findsOneWidget);
        await tester.ensureVisible(
          find.byKey(const Key('container-undo-shipped')),
        );
        await tester.tap(find.byKey(const Key('container-undo-shipped')));
        await tester.pumpAndSettle();
        expect(find.text('Remettre en chargement ?'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  });

  group('Send again', () {
    ContainerLine failed() =>
        _line('f1', {'lastCustomerUpdate': _failedUpdate});

    Widget ticks(_Calls calls, ContainerLine line) => Scaffold(
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: PackageUpdateTicks(line: line, send: calls.call),
      ),
    );

    testWidgets('a failed update offers Send again; a delivered one does not', (
      tester,
    ) async {
      await _pump(tester, ticks(_Calls(), failed()));
      expect(find.byKey(const Key('send-again:f1')), findsOneWidget);
      final ok = _line('ok', {
        'lastCustomerUpdate': {
          'update': 'received',
          'results': [
            {'role': 'sender', 'status': 'sent', 'delivery': 'delivered'},
          ],
        },
      });
      await _pump(tester, ticks(_Calls(), ok));
      expect(find.byKey(const Key('send-again:ok')), findsNothing);
      expect(find.byKey(const Key('line-update-ticks')), findsOneWidget);
    });

    testWidgets(
      'it sends resend_update, shows progress, then says Sent again',
      (tester) async {
        final calls = _Calls()
          ..answer = {'success': true, 'queued': 1, 'alreadySent': 0}
          ..hold = Completer<void>();
        await _pump(tester, ticks(calls, failed()));
        await tester.tap(find.byKey(const Key('send-again:f1')));
        await tester.pump();
        expect(find.text('Sending…'), findsOneWidget);
        // A second tap while it works sends nothing more.
        await tester.tap(
          find.byKey(const Key('send-again:f1')),
          warnIfMissed: false,
        );
        await tester.pump();
        calls.hold!.complete();
        await tester.pumpAndSettle();
        expect(calls.of('updateContainerLine'), [
          {'businessId': 'b1', 'lineId': 'f1', 'action': 'resend_update'},
        ]);
        expect(find.text('Sent again'), findsOneWidget);
        expect(find.byKey(const Key('send-again:f1')), findsNothing);
      },
    );

    testWidgets('when nobody could be queued it says so, not "Sent again"', (
      tester,
    ) async {
      final calls = _Calls()
        ..answer = {'success': true, 'queued': 0, 'alreadySent': 2};
      await _pump(tester, ticks(calls, failed()));
      await tester.tap(find.byKey(const Key('send-again:f1')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('send-again-nothing')), findsOneWidget);
      expect(find.text('Sent again'), findsNothing);
    });

    testWidgets(
      'the server\'s refusals are shown in words and the button comes back',
      (tester) async {
        final calls = _Calls()
          ..refuse = (_) => _refusal('whatsapp_not_configured');
        await _pump(tester, ticks(calls, failed()));
        await tester.tap(find.byKey(const Key('send-again:f1')));
        await tester.pumpAndSettle();
        expect(find.text('WhatsApp is not connected yet.'), findsOneWidget);
        expect(find.byKey(const Key('send-again:f1')), findsOneWidget);

        calls.refuse = (_) => _refusal('no_customer_update');
        await tester.tap(find.byKey(const Key('send-again:f1')));
        await tester.pumpAndSettle();
        expect(
          find.text('There is no message to send again yet.'),
          findsOneWidget,
        );

        calls.refuse = (_) => StateError('offline');
        await tester.tap(find.byKey(const Key('send-again:f1')));
        await tester.pumpAndSettle();
        expect(find.text('Could not send again. Try again.'), findsOneWidget);
      },
    );
  });

  group('The counter warning on the Waiting list', () {
    testWidgets('names who, the number and why, for a package saved just now', (
      tester,
    ) async {
      final calls = _Calls();
      await _pump(
        tester,
        _waitingScreen(
          [
            _line('w1', {'lastCustomerUpdate': _failedUpdate}),
            _line('w2', {'lastCustomerUpdate': _failedUpdate}),
          ],
          calls,
          saved: {'w1'},
        ),
      );
      expect(find.text('WhatsApp could not reach this number'), findsOneWidget);
      // Only the package saved in this sitting.
      expect(find.byKey(const Key('counter-alert:w1:sender')), findsOneWidget);
      expect(find.byKey(const Key('counter-alert:w2:sender')), findsNothing);
      expect(find.textContaining('+164655501'), findsWidgets);
      expect(find.text('Message undeliverable'), findsWidgets);
      expect(find.byKey(const Key('counter-fix:w1')), findsOneWidget);
    });

    testWidgets('no warning when nothing was saved here, or nothing failed', (
      tester,
    ) async {
      final calls = _Calls();
      await _pump(
        tester,
        _waitingScreen([
          _line('w1', {'lastCustomerUpdate': _failedUpdate}),
        ], calls),
      );
      expect(find.byKey(const Key('counter-alerts')), findsNothing);
      await _pump(tester, _waitingScreen([_line('w1')], calls, saved: {'w1'}));
      expect(find.byKey(const Key('counter-alerts')), findsNothing);
    });

    testWidgets('Send again in the warning sends it for that package', (
      tester,
    ) async {
      final calls = _Calls()..answer = {'queued': 1, 'alreadySent': 0};
      await _pump(
        tester,
        _waitingScreen(
          [
            _line('w1', {'lastCustomerUpdate': _failedUpdate}),
          ],
          calls,
          saved: {'w1'},
        ),
      );
      final again = find.descendant(
        of: find.byKey(const Key('counter-alerts')),
        matching: find.byKey(const Key('send-again:w1')),
      );
      await tester.tap(again);
      await tester.pumpAndSettle();
      expect(calls.of('updateContainerLine').single['action'], 'resend_update');
      expect(calls.of('updateContainerLine').single['lineId'], 'w1');
      expect(find.text('Sent again'), findsWidgets);
    });

    testWidgets('Fix the number opens that package to correct', (tester) async {
      final calls = _Calls();
      await _pump(
        tester,
        _waitingScreen(
          [
            _line('w1', {'lastCustomerUpdate': _failedUpdate}),
          ],
          calls,
          saved: {'w1'},
        ),
      );
      await tester.tap(find.byKey(const Key('counter-fix:w1')));
      await tester.pumpAndSettle();
      expect(find.text('Edit package'), findsOneWidget);
      // The sheet shows the same warning, so Send again is there too.
      expect(find.byKey(const Key('counter-alerts')), findsWidgets);
    });

    testWidgets('in French at 320 px it does not overflow', (tester) async {
      final calls = _Calls();
      await _pump(
        tester,
        _waitingScreen(
          [
            _line('w1', {'lastCustomerUpdate': _failedUpdate}),
          ],
          calls,
          saved: {'w1'},
          settings: const PackageProofSettings(shipsByAir: true),
        ),
        locale: const Locale('fr'),
        width: 320,
      );
      expect(
        find.text("WhatsApp n'a pas pu joindre ce numéro"),
        findsOneWidget,
      );
      expect(find.text('Corriger le numéro'), findsOneWidget);
      expect(find.text('Renvoyer'), findsWidgets);
      expect(tester.takeException(), isNull);
    });
  });

  group('Waiting list filters', () {
    const air = PackageProofSettings(shipsByAir: true);
    final lines = [
      _line('a1', {'shipMode': 'air'}),
      _line('a2', {'shipMode': 'air', ..._proofed}),
      _line('s1'),
      _line('s2'),
    ];

    testWidgets('Missing proof, Air and Sea show their counts', (tester) async {
      await _pump(tester, _waitingScreen(lines, _Calls(), settings: air));
      expect(
        find.widgetWithText(FilterChip, 'Missing proof · 1'),
        findsOneWidget,
      );
      expect(find.widgetWithText(FilterChip, 'Air · 2'), findsOneWidget);
      expect(find.widgetWithText(FilterChip, 'Sea · 2'), findsOneWidget);
    });

    testWidgets(
      'Missing proof keeps the packages without it; Sea then Air switch',
      (tester) async {
        await _pump(tester, _waitingScreen(lines, _Calls(), settings: air));
        expect(find.byType(WaitingPackageCard), findsNWidgets(4));
        await tester.tap(find.byKey(const Key('waiting-missing-proof')));
        await tester.pumpAndSettle();
        expect(find.byType(WaitingPackageCard), findsOneWidget);
        await tester.tap(find.byKey(const Key('waiting-missing-proof')));
        await tester.tap(find.byKey(const Key('waiting-ship-mode-sea')));
        await tester.pumpAndSettle();
        expect(find.byType(WaitingPackageCard), findsNWidgets(2));
      },
    );

    testWidgets('"Every waiting package has its proof." when none is missing', (
      tester,
    ) async {
      await _pump(
        tester,
        _waitingScreen(
          [
            _line('a2', {'shipMode': 'air', ..._proofed}),
          ],
          _Calls(),
          settings: air,
        ),
      );
      expect(
        find.widgetWithText(FilterChip, 'Missing proof · 0'),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const Key('waiting-missing-proof')));
      await tester.pumpAndSettle();
      expect(find.text('Every waiting package has its proof.'), findsOneWidget);
    });

    testWidgets(
      '"No waiting package ships that way." for an empty Air filter',
      (tester) async {
        await _pump(
          tester,
          _waitingScreen([_line('s1')], _Calls(), settings: air),
        );
        await tester.tap(find.byKey(const Key('waiting-ship-mode-air')));
        await tester.pumpAndSettle();
        expect(find.text('No waiting package ships that way.'), findsOneWidget);
      },
    );

    testWidgets('a business that does not ship by air has no Air / Sea chips', (
      tester,
    ) async {
      await _pump(tester, _waitingScreen(lines, _Calls()));
      expect(find.byKey(const Key('waiting-ship-mode-air')), findsNothing);
      expect(find.byKey(const Key('waiting-missing-proof')), findsOneWidget);
    });

    testWidgets('in French at 320 px the chips with counts do not overflow', (
      tester,
    ) async {
      await _pump(
        tester,
        _waitingScreen(lines, _Calls(), settings: air),
        locale: const Locale('fr'),
        width: 320,
      );
      expect(
        find.widgetWithText(FilterChip, 'Preuve manquante · 1'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });
  });

  group('Containers: destination filter', () {
    ContainersScreenSeed seed() => ContainersScreenSeed(
      feed: ContainerFeed.fixed(
        'b1',
        containers: [
          _box('c1', label: 'Guinea box'),
          _box(
            'c2',
            destination: 'senegal',
            destinationName: 'Senegal',
            label: 'Senegal box',
          ),
          _box('c3', status: 'shipped', label: 'Shipped box'),
        ],
      ),
      requests: PackageRequestFeed(
        'b1',
        service: FakePackageRequests()..initialOpen = [],
      ),
      destinations: const [
        DestinationCountry(id: 'guinea', name: 'Guinea', isMain: true),
        DestinationCountry(id: 'senegal', name: 'Senegal'),
      ],
      businessName: 'Test Cargo',
      proofSettings: const PackageProofSettings(),
    );

    Future<void> open(
      WidgetTester tester, {
      Locale locale = const Locale('en'),
      double width = 430,
    }) => _pump(
      tester,
      ContainersScreen(key: UniqueKey(), businessId: 'b1', seed: seed()),
      locale: locale,
      width: width,
    );

    testWidgets(
      'offers Every destination and the destinations containers go to',
      (tester) async {
        await open(tester);
        expect(
          find.byKey(const Key('containers-destination-filter')),
          findsOneWidget,
        );
        expect(find.text('Every destination'), findsOneWidget);
        expect(find.text('Guinea box'), findsOneWidget);
        expect(find.text('Senegal box'), findsOneWidget);
        await tester.tap(find.byType(DropdownButtonFormField<String>));
        await tester.pumpAndSettle();
        expect(find.text('Guinea'), findsWidgets);
        expect(find.text('Senegal'), findsWidgets);
      },
    );

    testWidgets(
      'choosing a destination narrows the list; Every destination undoes it',
      (tester) async {
        await open(tester);
        await tester.tap(find.byType(DropdownButtonFormField<String>));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Senegal').last);
        await tester.pumpAndSettle();
        expect(find.text('Senegal box'), findsOneWidget);
        expect(find.text('Guinea box'), findsNothing);

        await tester.tap(find.byType(DropdownButtonFormField<String>));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Every destination').last);
        await tester.pumpAndSettle();
        expect(find.text('Guinea box'), findsOneWidget);
        expect(find.text('Senegal box'), findsOneWidget);
      },
    );

    testWidgets('a destination with nothing in this state says so', (
      tester,
    ) async {
      await open(tester);
      await tester.tap(find.text('Shipped').first);
      await tester.pumpAndSettle();
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Senegal').last);
      await tester.pumpAndSettle();
      expect(
        find.text('No container goes to that destination here.'),
        findsOneWidget,
      );
    });

    testWidgets('in French at 320 px it does not overflow', (tester) async {
      await open(tester, locale: const Locale('fr'), width: 320);
      expect(find.text('Toutes les destinations'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
