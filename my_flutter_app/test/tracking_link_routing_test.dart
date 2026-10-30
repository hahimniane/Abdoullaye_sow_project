import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/guest_tracking_result.dart';
import 'package:my_flutter_app/navigation/app_navigator.dart';
import 'package:my_flutter_app/providers/auth_provider.dart';
import 'package:my_flutter_app/providers/language_provider.dart';
import 'package:my_flutter_app/services/guest_tracking_service.dart';
import 'package:my_flutter_app/services/package_link_service.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/app_snackbars.dart';
import 'package:my_flutter_app/widgets/guest_tracking_lookup.dart';
import 'package:provider/provider.dart';

/// AuthProvider builds Firebase in its field initialisers and cannot be
/// constructed in a test; the link service reads only these members.
class _FakeAuth extends ChangeNotifier implements AuthProvider {
  _FakeAuth({this.staff = false});

  /// A signed-in business account that would qualify for the package view.
  final bool staff;

  @override
  bool get isInitializing => false;
  @override
  bool get isLoading => false;
  @override
  bool get isAuthenticated => staff;
  @override
  String? get businessId => staff ? 'biz-1' : null;
  @override
  bool get hasBusinessDashboardAccess => staff;
  @override
  bool get hasDeliveriesAccess => staff;
  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.isGetter && invocation.memberName == #user) return null;
    return super.noSuchMethod(invocation);
  }
}

class _FakeLookup implements GuestTrackingLookupService {
  final List<String> identifiers = [];

  @override
  Future<GuestTrackingResult> lookup(String identifier) async {
    identifiers.add(identifier);
    return GuestTrackingResult.found(
      GuestTrackingRecord(
        trackingCode: identifier,
        service: GuestTrackingServiceType.parking,
        stage: GuestTrackingStage.inTransit,
        updatedAt: null,
      ),
    );
  }

  @override
  Future<String> claimQuoteRequest({
    required String trackingCode,
    required String email,
  }) async => 'request-id';
}

Future<void> _pumpApp(
  WidgetTester tester, {
  _FakeAuth? auth,
  String language = 'en',
}) async {
  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: auth ?? _FakeAuth()),
        ChangeNotifierProvider<LanguageProvider>.value(
          value: LanguageProvider()..setLanguage(language),
        ),
      ],
      child: MaterialApp(
        navigatorKey: rootNavigatorKey,
        scaffoldMessengerKey: rootScaffoldMessengerKey,
        theme: AppTheme.light,
        locale: Locale(language),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const Scaffold(body: Text('home')),
      ),
    ),
  );
  await tester.pump();
}

Uri _link(String path) => Uri.parse('https://customer.laawoldigital.com$path');

void main() {
  late _FakeLookup lookup;
  final service = PackageLinkService.instance;

  setUp(() {
    service.resetForTesting();
    lookup = _FakeLookup();
    service.lookupServiceOverride = lookup;
  });
  tearDown(service.resetForTesting);

  testWidgets('warm start: a parked-car link opens its tracking page', (
    tester,
  ) async {
    await _pumpApp(tester);
    service.markAppReady();
    final links = StreamController<Uri>();
    service.start(links: links.stream);
    links.add(_link('/t/PK-2KF3H9'));
    await tester.pumpAndSettle();

    expect(find.byType(GuestTrackingLookupPage), findsOneWidget);
    expect(lookup.identifiers, ['PK-2KF3H9']);
    await links.close();
  });

  testWidgets('cold start: a link that beats the app waits, then opens', (
    tester,
  ) async {
    final links = StreamController<Uri>();
    service.start(links: links.stream);
    // The link is what launched the app: nothing is built yet.
    links.add(_link('/t/PK-2KF3H9'));
    await tester.pump();
    expect(service.pendingCode, 'PK-2KF3H9');

    await _pumpApp(tester);
    // The app is up, but the splash screen has not finished: still waiting.
    expect(find.byType(GuestTrackingLookupPage), findsNothing);
    expect(lookup.identifiers, isEmpty);

    service.markAppReady();
    await tester.pumpAndSettle();
    expect(find.byType(GuestTrackingLookupPage), findsOneWidget);
    expect(lookup.identifiers, ['PK-2KF3H9']);
    expect(service.pendingCode, isNull);
    await links.close();
  });

  testWidgets('every other prefix opens the same page', (tester) async {
    await _pumpApp(tester);
    service.markAppReady();
    for (final code in [
      'BS-K7M4P2',
      'FR-K7M4P2',
      'TR-K7M4P2',
      'BP-K7M4P2',
      'FQ-K7M4P2',
    ]) {
      service.handleLink(_link('/t/$code'));
      await tester.pumpAndSettle();
      expect(
        find.byType(GuestTrackingLookupPage),
        findsOneWidget,
        reason: code,
      );
      expect(lookup.identifiers.last, code);
      rootNavigatorKey.currentState!.pop();
      await tester.pumpAndSettle();
    }
  });

  testWidgets('business staff get the tracking page for a parked car, not a '
      'package lookup', (tester) async {
    await _pumpApp(tester, auth: _FakeAuth(staff: true));
    service.markAppReady();
    service.handleLink(_link('/t/PK-2KF3H9'));
    await tester.pumpAndSettle();

    // A container-line lookup would have called Firestore and thrown.
    expect(tester.takeException(), isNull);
    expect(find.byType(GuestTrackingLookupPage), findsOneWidget);
    expect(lookup.identifiers, ['PK-2KF3H9']);
  });

  testWidgets('a package link signed out still opens the tracking page', (
    tester,
  ) async {
    await _pumpApp(tester);
    service.markAppReady();
    service.handleLink(_link('/t/CL-K7M4P2-2'));
    await tester.pumpAndSettle();

    expect(find.byType(GuestTrackingLookupPage), findsOneWidget);
    expect(lookup.identifiers, ['CL-K7M4P2-2']);
  });

  testWidgets('a link the app cannot read says so (warm)', (tester) async {
    await _pumpApp(tester);
    service.markAppReady();
    service.handleLink(_link('/t/garbage'));
    await tester.pump();

    expect(find.text("This tracking link isn't valid."), findsOneWidget);
    expect(find.byType(GuestTrackingLookupPage), findsNothing);
    expect(lookup.identifiers, isEmpty);
  });

  testWidgets('a link the app cannot read says so once launched (cold)', (
    tester,
  ) async {
    service.handleLink(_link('/t/PK-2KF3H'));
    expect(service.pendingInvalidTracking, isTrue);

    await _pumpApp(tester);
    expect(find.text("This tracking link isn't valid."), findsNothing);
    service.markAppReady();
    await tester.pump();

    expect(find.text("This tracking link isn't valid."), findsOneWidget);
    expect(service.pendingInvalidTracking, isFalse);
  });

  testWidgets('the message is French in French', (tester) async {
    await _pumpApp(tester, language: 'fr');
    service.markAppReady();
    service.handleLink(_link('/t/garbage'));
    await tester.pump();
    expect(find.text("Ce lien de suivi n'est pas valide."), findsOneWidget);
  });

  testWidgets('links that are not tracking links stay silent', (tester) async {
    await _pumpApp(tester);
    service.markAppReady();
    service.handleLink(_link('/pay/return'));
    service.handleLink(Uri.parse('https://example.com/t/garbage'));
    await tester.pump();

    expect(find.byType(SnackBar), findsNothing);
    expect(find.byType(GuestTrackingLookupPage), findsNothing);
  });
}
