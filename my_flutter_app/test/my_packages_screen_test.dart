import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/guest_tracking_result.dart';
import 'package:my_flutter_app/providers/language_provider.dart';
import 'package:my_flutter_app/screens/my_packages_screen.dart';
import 'package:my_flutter_app/services/guest_tracking_service.dart';
import 'package:my_flutter_app/services/phone_account_service.dart';
import 'package:my_flutter_app/services/phone_accounts.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/guest_tracking_lookup.dart';
import 'package:provider/provider.dart';

import 'fixtures/fake_phone_sign_in.dart';

Map<String, Object?> _row(
  String key, {
  String role = 'sender',
  String businessId = 'biz-a',
  String businessName = 'Conakry Express',
  String service = 'container',
  String stage = 'in_transit',
  String trackingCode = 'CL-AAAAAA',
  int createdAtMs = 1767225600000,
}) => {
  'key': key,
  'collection': key.split('/').first,
  'role': role,
  'roles': [role],
  'businessId': businessId,
  'businessName': businessName,
  'service': service,
  'trackingCode': trackingCode,
  'stage': stage,
  'pieceCount': 2,
  'createdAtMs': createdAtMs,
  'updatedAtMs': createdAtMs,
};

/// The `phoneAccount` callable, answered from a script.
class _FakeCallable {
  final calls = <Map<String, Object?>>[];
  final pages = <Object?>[];
  Object? reportError;

  Future<Object?> call(String name, Map<String, Object?> payload) async {
    expect(name, 'phoneAccount');
    calls.add(payload);
    switch (payload['action']) {
      case 'getMyShipments':
        final next = pages.removeAt(0);
        if (next is Exception) throw next;
        return next;
      case 'reportShipmentNotMine':
        final error = reportError;
        if (error != null) throw error;
        return {'hidden': true, 'notified': true};
    }
    throw StateError('unexpected ${payload['action']}');
  }
}

FirebaseFunctionsException _refused(String code, String reason) =>
    FirebaseFunctionsException(
      code: code,
      message: 'English from the server',
      details: {'reason': reason},
    );

Future<void> _pump(
  WidgetTester tester,
  _FakeCallable callable, {
  Locale locale = const Locale('en'),
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: MyPackagesScreen(
        service: PhoneAccountService(caller: callable.call),
        phoneSignInClient: FakePhoneSignIn(),
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
}

void main() {
  testWidgets('sections by role, grouped by business, newest first; no price', (
    tester,
  ) async {
    final callable = _FakeCallable()
      ..pages.add({
        'phoneLastTwo': '35',
        'items': [
          _row(
            'barrelShipments/b1',
            businessId: 'biz-b',
            businessName: 'Dakar Freight',
            service: 'barrel',
            trackingCode: 'BS-BBBBBB',
            createdAtMs: 1767312000000,
          ),
          _row('containerLines/a1', trackingCode: 'CL-AAAAAA'),
          _row(
            'containerLines/r1',
            role: 'receiver',
            stage: 'arrived',
            trackingCode: 'CL-RRRRRR',
          ),
        ],
        'nextCursor': null,
      });
    await _pump(tester, callable);

    expect(find.text('My packages'), findsWidgets);
    expect(find.byKey(const Key('my-packages-mine')), findsOneWidget);
    expect(find.byKey(const Key('my-packages-coming')), findsOneWidget);
    expect(find.text('Coming to you'), findsOneWidget);
    // The newer business first.
    final dakar = tester.getTopLeft(find.text('Dakar Freight')).dy;
    final conakry = tester.getTopLeft(find.text('Conakry Express').first).dy;
    expect(dakar, lessThan(conakry));
    // The guest-tracking words, reused.
    expect(find.text('Barrel shipping'), findsOneWidget);
    expect(find.text('In transit'), findsWidgets);
    expect(find.text('Ready for pickup'), findsOneWidget);
    expect(find.text('2 pieces'), findsWidgets);
    expect(find.textContaining(r'$'), findsNothing);
    expect(find.byKey(const Key('my-packages-show-more')), findsNothing);
  });

  testWidgets('Show more asks for the next page with the cursor', (
    tester,
  ) async {
    final callable = _FakeCallable()
      ..pages.add({
        'items': [_row('containerLines/a1')],
        'nextCursor': {
          'beforeMs': 1767225600000,
          'skipKeys': ['containerLines/a1'],
        },
      })
      ..pages.add({
        'items': [
          _row('containerLines/a1'),
          _row(
            'containerLines/a0',
            trackingCode: 'CL-OLDOLD',
            createdAtMs: 1767139200000,
          ),
        ],
        'nextCursor': null,
      });
    await _pump(tester, callable);

    await tester.tap(find.byKey(const Key('my-packages-show-more')));
    await tester.pump();
    await tester.pump();

    expect(callable.calls.last['cursor'], {
      'beforeMs': 1767225600000,
      'skipKeys': ['containerLines/a1'],
    });
    expect(find.text('CL-OLDOLD'), findsOneWidget);
    expect(find.text('CL-AAAAAA'), findsOneWidget, reason: 'no duplicate card');
    expect(find.byKey(const Key('my-packages-show-more')), findsNothing);
  });

  testWidgets('"This isn\'t mine" confirms, reports and removes the card', (
    tester,
  ) async {
    final callable = _FakeCallable()
      ..pages.add({
        'items': [
          _row('containerLines/a1', role: 'receiver'),
          _row('containerLines/a2', trackingCode: 'CL-KEEPME'),
        ],
        'nextCursor': null,
      });
    await _pump(tester, callable);

    await tester.tap(
      find.byKey(const ValueKey('my-package-not-mine:containerLines/a1')),
    );
    await tester.pumpAndSettle();
    expect(find.text('Not your package?'), findsOneWidget);
    expect(
      find.textContaining('Conakry Express will be asked'),
      findsOneWidget,
    );

    await tester.tap(find.byKey(const Key('my-packages-not-mine-confirm')));
    await tester.pump();
    await tester.pump();

    final report = callable.calls.last;
    expect(report['action'], 'reportShipmentNotMine');
    expect(report['key'], 'containerLines/a1');
    expect(report['role'], 'receiver');
    expect(
      find.byKey(const ValueKey('my-package:containerLines/a1')),
      findsNothing,
    );
    expect(find.text('CL-KEEPME'), findsOneWidget);
    expect(find.byKey(const Key('my-packages-coming')), findsNothing);
    expect(
      find.text('Removed. The business will check the number.'),
      findsOneWidget,
    );
    await tester.pumpAndSettle(const Duration(seconds: 5));
  });

  testWidgets('cancelling the confirm reports nothing', (tester) async {
    final callable = _FakeCallable()
      ..pages.add({
        'items': [_row('containerLines/a1')],
        'nextCursor': null,
      });
    await _pump(tester, callable);
    await tester.tap(
      find.byKey(const ValueKey('my-package-not-mine:containerLines/a1')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(callable.calls, hasLength(1));
    expect(
      find.byKey(const ValueKey('my-package:containerLines/a1')),
      findsOneWidget,
    );
  });

  testWidgets('empty names the number', (tester) async {
    final callable = _FakeCallable()
      ..pages.add({'phoneLastTwo': '35', 'items': [], 'nextCursor': null});
    await _pump(tester, callable);
    expect(find.byKey(const Key('my-packages-empty')), findsOneWidget);
    expect(find.textContaining('ending in ••35'), findsOneWidget);
  });

  testWidgets('no verified phone points to phone verification', (tester) async {
    final callable = _FakeCallable()
      ..pages.add(_refused('failed-precondition', 'no_verified_phone'));
    await _pump(tester, callable);
    expect(find.byKey(const Key('my-packages-no-phone')), findsOneWidget);
    expect(find.text('Verify phone'), findsOneWidget);
    expect(find.textContaining('English from the server'), findsNothing);
  });

  testWidgets('signed out offers the phone sign-in', (tester) async {
    final callable = _FakeCallable()
      ..pages.add(_refused('unauthenticated', 'sign_in_required'));
    await _pump(tester, callable);
    expect(find.byKey(const Key('my-packages-signed-out')), findsOneWidget);
    expect(find.text('Sign in with your phone'), findsOneWidget);
  });

  testWidgets('an error shows Retry, and Retry loads', (tester) async {
    final callable = _FakeCallable()
      ..pages.add(_refused('unavailable', ''))
      ..pages.add({
        'items': [_row('containerLines/a1')],
        'nextCursor': null,
      });
    await _pump(tester, callable);
    expect(find.byKey(const Key('my-packages-failed')), findsOneWidget);
    await tester.tap(find.byKey(const Key('my-packages-retry')));
    await tester.pump();
    await tester.pump();
    expect(find.text('CL-AAAAAA'), findsOneWidget);
  });

  testWidgets('a load that never answers ends in Retry (safety timeout)', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: MyPackagesScreen(
          loadTimeout: const Duration(seconds: 3),
          service: PhoneAccountService(
            caller: (_, _) => Completer<Object?>().future,
          ),
        ),
      ),
    );
    await tester.pump();
    expect(find.byKey(const Key('my-packages-loading')), findsOneWidget);
    await tester.pump(const Duration(seconds: 4));
    expect(find.byKey(const Key('my-packages-failed')), findsOneWidget);
  });

  testWidgets('French copy', (tester) async {
    final callable = _FakeCallable()
      ..pages.add({
        'items': [_row('containerLines/r1', role: 'receiver')],
        'nextCursor': null,
      });
    await _pump(tester, callable, locale: const Locale('fr'));
    expect(find.text('Mes colis'), findsOneWidget);
    expect(find.text('En route vers vous'), findsOneWidget);
    expect(find.text("Ce n'est pas à moi"), findsOneWidget);
  });

  group('tracking page sign-in hints', () {
    Future<void> pumpLookup(
      WidgetTester tester, {
      required GuestTrackingRecord record,
      required FakePhoneSignIn signIn,
      VoidCallback? onSignIn,
      VoidCallback? onSignedIn,
    }) async {
      final language = LanguageProvider()..setLanguage('en');
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: language,
          child: MaterialApp(
            theme: AppTheme.light,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Scaffold(
              body: SafeArea(
                child: GuestTrackingLookup(
                  service: _OneRecord(record),
                  initialCode: record.trackingCode,
                  onSignIn: onSignIn,
                  phoneSignInClient: signIn,
                  onPhoneSignedIn: onSignedIn,
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      await tester.pump();
      await tester.pump();
    }

    const twoNumbers = GuestTrackingRecord(
      trackingCode: 'CL-K7M4P2',
      service: GuestTrackingServiceType.container,
      stage: GuestTrackingStage.inTransit,
      signIn: [
        TrackingSignInHint(role: 'sender', lastTwo: '35'),
        TrackingSignInHint(role: 'receiver', lastTwo: '12'),
      ],
    );

    testWidgets('two numbers name their roles; tapping signs in by the '
        'record\'s number', (tester) async {
      final signIn = FakePhoneSignIn()
        ..challenge = const PhoneLoginChallenge(
          challengeId: 'c7',
          lastTwo: '12',
        );
      var signedIn = 0;
      await pumpLookup(
        tester,
        record: twoNumbers,
        signIn: signIn,
        onSignIn: () {},
        onSignedIn: () => signedIn += 1,
      );

      expect(find.text('Is this package yours?'), findsOneWidget);
      expect(find.text('Sign in as the sender (••35)'), findsOneWidget);
      expect(find.text('Sign in as the receiver (••12)'), findsOneWidget);

      await tester.ensureVisible(
        find.byKey(const ValueKey('guest-phone-sign-in:receiver')),
      );
      await tester.tap(find.text('Sign in as the receiver (••12)'));
      await tester.pumpAndSettle();
      final request = signIn.requests.single as TrackingPhoneCodeRequest;
      expect(request.trackingCode, 'CL-K7M4P2');
      expect(request.role, 'receiver');

      await tester.enterText(
        find.byKey(const Key('phone-sign-in-code')),
        '123456',
      );
      await tester.tap(find.byKey(const Key('phone-sign-in-primary')));
      await tester.pumpAndSettle();
      expect(signIn.verified, ['c7:123456']);
      expect(signedIn, 1);
    });

    testWidgets('one number reads by its digits alone', (tester) async {
      await pumpLookup(
        tester,
        record: const GuestTrackingRecord(
          trackingCode: 'CL-K7M4P2',
          service: GuestTrackingServiceType.container,
          stage: GuestTrackingStage.booked,
          signIn: [TrackingSignInHint(role: 'sender', lastTwo: '35')],
        ),
        signIn: FakePhoneSignIn(),
        onSignIn: () {},
      );
      expect(find.text('Sign in as the number ending in ••35'), findsOneWidget);
    });

    testWidgets('signed in: no hints', (tester) async {
      await pumpLookup(
        tester,
        record: twoNumbers,
        signIn: FakePhoneSignIn(),
        onSignIn: null,
      );
      expect(find.byKey(const Key('guest-phone-sign-in')), findsNothing);
    });
  });
}

class _OneRecord implements GuestTrackingLookupService {
  _OneRecord(this.record);

  final GuestTrackingRecord record;

  @override
  Future<GuestTrackingResult> lookup(String identifier) async =>
      GuestTrackingResult.found(record);

  @override
  Future<String> claimQuoteRequest({
    required String trackingCode,
    required String email,
  }) async => '';
}
