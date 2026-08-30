import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/guest_tracking_result.dart';
import 'package:my_flutter_app/providers/language_provider.dart';
import 'package:my_flutter_app/services/guest_tracking_service.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/guest_tracking_lookup.dart';
import 'package:provider/provider.dart';

class _FakeGuestTrackingService implements GuestTrackingLookupService {
  _FakeGuestTrackingService(this.handler);

  final Future<GuestTrackingResult> Function(String identifier) handler;
  final List<String> identifiers = [];

  @override
  Future<GuestTrackingResult> lookup(String identifier) {
    identifiers.add(identifier);
    return handler(identifier);
  }
}

const _success = GuestTrackingResult.found(
  GuestTrackingRecord(
    trackingCode: 'BS-K7M4P2',
    service: GuestTrackingServiceType.barrel,
    stage: GuestTrackingStage.inTransit,
    updatedAt: null,
  ),
);

Future<void> _pumpLookup(
  WidgetTester tester,
  GuestTrackingLookupService service, {
  Locale locale = const Locale('en'),
  VoidCallback? onSignIn,
  String? initialCode,
}) async {
  final language = LanguageProvider()..setLanguage(locale.languageCode);
  await tester.pumpWidget(
    ChangeNotifierProvider.value(
      value: language,
      child: MaterialApp(
        theme: AppTheme.light,
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: SafeArea(
            child: GuestTrackingLookup(
              service: service,
              initialCode: initialCode,
              onSignIn: onSignIn ?? () {},
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
}

Future<void> _enterAndSubmit(
  WidgetTester tester, [
  String identifier = 'bs k7m4p2',
]) async {
  await tester.enterText(find.byType(TextField), identifier);
  await tester.tap(find.text('Track'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('success uppercases input and shows only public status fields', (
    tester,
  ) async {
    var signInCalls = 0;
    final service = _FakeGuestTrackingService((_) async => _success);
    await _pumpLookup(tester, service, onSignIn: () => signInCalls += 1);

    expect(find.text('Booking or tracking number'), findsOneWidget);
    expect(find.byType(TextField).evaluate().single.widget, isA<TextField>());
    expect(
      (tester.widget<TextField>(find.byType(TextField))).autofocus,
      isFalse,
    );

    await _enterAndSubmit(tester);

    expect(service.identifiers, ['BS K7M4P2']);
    expect(find.text('Tracking found'), findsOneWidget);
    expect(find.text('BS-K7M4P2'), findsOneWidget);
    expect(find.text('Barrel shipping'), findsOneWidget);
    expect(find.text('In transit'), findsOneWidget);
    expect(find.textContaining('For privacy'), findsOneWidget);
    expect(find.textContaining('receiver'), findsNothing);
    expect(find.textContaining(r'$'), findsNothing);

    await tester.drag(find.byType(ListView), const Offset(0, -300));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sign in for full details'));
    expect(signInCalls, 1);
    await tester.tap(find.text('Track another number'));
    await tester.pump();
    expect(find.text('Tracking found'), findsNothing);
    expect(
      tester.widget<TextField>(find.byType(TextField)).controller!.text,
      '',
    );
  });

  testWidgets('not found is neutral and lets the guest try another number', (
    tester,
  ) async {
    final service = _FakeGuestTrackingService(
      (_) async => const GuestTrackingResult.notFound(),
    );
    await _pumpLookup(tester, service);
    await _enterAndSubmit(tester);

    expect(find.text('We could not find that number'), findsOneWidget);
    expect(
      find.text(
        'Check the number on your confirmation or receipt and try again.',
      ),
      findsOneWidget,
    );
  });

  testWidgets('required and malformed values show inline validation', (
    tester,
  ) async {
    final service = _FakeGuestTrackingService((_) async => _success);
    await _pumpLookup(tester, service);

    await tester.tap(find.text('Track'));
    await tester.pump();
    expect(find.text('Enter your booking or tracking number.'), findsOneWidget);

    await tester.enterText(find.byType(TextField), '***');
    await tester.tap(find.text('Track'));
    await tester.pump();
    expect(
      find.text('Enter a valid booking or tracking number.'),
      findsOneWidget,
    );
    expect(service.identifiers, isEmpty);
  });

  testWidgets('loading disables repeat submission and shows progress', (
    tester,
  ) async {
    final completion = Completer<GuestTrackingResult>();
    final service = _FakeGuestTrackingService((_) => completion.future);
    await _pumpLookup(tester, service);

    await tester.enterText(find.byType(TextField), 'BS-K7M4P2');
    await tester.tap(find.text('Track'));
    await tester.pump();

    expect(service.identifiers, hasLength(1));
    expect(find.text('Checking status…'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    await tester.tap(find.text('Checking status…'), warnIfMissed: false);
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pump();
    expect(service.identifiers, hasLength(1));

    completion.complete(_success);
    await tester.pumpAndSettle();
    expect(find.text('Tracking found'), findsOneWidget);
  });

  testWidgets('rate limiting and outages use safe localized messages', (
    tester,
  ) async {
    final rateLimited = _FakeGuestTrackingService(
      (_) => throw const GuestTrackingFailure(
        GuestTrackingFailureKind.rateLimited,
      ),
    );
    await _pumpLookup(tester, rateLimited);
    await _enterAndSubmit(tester);
    expect(find.textContaining('Too many checks'), findsOneWidget);
    expect(find.textContaining('resource-exhausted'), findsNothing);

    final unavailable = _FakeGuestTrackingService(
      (_) => throw const GuestTrackingFailure(
        GuestTrackingFailureKind.unavailable,
      ),
    );
    await _pumpLookup(tester, unavailable);
    await _enterAndSubmit(tester);
    expect(find.textContaining('temporarily unavailable'), findsOneWidget);
    expect(find.textContaining('Firebase'), findsNothing);
  });

  testWidgets('French success fits a narrow Samsung-sized surface', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final service = _FakeGuestTrackingService((_) async => _success);
    await _pumpLookup(tester, service, locale: const Locale('fr'));
    expect(find.text('Numéro de réservation ou de suivi'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'bs-k7m4p2');
    await tester.tap(find.text('Suivre'));
    await tester.pumpAndSettle();

    expect(find.text('Suivi trouvé'), findsOneWidget);
    expect(find.text('Expédition de barils'), findsOneWidget);
    expect(find.text('En transit'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a code handed in by the caller is looked up unasked', (
    tester,
  ) async {
    // A guest tapping their own paid order used to land here on an empty
    // search, being asked for the number the app was already holding.
    final service = _FakeGuestTrackingService((_) async => _success);
    await _pumpLookup(tester, service, initialCode: 'BS-K7M4P2');
    await tester.pumpAndSettle();

    expect(service.identifiers, ['BS-K7M4P2']);
    expect(find.text('Tracking found'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('no initial code means no lookup fires', (tester) async {
    final service = _FakeGuestTrackingService((_) async => _success);
    await _pumpLookup(tester, service);
    await tester.pumpAndSettle();

    expect(service.identifiers, isEmpty);
  });
}
