import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/providers/auth_provider.dart';
import 'package:my_flutter_app/providers/language_provider.dart';
import 'package:my_flutter_app/screens/settings_screen.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:provider/provider.dart';

/// The "My card" row in Settings is for business owners and staff, never
/// for customers or platform admins (docs/BUSINESS_CARDS.md).
class _Auth extends ChangeNotifier implements AuthProvider {
  _Auth({
    this.owner = false,
    this.staff = false,
    this.admin = false,
    this.business,
  });

  final bool owner;
  final bool staff;
  final bool admin;
  final String? business;

  @override
  bool get isAuthenticated => true;
  @override
  bool get isBusinessOwner => owner;
  @override
  bool get isStaff => staff;
  @override
  bool get isAdmin => admin;
  @override
  bool get hasBusinessDashboardAccess => owner || staff || admin;
  @override
  String? get businessId => business;
  @override
  String? get customerName => 'Awa Camara';
  @override
  String? get userEmail => 'awa@example.test';
  @override
  String? get linkedPhoneNumber => null;
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
  tester.view.physicalSize = const Size(400, 1800);
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
  final row = find.byKey(const Key('settings-my-card'));

  testWidgets('an owner sees My card', (tester) async {
    await _pump(tester, _Auth(owner: true, business: 'biz-1'));
    expect(row, findsOneWidget);
    expect(find.text('My card'), findsOneWidget);
  });

  testWidgets('staff see My card, in French too', (tester) async {
    await _pump(tester, _Auth(staff: true, business: 'biz-1'), lang: 'fr');
    expect(row, findsOneWidget);
    expect(find.text('Ma carte'), findsOneWidget);
  });

  testWidgets('a customer does not', (tester) async {
    await _pump(tester, _Auth());
    expect(row, findsNothing);
  });

  testWidgets('a platform admin (no business) does not', (tester) async {
    await _pump(tester, _Auth(admin: true));
    expect(row, findsNothing);
  });
}
