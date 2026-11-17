import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/providers/auth_provider.dart';
import 'package:my_flutter_app/providers/language_provider.dart';
import 'package:my_flutter_app/screens/settings_screen.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/utils/business_permissions.dart';
import 'package:provider/provider.dart';

/// The "Team cards" row in Settings is for the business owner and for staff
/// who may see People; nobody else (docs/BUSINESS_CARDS.md).
class _Auth extends ChangeNotifier implements AuthProvider {
  _Auth({
    this.owner = false,
    this.staff = false,
    this.people = false,
    this.business,
  });

  final bool owner;
  final bool staff;
  final bool people;
  final String? business;

  @override
  bool get isAuthenticated => true;
  @override
  bool get isBusinessOwner => owner;
  @override
  bool get isRealBusinessOwner => owner;
  @override
  bool get isStaff => staff;
  @override
  bool get isAdmin => false;
  @override
  bool get hasBusinessDashboardAccess => owner || staff;
  @override
  String? get businessId => business;
  @override
  String? get customerName => 'Awa Camara';
  @override
  String? get userEmail => 'awa@example.test';
  @override
  String? get linkedPhoneNumber => null;
  @override
  bool hasBusinessPermission(String permission) =>
      owner || (people && permission == BusinessPermission.people);
  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.isGetter) return null;
    return super.noSuchMethod(invocation);
  }
}

Future<void> _pump(
  WidgetTester tester,
  _Auth auth, {
  String lang = 'en',
}) async {
  tester.view.physicalSize = const Size(400, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: auth),
        ChangeNotifierProvider<LanguageProvider>.value(
          value: LanguageProvider()..setLanguage(lang),
        ),
      ],
      child: MaterialApp(
        theme: AppTheme.light,
        locale: Locale(lang),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        home: const SettingsScreen(),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  final row = find.byKey(const Key('settings-team-cards'));

  testWidgets('the owner sees Team cards', (tester) async {
    await _pump(tester, _Auth(owner: true, business: 'biz-1'));
    expect(row, findsOneWidget);
    expect(find.text('Team cards'), findsOneWidget);
  });

  testWidgets('staff with People see it, in French too', (tester) async {
    await _pump(
      tester,
      _Auth(staff: true, people: true, business: 'biz-1'),
      lang: 'fr',
    );
    expect(row, findsOneWidget);
    expect(find.text("Cartes de l'équipe"), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('staff without People do not', (tester) async {
    await _pump(tester, _Auth(staff: true, business: 'biz-1'));
    expect(row, findsNothing);
    // They still have their own card.
    expect(find.byKey(const Key('settings-my-card')), findsOneWidget);
  });

  testWidgets('no business, no row', (tester) async {
    await _pump(tester, _Auth(owner: true));
    expect(row, findsNothing);
  });
}
