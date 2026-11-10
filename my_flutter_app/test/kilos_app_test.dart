import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/l10n/app_localizations_en.dart';
import 'package:my_flutter_app/l10n/app_localizations_fr.dart';
import 'package:my_flutter_app/models/destination_country.dart';
import 'package:my_flutter_app/screens/containers_screen.dart';
import 'package:my_flutter_app/screens/package_price_list_screen.dart';
import 'package:my_flutter_app/screens/receive_request_sheet.dart';
import 'package:my_flutter_app/services/business_price_list.dart';
import 'package:my_flutter_app/services/business_weight_unit.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/package_proof.dart'
    hide proofRefusalCodes;
import 'package:my_flutter_app/services/package_requests.dart';
import 'package:my_flutter_app/services/price_list_fill.dart';
import 'package:my_flutter_app/services/waiting_packages.dart'
    show DestinationRef;
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/lot_sheets.dart';
import 'package:my_flutter_app/widgets/proof_fields.dart';
import 'package:my_flutter_app/widgets/proof_refusal_text.dart';

import 'fixtures/fake_package_requests.dart';

/// Kilos and the counter price fill in the app (docs/SHIPPING_SIMPLE_HOME.md
/// K and P): the business's unit, the weight field and what it sends, the
/// price list editor's unit, a line weighed in kilos, and "From the price
/// list" on a piece. The rules themselves (pricing, converting, the proof
/// weight) are the shared fixture's, run in `package_price_list_test.dart`.

// ---------------------------------------------------------------------------
// Data. No real names or numbers.
// ---------------------------------------------------------------------------

Map<String, dynamic> _airRoute({String unit = 'kg'}) => {
  'items': [
    {
      'id': 'i_phone',
      'categoryId': 'electronics',
      'label': 'New phone',
      'priceCents': 11000,
      'includedLb': 0,
    },
    {
      'id': 'i_laptop',
      'categoryId': 'electronics',
      'label': 'Laptop',
      'priceCents': 7000,
      'includedLb': 2,
    },
  ],
  'perLbCents': {'general': 2500, 'clothing': 700},
  'departure': null,
  if (unit == 'kg') 'unit': 'kg',
};

PackagePriceList _list(String unit, {bool withRoute = true}) =>
    PackagePriceList.fromMap({
      'weightUnit': unit,
      'routes': withRoute
          ? {
              'guinea': {'air': _airRoute(unit: unit)},
            }
          : <String, dynamic>{},
    });

BusinessWeightUnit _units(PackagePriceList list, {WeightUnitMemory? memory}) =>
    BusinessWeightUnit(
      businessId: 'b1',
      watchList: (_) => Stream.value(list),
      memory: memory ?? MemoryWeightUnitMemory(),
    );

ContainerLine _line([Map<String, dynamic> extra = const {}]) =>
    ContainerLine.fromMap('l1', {
      'businessId': 'b1',
      'containerId': '',
      'containerStatus': containerLineStatusWaiting,
      'kind': containerLineKindBarrels,
      'quantity': 1,
      'ownerKind': containerOwnerCustomer,
      'customerName': 'Test Sender',
      'customerPhone': '+19175551234',
      'receiverName': 'Test Receiver',
      'receiverPhone': '+224621234567',
      'trackingCode': 'CL-K7M4P2',
      'destinationCountryId': 'guinea',
      'destinationCountryName': 'Guinea',
      'shipMode': 'air',
      ...extra,
    });

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
  double width = 430,
}) async {
  tester.view.physicalSize = Size(width, 3200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: Scaffold(body: SingleChildScrollView(child: child)),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _tap(WidgetTester tester, Object key) async {
  final finder = find.byKey(key is Key ? key : Key(key as String));
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

Future<void> _type(WidgetTester tester, Object key, String text) async {
  final finder = find.byKey(key is Key ? key : Key(key as String));
  await tester.ensureVisible(finder);
  await tester.enterText(finder, text);
  await tester.pumpAndSettle();
}

String _text(WidgetTester tester, String key) =>
    tester.widget<TextField>(find.byKey(Key(key))).controller!.text;

void main() {
  // -------------------------------------------------------------------------
  // The business's unit.
  // -------------------------------------------------------------------------

  group('the business weight unit', () {
    test('the price list decides when it prices a route', () {
      expect(businessWeightUnitOf(_list('kg'), null), (
        unit: 'kg',
        fromList: true,
      ));
      expect(businessWeightUnitOf(_list('kg'), 'lb'), (
        unit: 'kg',
        fromList: true,
      ));
      expect(businessWeightUnitOf(_list('lb'), 'kg'), (
        unit: 'lb',
        fromList: true,
      ));
    });

    test('without a priced route the remembered pick decides, else pounds', () {
      expect(businessWeightUnitOf(null, null), (unit: 'lb', fromList: false));
      expect(businessWeightUnitOf(null, 'kg'), (unit: 'kg', fromList: false));
      // A kilo list with nothing priced does not decide.
      expect(businessWeightUnitOf(_list('kg', withRoute: false), 'lb'), (
        unit: 'lb',
        fromList: false,
      ));
      expect(businessWeightUnitOf(_list('kg', withRoute: false), 'kg'), (
        unit: 'kg',
        fromList: false,
      ));
      expect(businessWeightUnitOf(null, 'oz'), (unit: 'lb', fromList: false));
    });

    test('a kilo list answers kilos and offers no choice', () async {
      final units = _units(_list('kg'));
      addTearDown(units.dispose);
      expect(units.resolved, isFalse);
      await Future<void>.delayed(Duration.zero);
      expect(units.resolved, isTrue);
      expect(units.unit, 'kg');
      expect(units.fromList, isTrue);
      expect(units.offersChoice, isFalse);
      expect(units.list!.route('guinea', 'air')!.unit, 'kg');
    });

    test('no list: the choice is offered, remembered, and read back', () async {
      final memory = MemoryWeightUnitMemory();
      final first = _units(PackagePriceList.empty, memory: memory);
      addTearDown(first.dispose);
      await Future<void>.delayed(Duration.zero);
      expect(first.unit, 'lb');
      expect(first.offersChoice, isTrue);
      first.choose('kg');
      expect(first.unit, 'kg');
      await Future<void>.delayed(Duration.zero);
      expect(memory.value, 'kg');
      // The next screen on this device starts on kilos.
      final next = _units(PackagePriceList.empty, memory: memory);
      addTearDown(next.dispose);
      await Future<void>.delayed(Duration.zero);
      expect(next.unit, 'kg');
    });

    test(
      'a refused read is "no list": the screen is not left waiting',
      () async {
        final units = BusinessWeightUnit(
          businessId: 'b1',
          watchList: (_) => Stream<PackagePriceList>.error('permission-denied'),
          memory: MemoryWeightUnitMemory('kg'),
        );
        addTearDown(units.dispose);
        await Future<void>.delayed(Duration.zero);
        expect(units.resolved, isTrue);
        expect(units.unit, 'kg');
        expect(units.offersChoice, isTrue);
      },
    );

    test('a read that never answers still resolves', () async {
      final never = StreamController<PackagePriceList>();
      addTearDown(never.close);
      final units = BusinessWeightUnit(
        businessId: 'b1',
        watchList: (_) => never.stream,
        memory: MemoryWeightUnitMemory(),
        timeout: const Duration(milliseconds: 20),
      );
      addTearDown(units.dispose);
      expect(units.resolved, isFalse);
      expect(units.offersChoice, isFalse);
      await Future<void>.delayed(const Duration(milliseconds: 60));
      expect(units.resolved, isTrue);
      expect(units.offersChoice, isTrue);
    });

    test('a read that ends without an answer is "no list"', () async {
      final units = BusinessWeightUnit(
        businessId: 'b1',
        watchList: (_) => const Stream<PackagePriceList>.empty(),
        memory: MemoryWeightUnitMemory(),
      );
      addTearDown(units.dispose);
      await Future<void>.delayed(Duration.zero);
      expect(units.resolved, isTrue);
      expect(units.unit, 'lb');
      expect(units.offersChoice, isTrue);
    });
  });

  // -------------------------------------------------------------------------
  // The weight field and what it sends.
  // -------------------------------------------------------------------------

  group('the weight a counter form sends', () {
    ProofFieldsController proof({
      PackageProofDraft initial = PackageProofDraft.empty,
      BusinessWeightUnit? units,
    }) => ProofFieldsController(
      businessId: 'b1',
      initial: initial,
      units: units,
      urlOf: (_) async => '',
    );

    test('kilos send the pounds they make and the kilos', () async {
      final units = _units(_list('kg'));
      final c = proof(units: units);
      addTearDown(() {
        c.dispose();
        units.dispose();
      });
      await Future<void>.delayed(Duration.zero);
      expect(c.weightUnit, 'kg');
      c.weight.text = '10';
      c.weightTyped();
      final checked = validateProofFields(c.draft);
      expect(checked.error, '');
      final payload = checked.fields.toPayload();
      expect(payload['weightLb'], 22);
      expect(payload['weightKg'], 10);
    });

    test('pounds send the pounds alone', () async {
      final units = _units(_list('lb'));
      final c = proof(units: units);
      addTearDown(() {
        c.dispose();
        units.dispose();
      });
      await Future<void>.delayed(Duration.zero);
      c.weight.text = '22';
      c.weightTyped();
      final payload = validateProofFields(c.draft).fields.toPayload();
      expect(payload['weightLb'], 22);
      expect(payload.containsKey('weightKg'), isFalse);
    });

    test('a kilo field left empty sends both as null', () async {
      final units = _units(_list('kg'));
      final c = proof(units: units);
      addTearDown(() {
        c.dispose();
        units.dispose();
      });
      await Future<void>.delayed(Duration.zero);
      final payload = validateProofFields(c.draft).fields.toPayload();
      expect(payload['weightLb'], isNull);
      expect(payload.containsKey('weightKg'), isTrue);
      expect(payload['weightKg'], isNull);
    });

    test('a kilo weight too high names the kilo limit', () async {
      final units = _units(_list('kg'));
      final c = proof(units: units);
      addTearDown(() {
        c.dispose();
        units.dispose();
      });
      await Future<void>.delayed(Duration.zero);
      c.weight.text = '901';
      c.weightTyped();
      expect(validateProofFields(c.draft).error, 'weight_kg_invalid');
      // The same number in pounds is fine (the pounds limit is 2000).
      final lb = proof(
        initial: const PackageProofDraft(weightLb: '901'),
        units: units,
      );
      addTearDown(lb.dispose);
      expect(validateProofFields(lb.draft).error, '');
    });

    test(
      'a line weighed in kilos opens on its kilos and keeps that unit',
      () async {
        final line = _line({'weightLb': 22, 'weightKg': 10});
        // A pounds business: the stored kilos are not converted behind
        // staff's back.
        final units = _units(_list('lb'));
        final c = proof(initial: line.proofDraft, units: units);
        addTearDown(() {
          c.dispose();
          units.dispose();
        });
        await Future<void>.delayed(Duration.zero);
        expect(c.weight.text, '10');
        expect(c.weightUnit, 'kg');
        expect(validateProofFields(c.draft).fields.toPayload()['weightKg'], 10);
        // Cleared: both go away.
        c.weight.clear();
        final cleared = validateProofFields(c.draft).fields.toPayload();
        expect(cleared['weightLb'], isNull);
        expect(cleared['weightKg'], isNull);
      },
    );

    test('a line weighed in pounds keeps pounds in a kilo business', () async {
      final line = _line({'weightLb': 22});
      final units = _units(_list('kg'));
      final c = proof(initial: line.proofDraft, units: units);
      addTearDown(() {
        c.dispose();
        units.dispose();
      });
      await Future<void>.delayed(Duration.zero);
      expect(c.weight.text, '22');
      expect(c.weightUnit, 'lb');
      final payload = validateProofFields(c.draft).fields.toPayload();
      expect(payload['weightLb'], 22);
      expect(payload.containsKey('weightKg'), isFalse);
    });

    test(
      'a weight typed before the list arrived keeps the unit it was typed in',
      () async {
        final answer = StreamController<PackagePriceList>();
        addTearDown(answer.close);
        final units = BusinessWeightUnit(
          businessId: 'b1',
          watchList: (_) => answer.stream,
          memory: MemoryWeightUnitMemory(),
        );
        final c = proof(units: units);
        addTearDown(() {
          c.dispose();
          units.dispose();
        });
        c.weight.text = '10';
        c.weightTyped();
        answer.add(_list('kg'));
        await Future<void>.delayed(Duration.zero);
        expect(units.unit, 'kg');
        expect(c.weightUnit, 'lb');
        expect(validateProofFields(c.draft).fields.toPayload()['weightLb'], 10);
      },
    );

    test(
      'the choice with no list is remembered by the business unit',
      () async {
        final memory = MemoryWeightUnitMemory();
        final units = _units(PackagePriceList.empty, memory: memory);
        final c = proof(units: units);
        addTearDown(() {
          c.dispose();
          units.dispose();
        });
        await Future<void>.delayed(Duration.zero);
        expect(c.offersUnitChoice, isTrue);
        c.chooseWeightUnit('kg');
        expect(c.weightUnit, 'kg');
        expect(units.unit, 'kg');
        expect(memory.value, 'kg');
        // "Save and another" starts over on the business's unit.
        c.weight.text = '3';
        c.reset();
        expect(c.weight.text, '');
        expect(c.weightUnit, 'kg');
      },
    );

    test('a fill gives the package weight only to an empty field', () {
      final c = proof();
      addTearDown(c.dispose);
      expect(c.autoFillWeight('10', 'kg'), isTrue);
      expect(c.weight.text, '10');
      expect(c.weightUnit, 'kg');
      // The next fill adds to what a fill wrote.
      expect(c.autoFillWeight('15', 'kg'), isTrue);
      expect(c.weight.text, '15');
      // Typed by staff: never overwritten.
      c.weight.text = '3';
      expect(c.autoFillWeight('20', 'kg'), isFalse);
      expect(c.weight.text, '3');
    });

    test('a stored line says its weight in the unit it was weighed in', () {
      final kilos = _line({'weightLb': 9.9, 'weightKg': 4.5});
      expect(kilos.weightKg, 4.5);
      expect(weightText(kilos, 'en'), '4.5 kg');
      expect(weightText(kilos, 'fr'), '4,5 kg');
      final pounds = _line({'weightLb': 22});
      expect(pounds.weightKg, isNull);
      expect(weightText(pounds, 'en'), '22 lb');
      expect(weightText(_line(), 'en'), '');
      expect(kilos.proofDraft.weightUnit, 'kg');
      expect(pounds.proofDraft.weightUnit, 'lb');
    });

    test('both new refusals have a sentence in both languages', () {
      final en = AppLocalizationsEn();
      final fr = AppLocalizationsFr();
      for (final code in const ['weight_kg_invalid']) {
        expect(proofRefusalCodes, contains(code));
        expect(proofRefusalText(en, code), contains('900 kg'));
        expect(proofRefusalText(fr, code), contains('900 kg'));
        expect(proofErrorText(en, code), contains('900 kg'));
        expect(proofErrorText(fr, code), contains('0,1'));
      }
      expect(priceListReasonText(en, 'unit_invalid'), isNotNull);
      expect(
        priceListReasonText(fr, 'unit_invalid'),
        isNot(priceListReasonText(en, 'unit_invalid')),
      );
      expect(
        priceListReasonText(en, 'per_lb_invalid', 'kg'),
        contains('per kilo'),
      );
      expect(
        priceListReasonText(fr, 'per_lb_invalid', 'kg'),
        contains('par kilo'),
      );
      expect(
        priceListReasonText(en, 'included_invalid', 'kg'),
        contains('500 kg'),
      );
    });
  });

  group('the weight field on screen', () {
    Future<void> open(
      WidgetTester tester,
      ProofFieldsController c, {
      Locale locale = const Locale('en'),
    }) => _pump(
      tester,
      ProofFields(controller: c, photosRequired: false),
      locale: locale,
    );

    testWidgets('a kilo list: the field is in kilos and offers no choice', (
      tester,
    ) async {
      final units = _units(_list('kg'));
      final c = ProofFieldsController(
        businessId: 'b1',
        units: units,
        urlOf: (_) async => '',
      );
      addTearDown(() {
        c.dispose();
        units.dispose();
      });
      await open(tester, c);
      expect(find.byKey(const Key('proof-unit')), findsNothing);
      await _type(tester, 'proof-weight', '4,5');
      expect(
        find.descendant(
          of: find.byKey(const Key('proof-weight')),
          matching: find.text('kg'),
        ),
        findsOneWidget,
      );
      expect(validateProofFields(c.draft).fields.weightKg, 4.5);
    });

    testWidgets('the field stays closed until the business unit is known', (
      tester,
    ) async {
      final answer = StreamController<PackagePriceList>();
      final units = BusinessWeightUnit(
        businessId: 'b1',
        watchList: (_) => answer.stream,
        memory: MemoryWeightUnitMemory(),
      );
      final c = ProofFieldsController(
        businessId: 'b1',
        units: units,
        urlOf: (_) async => '',
      );
      addTearDown(() {
        c.dispose();
        units.dispose();
        answer.close();
      });
      await open(tester, c);
      TextField field() =>
          tester.widget<TextField>(find.byKey(const Key('proof-weight')));
      // A kilo business must not get a weight typed as pounds while its
      // price list is still on the way.
      expect(field().enabled, isFalse);
      answer.add(_list('kg'));
      await tester.pumpAndSettle();
      expect(field().enabled, isTrue);
      expect(c.weightUnit, 'kg');
    });

    testWidgets('no list: lb | kg beside the field, and the pick is kept', (
      tester,
    ) async {
      final memory = MemoryWeightUnitMemory();
      final units = _units(PackagePriceList.empty, memory: memory);
      final c = ProofFieldsController(
        businessId: 'b1',
        units: units,
        urlOf: (_) async => '',
      );
      addTearDown(() {
        c.dispose();
        units.dispose();
      });
      await open(tester, c);
      expect(find.byKey(const Key('proof-unit')), findsOneWidget);
      expect(find.byTooltip('Weigh in pounds'), findsOneWidget);
      await _tap(tester, 'proof-unit-kg');
      expect(c.weightUnit, 'kg');
      expect(memory.value, 'kg');
      await _type(tester, 'proof-weight', '10');
      final payload = validateProofFields(c.draft).fields.toPayload();
      expect(payload['weightKg'], 10);
      expect(payload['weightLb'], 22);
      await _tap(tester, 'proof-unit-lb');
      expect(c.weightUnit, 'lb');
    });

    testWidgets('a pounds list: no choice, pounds', (tester) async {
      final units = _units(_list('lb'));
      final c = ProofFieldsController(
        businessId: 'b1',
        units: units,
        urlOf: (_) async => '',
      );
      addTearDown(() {
        c.dispose();
        units.dispose();
      });
      await open(tester, c);
      expect(find.byKey(const Key('proof-unit')), findsNothing);
      await _type(tester, 'proof-weight', '22');
      expect(
        validateProofFields(c.draft).fields.toPayload().containsKey('weightKg'),
        isFalse,
      );
    });

    testWidgets('the choice reads in French', (tester) async {
      final units = _units(PackagePriceList.empty);
      final c = ProofFieldsController(
        businessId: 'b1',
        units: units,
        urlOf: (_) async => '',
      );
      addTearDown(() {
        c.dispose();
        units.dispose();
      });
      await open(tester, c, locale: const Locale('fr'));
      expect(find.byTooltip('Peser en livres'), findsOneWidget);
      expect(find.byTooltip('Peser en kilos'), findsOneWidget);
    });
  });

  // -------------------------------------------------------------------------
  // The price list editor.
  // -------------------------------------------------------------------------

  group('the price list editor in kilos', () {
    const guinea = DestinationCountry(
      id: 'guinea',
      name: 'Guinea',
      isActive: true,
    );

    Future<FakePackageRequests> open(
      WidgetTester tester, {
      PackagePriceList? list,
      bool canEdit = true,
      Locale locale = const Locale('en'),
      bool? startOnAir,
    }) async {
      final fake = FakePackageRequests()..priceList = list ?? _list('lb');
      tester.view.physicalSize = const Size(430, 2600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.light,
          locale: locale,
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          home: PackagePriceListScreen(
            businessId: 'b1',
            service: fake,
            canEdit: canEdit,
            countries: (_) => Stream.value(const [guinea]),
            startOnAir: startOnAir ?? false,
          ),
        ),
      );
      await tester.pumpAndSettle();
      // The tests below read the Air tab; one that says where the screen
      // starts is left where it opened.
      if (startOnAir == null) {
        await _tap(tester, const ValueKey('ppl-mode:air'));
      }
      return fake;
    }

    bool modeSelected(WidgetTester tester, String mode) => tester
        .widget<ChoiceChip>(find.byKey(ValueKey('ppl-mode:$mode')))
        .selected;

    testWidgets('opens on Sea, as it always has', (tester) async {
      await open(tester, startOnAir: false);
      expect(modeSelected(tester, 'sea'), isTrue);
      expect(modeSelected(tester, 'air'), isFalse);
    });

    testWidgets('a business that only flies opens on Air, Sea one tap away', (
      tester,
    ) async {
      await open(tester, list: _list('kg'), startOnAir: true);
      expect(modeSelected(tester, 'air'), isTrue);
      expect(find.text('Price per kilo'), findsOneWidget);
      await _tap(tester, const ValueKey('ppl-mode:sea'));
      expect(modeSelected(tester, 'sea'), isTrue);
    });

    testWidgets('a pounds list: per lb, and the unit choice is there', (
      tester,
    ) async {
      await open(tester);
      expect(find.text('Price per pound'), findsOneWidget);
      expect(find.text('Price list unit'), findsOneWidget);
      expect(find.text('/lb'), findsWidgets);
      expect(find.byKey(const Key('ppl-unit-changed')), findsNothing);
    });

    testWidgets('a kilo list reads per kg all through', (tester) async {
      await open(tester, list: _list('kg'));
      expect(find.text('Price per kilo'), findsOneWidget);
      expect(find.text('/kg'), findsWidgets);
      expect(find.text('/lb'), findsNothing);
      // Items: the covered weight is in kilos.
      expect(find.text('Electronics · up to 2 kg each'), findsOneWidget);
      expect(
        tester
            .widget<ChoiceChip>(find.byKey(const ValueKey('ppl-unit:kg')))
            .selected,
        isTrue,
      );
    });

    testWidgets(
      'changing the unit keeps the amounts, says so once, and saves it',
      (tester) async {
        final fake = await open(tester);
        expect(find.byKey(const Key('ppl-unsaved')), findsNothing);
        await _tap(tester, const ValueKey('ppl-unit:kg'));
        expect(find.byKey(const Key('ppl-unit-changed')), findsOneWidget);
        expect(
          find.text(
            'Your prices are now per kg. The amounts did not change. Check them.',
          ),
          findsOneWidget,
        );
        expect(find.byKey(const Key('ppl-unsaved')), findsOneWidget);
        // The amount in the field did not move.
        expect(
          tester
              .widget<TextField>(
                find.byKey(const ValueKey('ppl-rate-field:guinea:air:general')),
              )
              .controller!
              .text,
          '25',
        );
        await _tap(tester, 'ppl-save');
        final body = fake.of('setPackageRequestSettings').single;
        expect(body['weightUnit'], 'kg');
        final route = ((body['routes'] as Map)['guinea'] as Map)['air'] as Map;
        expect((route['perLbCents'] as Map)['general'], 2500);
      },
    );

    testWidgets('picking the stored unit again clears the change', (
      tester,
    ) async {
      await open(tester);
      await _tap(tester, const ValueKey('ppl-unit:kg'));
      await _tap(tester, const ValueKey('ppl-unit:lb'));
      expect(find.byKey(const Key('ppl-unit-changed')), findsNothing);
      expect(find.byKey(const Key('ppl-unsaved')), findsNothing);
    });

    testWidgets('a pounds save still names its unit', (tester) async {
      final fake = await open(tester);
      await _type(
        tester,
        const ValueKey('ppl-rate-field:guinea:air:general'),
        '26',
      );
      await _tap(tester, 'ppl-save');
      expect(fake.of('setPackageRequestSettings').single['weightUnit'], 'lb');
    });

    testWidgets('staff read it: no choice to change', (tester) async {
      await open(tester, list: _list('kg'), canEdit: false);
      final chip = tester.widget<ChoiceChip>(
        find.byKey(const ValueKey('ppl-unit:lb')),
      );
      expect(chip.onSelected, isNull);
    });

    testWidgets('French: per kilo and the notice', (tester) async {
      await open(tester, locale: const Locale('fr'));
      expect(find.text('Unité de la liste de prix'), findsOneWidget);
      expect(find.text('par kg'), findsOneWidget);
      await _tap(tester, const ValueKey('ppl-unit:kg'));
      expect(find.text('Prix par kilo'), findsOneWidget);
      expect(
        find.text(
          "Vos prix sont maintenant au kilo. Les montants n'ont pas changé. Vérifiez-les.",
        ),
        findsOneWidget,
      );
    });
  });

  // -------------------------------------------------------------------------
  // The counter price fill (pure).
  // -------------------------------------------------------------------------

  group('price fill, the calculator', () {
    final kg = _airRoute();
    final lb = _airRoute(unit: 'lb');

    test('what the list offers, by name and in the shared order', () {
      expect(
        [for (final i in priceFillItems(kg)) i.label],
        ['Laptop', 'New phone'],
      );
      expect(
        [for (final k in priceFillWeightKinds(kg, 'en')) k.label],
        ['General goods', 'Clothes and fabric'],
      );
      expect(
        [for (final k in priceFillWeightKinds(kg, 'fr')) k.label],
        ['Marchandises générales', 'Vêtements et tissus'],
      );
      expect(priceFillAvailable(kg), isTrue);
      expect(priceFillAvailable(null), isFalse);
      expect(priceFillAvailable({'items': [], 'perLbCents': {}}), isFalse);
    });

    test('an item times a quantity', () {
      final one = fillFromItem(kg, 'i_phone');
      expect(one.fill!.priceCents, 11000);
      expect(one.fill!.description, 'New phone');
      final three = fillFromItem(kg, 'i_phone', quantity: 3);
      expect(three.fill!.priceCents, 33000);
      expect(three.fill!.description, '3 × New phone');
      expect(
        fillFromItem(kg, 'i_phone', quantity: 0).error,
        'quantity_invalid',
      );
      expect(fillFromItem(kg, 'i_gone').error, 'item_unknown');
    });

    test('\$25/kg x 10 kg is exactly \$250.00, described with its weight', () {
      final out = fillFromWeight(kg, 'general', '10');
      expect(out.fill!.priceCents, 25000);
      expect(out.fill!.description, 'General goods · 10 kg');
      expect(out.fill!.weight, 10);
      expect(out.fill!.unit, 'kg');
    });

    test('pounds on a pounds list, and French words', () {
      final out = fillFromWeight(lb, 'clothing', '12.5', lang: 'fr');
      expect(out.fill!.priceCents, 8750);
      expect(out.fill!.description, 'Vêtements et tissus · 12.5 lb');
      expect(out.fill!.unit, 'lb');
    });

    test('a weight that does not read is refused in the list\'s unit', () {
      expect(fillFromWeight(kg, 'general', '').error, 'weight_kg_invalid');
      expect(fillFromWeight(kg, 'general', '901').error, 'weight_kg_invalid');
      expect(fillFromWeight(lb, 'general', '2000.1').error, 'weight_invalid');
      expect(fillFromWeight(lb, 'general', '0').error, 'weight_invalid');
    });

    test('a kind the list has no rate for cannot be filled', () {
      expect(fillFromWeight(kg, 'food', '5').error, 'no_price');
    });

    test('the weights a fill asked for add up to a tenth', () {
      expect(sumFilledWeights([10, 5.5, null]), 15.5);
      expect(sumFilledWeights([null, 0]), isNull);
      expect(sumFilledWeights([0.1, 0.2]), 0.3);
    });
  });

  // -------------------------------------------------------------------------
  // The counter price fill on the register form.
  // -------------------------------------------------------------------------

  group('"From the price list" on a piece', () {
    Future<List<(String, Map<String, Object?>)>> open(
      WidgetTester tester, {
      PackagePriceList? list,
      Locale locale = const Locale('en'),
    }) async {
      final log = <(String, Map<String, Object?>)>[];
      final units = _units(list ?? _list('kg'));
      addTearDown(units.dispose);
      await _pump(
        tester,
        Builder(
          builder: (context) => TextButton(
            key: const Key('open'),
            onPressed: () => showLotSheet<void>(
              context,
              waitingPackageSheetForTesting(
                caller: (name, payload) async {
                  log.add((name, payload));
                  return {'lineId': 'l9', 'trackingCode': 'CL-BCDFGH'};
                },
                weightUnit: units,
                proofSettings: const PackageProofSettings(shipsByAir: true),
                defaultDestination: const DestinationRef('guinea', 'Guinea'),
              ),
            ),
            child: const Text('open'),
          ),
        ),
        locale: locale,
      );
      await _tap(tester, 'open');
      return log;
    }

    String price(WidgetTester tester, int i) => _text(tester, 'piece-price-$i');
    String description(WidgetTester tester, int i) =>
        _text(tester, 'piece-description-$i');

    testWidgets('only where the business priced this country and mode', (
      tester,
    ) async {
      await open(tester);
      // Sea is the default and the list prices Air only.
      expect(find.byKey(const Key('piece-from-list-0')), findsNothing);
      await _tap(tester, 'ship-mode-air');
      expect(find.byKey(const Key('piece-from-list-0')), findsOneWidget);
      await _tap(tester, 'ship-mode-sea');
      expect(find.byKey(const Key('piece-from-list-0')), findsNothing);
    });

    testWidgets('a business with no price list sees nothing new', (
      tester,
    ) async {
      await open(tester, list: PackagePriceList.empty);
      await _tap(tester, 'ship-mode-air');
      expect(find.byKey(const Key('piece-from-list-0')), findsNothing);
    });

    testWidgets(
      'an item fills the description and the price; quantity multiplies',
      (tester) async {
        await open(tester);
        await _tap(tester, 'ship-mode-air');
        await _tap(tester, 'piece-from-list-0');
        expect(find.text('Items'), findsOneWidget);
        expect(find.text('By weight'), findsOneWidget);
        await _tap(tester, 'fill-item:i_phone');
        expect(find.text(r'Price: $110.00'), findsOneWidget);
        await _tap(tester, 'fill-qty-more');
        expect(find.text(r'Price: $220.00'), findsOneWidget);
        await _tap(tester, 'fill-use');
        expect(price(tester, 0), '220');
        expect(description(tester, 0), '2 × New phone');
        // An item gives the package no weight.
        expect(_text(tester, 'proof-weight'), '');
      },
    );

    testWidgets(
      'a description staff typed is kept; the price is still editable',
      (tester) async {
        await open(tester);
        await _tap(tester, 'ship-mode-air');
        await _type(tester, 'piece-description-0', 'Gift for my aunt');
        await _tap(tester, 'piece-from-list-0');
        await _tap(tester, 'fill-item:i_phone');
        await _tap(tester, 'fill-use');
        expect(description(tester, 0), 'Gift for my aunt');
        expect(price(tester, 0), '110');
        await _type(tester, 'piece-price-0', '100');
        expect(price(tester, 0), '100');
        expect(
          tester
              .widget<Text>(find.byKey(const Key('pieces-total-amount')))
              .data,
          r'$100.00',
        );
      },
    );

    testWidgets('a by-weight kind asks the weight in the list\'s unit', (
      tester,
    ) async {
      await open(tester);
      await _tap(tester, 'ship-mode-air');
      await _tap(tester, 'piece-from-list-0');
      await _tap(tester, 'fill-weight-kind:general');
      expect(
        find.descendant(
          of: find.byKey(const Key('fill-detail')),
          matching: find.text('Weight (kg)'),
        ),
        findsOneWidget,
      );
      // Nothing typed yet: no price, and Use says what is missing.
      expect(find.byKey(const Key('fill-price')), findsNothing);
      await _tap(tester, 'fill-use');
      expect(
        find.text('Enter the weight in kilos (0.1 to 900).'),
        findsOneWidget,
      );
      await _type(tester, 'fill-weight', '10');
      expect(find.text(r'Price: $250.00'), findsOneWidget);
      await _tap(tester, 'fill-use');
      expect(price(tester, 0), '250');
      expect(description(tester, 0), 'General goods · 10 kg');
      // On an air package with an empty weight, the package weight is filled.
      expect(_text(tester, 'proof-weight'), '10');
    });

    testWidgets('several by-weight pieces add up in the package weight', (
      tester,
    ) async {
      await open(tester);
      await _tap(tester, 'ship-mode-air');
      await _tap(tester, 'piece-from-list-0');
      await _tap(tester, 'fill-weight-kind:general');
      await _type(tester, 'fill-weight', '10');
      await _tap(tester, 'fill-use');
      await _tap(tester, 'pieces-add');
      await _tap(tester, 'piece-from-list-1');
      await _tap(tester, 'fill-weight-kind:clothing');
      await _type(tester, 'fill-weight', '5,5');
      await _tap(tester, 'fill-use');
      expect(price(tester, 1), '38.50');
      expect(_text(tester, 'proof-weight'), '15.5');
    });

    testWidgets('an item put in place of the weighed kind takes the weight '
        'back', (tester) async {
      await open(tester);
      await _tap(tester, 'ship-mode-air');
      await _tap(tester, 'piece-from-list-0');
      await _tap(tester, 'fill-weight-kind:general');
      await _type(tester, 'fill-weight', '10');
      await _tap(tester, 'fill-use');
      expect(_text(tester, 'proof-weight'), '10');
      // The same piece is a phone after all: it weighs nothing here.
      await _tap(tester, 'piece-from-list-0');
      await _tap(tester, 'fill-item:i_phone');
      await _tap(tester, 'fill-use');
      expect(price(tester, 0), '110');
      expect(_text(tester, 'proof-weight'), '');
    });

    testWidgets('an item beside a weighed piece leaves the weight', (
      tester,
    ) async {
      await open(tester);
      await _tap(tester, 'ship-mode-air');
      await _tap(tester, 'piece-from-list-0');
      await _tap(tester, 'fill-weight-kind:general');
      await _type(tester, 'fill-weight', '10');
      await _tap(tester, 'fill-use');
      await _tap(tester, 'pieces-add');
      await _tap(tester, 'piece-from-list-1');
      await _tap(tester, 'fill-item:i_phone');
      await _tap(tester, 'fill-use');
      expect(_text(tester, 'proof-weight'), '10');
    });

    testWidgets('a typed weight stays when the fill no longer weighs', (
      tester,
    ) async {
      await open(tester);
      await _tap(tester, 'ship-mode-air');
      await _tap(tester, 'piece-from-list-0');
      await _tap(tester, 'fill-weight-kind:general');
      await _type(tester, 'fill-weight', '10');
      await _tap(tester, 'fill-use');
      await _type(tester, 'proof-weight', '12');
      await _tap(tester, 'piece-from-list-0');
      await _tap(tester, 'fill-item:i_phone');
      await _tap(tester, 'fill-use');
      expect(_text(tester, 'proof-weight'), '12');
    });

    testWidgets('a package weight staff typed is never overwritten', (
      tester,
    ) async {
      await open(tester);
      await _tap(tester, 'ship-mode-air');
      await _type(tester, 'proof-weight', '3');
      await _tap(tester, 'piece-from-list-0');
      await _tap(tester, 'fill-weight-kind:general');
      await _type(tester, 'fill-weight', '10');
      await _tap(tester, 'fill-use');
      expect(price(tester, 0), '250');
      expect(_text(tester, 'proof-weight'), '3');
    });

    testWidgets('back to the list, then another pick', (tester) async {
      await open(tester);
      await _tap(tester, 'ship-mode-air');
      await _tap(tester, 'piece-from-list-0');
      await _tap(tester, 'fill-item:i_laptop');
      await _tap(tester, 'fill-back');
      expect(find.byKey(const Key('fill-list')), findsOneWidget);
      await _tap(tester, 'fill-item:i_phone');
      await _tap(tester, 'fill-use');
      expect(price(tester, 0), '110');
    });

    testWidgets('what is filled is sent as the piece price, and the kilos', (
      tester,
    ) async {
      final log = await open(tester);
      await _tap(tester, 'ship-mode-air');
      await _type(tester, 'line-customer', 'Test Sender');
      await _type(tester, 'line-receiver', 'Test Receiver');
      await _tap(tester, 'piece-from-list-0');
      await _tap(tester, 'fill-weight-kind:general');
      await _type(tester, 'fill-weight', '10');
      await _tap(tester, 'fill-use');
      await _tap(tester, 'line-save');
      final sent = log.where((c) => c.$1 == 'addWaitingPackage').single.$2;
      final piece = (sent['pieces'] as List).single as Map;
      expect(piece['priceCents'], 25000);
      expect(piece['description'], 'General goods · 10 kg');
      // 10 kg typed by the fill: stored as kilos, with the pounds it makes.
      expect(sent['weightKg'], 10);
      expect(sent['weightLb'], 22);
      expect(sent['shipMode'], 'air');
    });

    testWidgets('reads in French', (tester) async {
      await open(tester, locale: const Locale('fr'));
      await _tap(tester, 'ship-mode-air');
      expect(find.text('Depuis la liste de prix'), findsOneWidget);
      await _tap(tester, 'piece-from-list-0');
      expect(find.text('Articles'), findsOneWidget);
      expect(find.text('Au poids'), findsOneWidget);
      await _tap(tester, 'fill-weight-kind:general');
      expect(find.text('Marchandises générales'), findsWidgets);
      await _type(tester, 'fill-weight', '10');
      expect(find.byKey(const Key('fill-price')), findsOneWidget);
      expect(find.textContaining('250,00'), findsOneWidget);
      await _tap(tester, 'fill-use');
      expect(description(tester, 0), 'Marchandises générales · 10 kg');
    });
  });

  group('the register form weighs in the business unit', () {
    testWidgets('kilos typed on the form are sent with their pounds', (
      tester,
    ) async {
      final log = <(String, Map<String, Object?>)>[];
      final units = _units(_list('kg'));
      addTearDown(units.dispose);
      await _pump(
        tester,
        Builder(
          builder: (context) => TextButton(
            key: const Key('open'),
            onPressed: () => showLotSheet<void>(
              context,
              waitingPackageSheetForTesting(
                caller: (name, payload) async {
                  log.add((name, payload));
                  return {'lineId': 'l9', 'trackingCode': 'CL-BCDFGH'};
                },
                weightUnit: units,
                proofSettings: const PackageProofSettings(shipsByAir: true),
                defaultDestination: const DestinationRef('guinea', 'Guinea'),
              ),
            ),
            child: const Text('open'),
          ),
        ),
      );
      await _tap(tester, 'open');
      await _tap(tester, 'ship-mode-air');
      await _type(tester, 'line-customer', 'Test Sender');
      await _type(tester, 'line-receiver', 'Test Receiver');
      await _type(tester, 'piece-price-0', '90');
      await _type(tester, 'proof-weight', '4,5');
      await _tap(tester, 'line-save');
      final sent = log.where((c) => c.$1 == 'addWaitingPackage').single.$2;
      expect(sent['weightKg'], 4.5);
      expect(sent['weightLb'], 9.9);
    });

    testWidgets('a pounds business sends pounds alone, as before', (
      tester,
    ) async {
      final log = <(String, Map<String, Object?>)>[];
      final units = _units(_list('lb'));
      addTearDown(units.dispose);
      await _pump(
        tester,
        Builder(
          builder: (context) => TextButton(
            key: const Key('open'),
            onPressed: () => showLotSheet<void>(
              context,
              waitingPackageSheetForTesting(
                caller: (name, payload) async {
                  log.add((name, payload));
                  return {'lineId': 'l9', 'trackingCode': 'CL-BCDFGH'};
                },
                weightUnit: units,
                proofSettings: const PackageProofSettings(shipsByAir: true),
                defaultDestination: const DestinationRef('guinea', 'Guinea'),
              ),
            ),
            child: const Text('open'),
          ),
        ),
      );
      await _tap(tester, 'open');
      await _tap(tester, 'ship-mode-air');
      await _type(tester, 'line-customer', 'Test Sender');
      await _type(tester, 'line-receiver', 'Test Receiver');
      await _type(tester, 'piece-price-0', '90');
      await _type(tester, 'proof-weight', '22');
      await _tap(tester, 'line-save');
      final sent = log.where((c) => c.$1 == 'addWaitingPackage').single.$2;
      expect(sent['weightLb'], 22);
      expect(sent.containsKey('weightKg'), isFalse);
    });
  });

  // -------------------------------------------------------------------------
  // Received: a piece the business priced by the kilo.
  // -------------------------------------------------------------------------

  group('Received, a piece priced by the kilo', () {
    PackageRequest request() => PackageRequest.fromMap('r1', {
      'businessId': 'b1',
      'code': 'R-R1AAAA',
      'status': 'confirmed',
      'handoff': 'bring_in',
      'shipMode': 'air',
      'plannedDate': '2026-11-03',
      'sender': {'name': 'Test Sender', 'phoneE164': '+19175551234'},
      'receiver': {'name': 'Test Receiver'},
      'destinationCountryName': 'Guinea',
      'pieces': [
        {
          'id': 'p1',
          'kind': 'other',
          'description': 'General goods · 10 kg',
          'estimateCents': 25000,
          'price': {
            'source': 'per_lb',
            'itemId': '',
            'label': 'General goods',
            'categoryId': 'general',
            'quantity': 1,
            'unitCents': null,
            'includedLb': 0,
            'excessPerLbCents': null,
            'perLbCents': 2500,
            'weightLb': 10,
            'unit': 'kg',
          },
        },
        {
          'id': 'p2',
          'kind': 'other',
          'description': '2 × Laptop',
          'estimateCents': 14000,
          'price': {
            'source': 'item',
            'itemId': 'i_laptop',
            'label': 'Laptop',
            'categoryId': 'electronics',
            'quantity': 2,
            'unitCents': 7000,
            'includedLb': 2,
            'excessPerLbCents': 2500,
            'perLbCents': null,
            'weightLb': null,
            'unit': 'kg',
          },
        },
      ],
    });

    testWidgets('the piece weight is asked in kilos and prices from the list', (
      tester,
    ) async {
      final fake = FakePackageRequests();
      final units = _units(_list('kg'));
      addTearDown(units.dispose);
      await _pump(
        tester,
        Builder(
          builder: (context) => TextButton(
            key: const Key('open'),
            onPressed: () => showReceiveRequestSheet(
              context,
              businessId: 'b1',
              request: request(),
              service: fake,
              shipsByAir: true,
              weightUnit: units,
            ),
            child: const Text('open'),
          ),
        ),
      );
      await _tap(tester, 'open');
      expect(find.text('Weight (kg)'), findsWidgets);
      expect(find.text('Weight (lb)'), findsNothing);
      // The customer's 10 kg opens in the field.
      expect(_text(tester, 'piece-weight-0'), '10');
      // 12.5 kg at $25 a kilo.
      await _type(tester, 'piece-weight-0', '12.5');
      expect(_text(tester, 'piece-price-0'), '312.50');
      // Two laptops cover 4 kg: 5 kg is 1 kg over, at $25.
      await _type(tester, 'piece-weight-1', '5');
      expect(_text(tester, 'piece-price-1'), '165');
      // The package's own weight follows the business: kilos.
      await _type(tester, 'proof-weight', '17,5');
      await _tap(tester, 'receive-save');
      final sent = fake.of('receivePackageRequest').single;
      expect(sent['weightKg'], 17.5);
      expect(sent['weightLb'], 38.6);
    });
  });
}
