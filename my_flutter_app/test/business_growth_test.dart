import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/business_growth_screen.dart';
import 'package:my_flutter_app/services/business_growth.dart';
import 'package:my_flutter_app/theme/app_theme.dart';

GrowthInsight _run(String id, DateTime at, List<Map<String, Object?>> cards) =>
    GrowthInsight.fromMap(id, {'createdAt': at, 'cards': cards});

class _Source implements BusinessGrowthSource {
  _Source({
    Map<String, dynamic>? business,
    List<GrowthInsight> insights = const [],
    this.checkoutRefusal,
    this.generateRefusal,
  }) : _business = business,
       _insights = insights;

  final Map<String, dynamic>? _business;
  final List<GrowthInsight> _insights;
  final GrowthFailure? checkoutRefusal;
  final GrowthFailure? generateRefusal;
  final String checkoutUrl = 'https://checkout.stripe.com/c/pay/abc';
  final _businessC = StreamController<Map<String, dynamic>?>.broadcast();
  final checkoutCalls = <Map<String, String>>[];
  final generateCalls = <String>[];
  Completer<void>? generateGate;

  @override
  Stream<Map<String, dynamic>?> watchBusiness(String businessId) async* {
    yield _business;
    yield* _businessC.stream;
  }

  @override
  Stream<List<GrowthInsight>> watchInsights(String businessId) =>
      Stream.value(_insights);

  @override
  Future<String> startProCheckout({
    required String businessId,
    required String successUrl,
    required String cancelUrl,
  }) async {
    checkoutCalls.add({'b': businessId, 's': successUrl, 'c': cancelUrl});
    if (checkoutRefusal != null) throw GrowthException(checkoutRefusal!);
    return checkoutUrl;
  }

  @override
  Future<void> generateInsights(String businessId) async {
    generateCalls.add(businessId);
    await generateGate?.future;
    if (generateRefusal != null) throw GrowthException(generateRefusal!);
  }
}

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
  Size size = const Size(400, 2400),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: child,
    ),
  );
  await tester.pump();
  await tester.pump();
}

Future<void> _tapKey(WidgetTester tester, String key) async {
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.pump();
  await tester.tap(find.byKey(Key(key)));
  await tester.pump();
  await tester.pump();
}

void main() {
  group('plan', () {
    test('free by default, advisor off', () {
      final p = GrowthPlan.fromBusiness(null);
      expect([p.isPro, p.aiAdvisorEnabled], [false, false]);
      final q = GrowthPlan.fromBusiness({'plan': 'free'});
      expect(q.aiAdvisorEnabled, isFalse);
    });
    test('pro turns the advisor on, any case', () {
      final p = GrowthPlan.fromBusiness({'plan': ' PRO '});
      expect([p.isPro, p.aiAdvisorEnabled], [true, true]);
    });
    test('an entitlement turns the advisor on without Pro', () {
      expect(
        GrowthPlan.fromBusiness({
          'plan': 'free',
          'entitlements': {'aiAdvisor': true},
        }).aiAdvisorEnabled,
        isTrue,
      );
      final all = GrowthPlan.fromBusiness({
        'entitlements': {'all': true},
      });
      expect([all.isPro, all.aiAdvisorEnabled], [false, true]);
      expect(
        GrowthPlan.fromBusiness({'entitlements': 'yes'}).aiAdvisorEnabled,
        isFalse,
      );
    });
  });

  group('cards', () {
    test('the three newest runs, newest first, each run in its order', () {
      final entries = growthCardEntries([
        _run('old', DateTime(2026, 10, 1), [
          {'title': 'A'},
        ]),
        _run('new', DateTime(2026, 11, 10), [
          {'title': 'B1', 'severity': 'HIGH'},
          {'title': 'B2'},
        ]),
        _run('mid', DateTime(2026, 11, 1), [
          {'title': 'C'},
        ]),
        _run('oldest', DateTime(2026, 9, 1), [
          {'title': 'D'},
        ]),
      ]);
      expect(entries.map((e) => e.card.title), ['B1', 'B2', 'C', 'A']);
      expect(entries.first.card.severity, 'high');
      expect(entries.map((e) => e.key), ['new-0', 'new-1', 'mid-0', 'old-0']);
    });
    test('a row with no cards, or junk in cards, gives none', () {
      expect(
        growthCardEntries([
          GrowthInsight.fromMap('x', {'cards': 'oops'}),
          GrowthInsight.fromMap('y', {
            'cards': [1, null, 'a'],
          }),
        ]),
        isEmpty,
      );
    });
  });

  group('refusals are mapped to a code, never the server sentence', () {
    test('checkout', () {
      expect(
        growthFailureFor(GrowthCall.checkout, 'permission-denied'),
        GrowthFailure.checkoutOwnerOnly,
      );
      expect(
        growthFailureFor(GrowthCall.checkout, 'failed-precondition'),
        GrowthFailure.checkoutNotSetUp,
      );
      expect(
        growthFailureFor(GrowthCall.checkout, 'unavailable'),
        GrowthFailure.generic,
      );
    });
    test('generate', () {
      expect(
        growthFailureFor(GrowthCall.generate, 'permission-denied'),
        GrowthFailure.noAccess,
      );
      expect(
        growthFailureFor(GrowthCall.generate, 'failed-precondition'),
        GrowthFailure.advisorNeedsPro,
      );
      expect(
        growthFailureFor(GrowthCall.generate, 'internal'),
        GrowthFailure.generic,
      );
    });
  });

  group('screen', () {
    final cards = [
      _run('r1', DateTime(2026, 11, 10), [
        {
          'title': 'Price your Camry',
          'severity': 'high',
          'finding': 'It sits 18% above similar cars.',
          'recommendation': 'Drop the price by \$500.',
        },
      ]),
    ];

    testWidgets(
      'free plan: Free is current, Pro offers the upgrade, the advisor is off',
      (tester) async {
        await _pump(
          tester,
          BusinessGrowthScreen(
            businessId: 'b1',
            source: _Source(business: {'plan': 'free'}),
          ),
        );
        expect(find.text('Current plan'), findsOneWidget);
        expect(find.byKey(const Key('growth-upgrade')), findsOneWidget);
        final generate = tester.widget<FilledButton>(
          find.byKey(const Key('growth-generate')),
        );
        expect(generate.onPressed, isNull);
        expect(
          find.textContaining('Available on the Pro plan'),
          findsOneWidget,
        );
        expect(
          find.text('Upgrade to Pro to unlock the advisor.'),
          findsOneWidget,
        );
      },
    );

    testWidgets('the upgrade asks for the Pro checkout and opens the link', (
      tester,
    ) async {
      final source = _Source(business: {'plan': 'free'});
      Uri? opened;
      await _pump(
        tester,
        BusinessGrowthScreen(
          businessId: 'b1',
          source: source,
          openLink: (uri) async {
            opened = uri;
            return true;
          },
        ),
      );
      await _tapKey(tester, 'growth-upgrade');
      expect(source.checkoutCalls, [
        {
          'b': 'b1',
          's': 'https://business.laawoldigital.com/',
          'c': 'https://business.laawoldigital.com/',
        },
      ]);
      expect(opened.toString(), 'https://checkout.stripe.com/c/pay/abc');
      expect(
        find.text('The payment page is open in your browser.'),
        findsOneWidget,
      );
    });

    testWidgets('a link that will not open says so', (tester) async {
      await _pump(
        tester,
        BusinessGrowthScreen(
          businessId: 'b1',
          source: _Source(business: {'plan': 'free'}),
          openLink: (_) async => false,
        ),
      );
      await _tapKey(tester, 'growth-upgrade');
      expect(find.text('We could not open the payment page.'), findsOneWidget);
    });

    testWidgets('a refused checkout is shown in words', (tester) async {
      await _pump(
        tester,
        BusinessGrowthScreen(
          businessId: 'b1',
          source: _Source(
            business: {'plan': 'free'},
            checkoutRefusal: GrowthFailure.checkoutOwnerOnly,
          ),
        ),
      );
      await _tapKey(tester, 'growth-upgrade');
      expect(
        find.text('Only the business owner can start a subscription.'),
        findsOneWidget,
      );
      // The button is usable again.
      final upgrade = tester.widget<FilledButton>(
        find.byKey(const Key('growth-upgrade')),
      );
      expect(upgrade.onPressed, isNotNull);
    });

    testWidgets('staff who are not the owner see no upgrade button', (
      tester,
    ) async {
      await _pump(
        tester,
        BusinessGrowthScreen(
          businessId: 'b1',
          canUpgrade: false,
          source: _Source(business: {'plan': 'free'}),
        ),
      );
      expect(find.byKey(const Key('growth-upgrade')), findsNothing);
      expect(find.byKey(const Key('growth-owner-only')), findsOneWidget);
    });

    testWidgets('Pro: active, the advisor generates and the cards list', (
      tester,
    ) async {
      final source = _Source(business: {'plan': 'pro'}, insights: cards);
      await _pump(
        tester,
        BusinessGrowthScreen(businessId: 'b1', source: source),
      );
      expect(find.text('Active'), findsOneWidget);
      expect(find.byKey(const Key('growth-upgrade')), findsNothing);
      expect(find.text('Price your Camry'), findsOneWidget);
      expect(find.text('High'), findsOneWidget);
      expect(
        find.textContaining('It sits 18% above similar cars.'),
        findsOneWidget,
      );
      expect(find.textContaining(r'Drop the price by $500.'), findsOneWidget);
      expect(find.text('Nov 10, 2026'), findsOneWidget);

      source.generateGate = Completer<void>();
      await _tapKey(tester, 'growth-generate');
      expect(source.generateCalls, ['b1']);
      // Busy: it says so and cannot be pressed twice.
      expect(find.byKey(const Key('growth-generating')), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(find.byKey(const Key('growth-generate')))
            .onPressed,
        isNull,
      );
      source.generateGate!.complete();
      await tester.pump();
      await tester.pump();
      expect(find.byKey(const Key('growth-message')), findsOneWidget);
      expect(find.text('New recommendations are ready.'), findsWidgets);
      await tester.pump(const Duration(seconds: 5));
    });

    testWidgets('a refused generate is shown in words', (tester) async {
      await _pump(
        tester,
        BusinessGrowthScreen(
          businessId: 'b1',
          source: _Source(
            business: {'plan': 'pro'},
            generateRefusal: GrowthFailure.advisorNeedsPro,
          ),
        ),
      );
      await _tapKey(tester, 'growth-generate');
      expect(find.text('The AI advisor needs the Pro plan.'), findsOneWidget);
    });

    testWidgets('an entitlement alone turns the advisor on', (tester) async {
      await _pump(
        tester,
        BusinessGrowthScreen(
          businessId: 'b1',
          source: _Source(
            business: {
              'plan': 'free',
              'entitlements': {'aiAdvisor': true},
            },
          ),
        ),
      );
      expect(
        tester
            .widget<FilledButton>(find.byKey(const Key('growth-generate')))
            .onPressed,
        isNotNull,
      );
      expect(
        find.text('Generate your first set of recommendations.'),
        findsOneWidget,
      );
    });

    testWidgets('French at 320 px wide: no overflow', (tester) async {
      await _pump(
        tester,
        BusinessGrowthScreen(
          businessId: 'b1',
          source: _Source(business: {'plan': 'free'}, insights: cards),
        ),
        locale: const Locale('fr'),
        size: const Size(320, 2600),
      );
      expect(find.text('Croissance'), findsOneWidget);
      expect(find.text('Passer à Pro'), findsOneWidget);
      expect(find.text('Générer des analyses'), findsOneWidget);
      expect(find.text('Élevée'), findsOneWidget);
      expect(find.textContaining('Action recommandée'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('loading always resolves: a failed read says so and retries', (
      tester,
    ) async {
      final failing = _FailingSource();
      await _pump(
        tester,
        BusinessGrowthScreen(businessId: 'b1', source: failing),
      );
      expect(find.byKey(const Key('growth-load-failed')), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      await _tapKey(tester, 'growth-retry');
      expect(failing.listens, 2);
    });
  });
}

class _FailingSource implements BusinessGrowthSource {
  int listens = 0;

  @override
  Stream<Map<String, dynamic>?> watchBusiness(String businessId) {
    listens++;
    return Stream.error(StateError('no'));
  }

  @override
  Stream<List<GrowthInsight>> watchInsights(String businessId) =>
      Stream.error(StateError('no'));

  @override
  Future<String> startProCheckout({
    required String businessId,
    required String successUrl,
    required String cancelUrl,
  }) => throw UnimplementedError();

  @override
  Future<void> generateInsights(String businessId) =>
      throw UnimplementedError();
}
