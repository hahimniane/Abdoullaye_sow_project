import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/data/car_catalog.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/business_destination_option.dart';
import 'package:my_flutter_app/providers/auth_provider.dart';
import 'package:my_flutter_app/screens/request_transport_screen.dart';
import 'package:my_flutter_app/services/transport_service.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:provider/provider.dart';

/// Regression for the iOS 1.0.7 report: a signed-out customer opening
/// Request car transport saw `[firebase_functions/unauthenticated]` plus a raw
/// stack trace in a column that overflowed by 152 pixels.
///
/// `AuthProvider` builds Firebase in its field initialisers, so it is faked by
/// interface; only what the screen reads is implemented.
class _FakeAuth extends ChangeNotifier implements AuthProvider {
  _FakeAuth({required bool signedIn}) : _signedIn = signedIn;

  bool _signedIn;

  @override
  bool get isAuthenticated => _signedIn;

  @override
  String get buyerName => 'Customer';

  @override
  String? get customerPhone => null;

  void signIn() {
    _signedIn = true;
    notifyListeners();
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeTransportService implements TransportService {
  _FakeTransportService(this.handler);

  Future<List<BusinessDestinationOption>> Function() handler;
  int optionLoads = 0;

  @override
  Future<List<BusinessDestinationOption>> activeTransportOptions() {
    optionLoads++;
    return handler();
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// What the simulator rendered verbatim: `FirebaseException.toString()` is the
/// plugin code and message followed by the whole stack trace.
final _unauthenticated = FirebaseFunctionsException(
  code: 'unauthenticated',
  message: 'UNAUTHENTICATED',
  stackTrace: StackTrace.fromString(
    List.filled(
      40,
      '#0 MethodChannelHttpsCallable.call (package:cloud_functions_platform_'
      'interface/src/method_channel/method_channel_https_callable.dart:60:7)',
    ).join('\n'),
  ),
);

Future<void> _pump(
  WidgetTester tester, {
  required _FakeAuth auth,
  required _FakeTransportService service,
  Locale locale = const Locale('en'),
  List<Object?>? authRouteArguments,
}) async {
  Widget authRoute(BuildContext context) {
    authRouteArguments?.add(ModalRoute.of(context)?.settings.arguments);
    return const Scaffold(body: Text('auth screen'));
  }

  await tester.pumpWidget(
    ChangeNotifierProvider<AuthProvider>.value(
      value: auth,
      child: MaterialApp(
        theme: AppTheme.light,
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: RequestTransportScreen(service: service),
        routes: {'/login': authRoute, '/signup': authRoute},
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// A short phone at large accessibility text: the size that overflowed.
void _useSmallScreen(WidgetTester tester) {
  tester.view.physicalSize = const Size(320, 480);
  tester.view.devicePixelRatio = 1;
  tester.platformDispatcher.textScaleFactorTestValue = 2;
  addTearDown(tester.view.reset);
  addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
}

void main() {
  // The full catalog JSON decodes off the test's fake clock; load it once up
  // front so the screen's own load() is an immediate no-op.
  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    await CarCatalog.instance.load();
  });

  group('signed out', () {
    testWidgets('asks to sign in and never calls the callable', (tester) async {
      final service = _FakeTransportService(() async => const []);
      final routeArgs = <Object?>[];
      await _pump(
        tester,
        auth: _FakeAuth(signedIn: false),
        service: service,
        authRouteArguments: routeArgs,
      );

      expect(find.text('Sign in to continue'), findsOneWidget);
      expect(
        find.text(
          'Sign in or create an account to request car transport and compare '
          'quotes from transport businesses.',
        ),
        findsOneWidget,
      );
      expect(find.text('Create Account'), findsOneWidget);
      expect(service.optionLoads, 0);

      await tester.tap(find.text('Sign In'));
      await tester.pumpAndSettle();
      expect(find.text('auth screen'), findsOneWidget);
      expect(routeArgs.single, const {'returnToPrevious': true});
    });

    testWidgets('loads the form once the customer signs in', (tester) async {
      final auth = _FakeAuth(signedIn: false);
      final service = _FakeTransportService(() async => const []);
      await _pump(tester, auth: auth, service: service);
      expect(service.optionLoads, 0);

      auth.signIn();
      await tester.pumpAndSettle();

      expect(service.optionLoads, 1);
      expect(find.text('Sign in to continue'), findsNothing);
      expect(
        find.text('No business is offering car transport yet'),
        findsOneWidget,
      );
    });

    testWidgets('renders in French', (tester) async {
      await _pump(
        tester,
        auth: _FakeAuth(signedIn: false),
        service: _FakeTransportService(() async => const []),
        locale: const Locale('fr'),
      );

      expect(find.text('Connectez-vous pour continuer'), findsOneWidget);
      expect(
        find.text(
          'Connectez-vous ou créez un compte pour demander un transport de '
          'voiture et comparer les devis des entreprises de transport.',
        ),
        findsOneWidget,
      );
      expect(find.text('Se Connecter'), findsOneWidget);
      expect(find.text('Créer un Compte'), findsOneWidget);
    });

    testWidgets('does not overflow on a small screen with large text', (
      tester,
    ) async {
      _useSmallScreen(tester);
      await _pump(
        tester,
        auth: _FakeAuth(signedIn: false),
        service: _FakeTransportService(() async => const []),
      );

      expect(tester.takeException(), isNull);
      await tester.scrollUntilVisible(
        find.text('Create Account'),
        100,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('Create Account').hitTestable(), findsOneWidget);
    });
  });

  group('load failure', () {
    testWidgets('shows a localized message and retry, never the raw error', (
      tester,
    ) async {
      final service = _FakeTransportService(() async => throw _unauthenticated);
      await _pump(tester, auth: _FakeAuth(signedIn: true), service: service);

      expect(find.text('Could not load transport options'), findsOneWidget);
      expect(
        find.text('Something went wrong. Please try again.'),
        findsOneWidget,
      );
      expect(find.text('Retry'), findsOneWidget);
      expect(find.textContaining('firebase_functions'), findsNothing);
      expect(find.textContaining('UNAUTHENTICATED'), findsNothing);
      expect(find.textContaining('MethodChannel'), findsNothing);

      service.handler = () async => const [];
      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle();

      expect(service.optionLoads, 2);
      expect(find.text('Could not load transport options'), findsNothing);
      expect(
        find.text('No business is offering car transport yet'),
        findsOneWidget,
      );
    });

    testWidgets('renders in French', (tester) async {
      await _pump(
        tester,
        auth: _FakeAuth(signedIn: true),
        service: _FakeTransportService(() async => throw _unauthenticated),
        locale: const Locale('fr'),
      );

      expect(
        find.text('Impossible de charger les options de transport'),
        findsOneWidget,
      );
      expect(
        find.text('Une erreur est survenue. Veuillez réessayer.'),
        findsOneWidget,
      );
      expect(find.text('Réessayer'), findsOneWidget);
    });

    testWidgets('does not overflow on a small screen with large text', (
      tester,
    ) async {
      _useSmallScreen(tester);
      await _pump(
        tester,
        auth: _FakeAuth(signedIn: true),
        service: _FakeTransportService(() async => throw _unauthenticated),
      );

      expect(tester.takeException(), isNull);
      await tester.scrollUntilVisible(
        find.text('Retry'),
        100,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('Retry').hitTestable(), findsOneWidget);
    });
  });
}
