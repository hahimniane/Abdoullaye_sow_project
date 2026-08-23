import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/utils/freight_payback.dart';

// Twin of functions/test/freight-payback.test.js and the web mirror -
// three clients, one price.
void main() {
  const table = <String, dynamic>{
    'electronics': {
      'items': [
        {'id': 'iphone', 'label': 'iPhone', 'paybackAmount': 400},
        {'id': 'samsung-phone', 'label': 'Samsung phone', 'paybackAmount': 250},
      ],
      'otherPaybackAmount': 100,
    },
    'clothing': {'items': <Object>[], 'otherPaybackAmount': 0},
  };

  test('prices the exact row the business published', () {
    expect(
      freightPaybackFor(
        table: table, categoryId: 'electronics', itemId: 'iphone',
      ).paybackAmount,
      400,
    );
    expect(
      freightPaybackFor(
        table: table, categoryId: 'electronics', itemId: 'samsung-phone',
      ).paybackAmount,
      250,
    );
  });

  test('falls back to the catch-all, and says unlisted otherwise', () {
    final unknown = freightPaybackFor(
      table: table, categoryId: 'electronics', itemId: 'walkman',
    );
    expect(unknown.paybackAmount, 100);
    expect(unknown.source, 'other');
    expect(
      freightPaybackFor(table: table, categoryId: 'clothing', itemId: 'boubou')
          .listed,
      false,
    );
    expect(
      freightPaybackFor(table: null, categoryId: 'electronics').listed,
      false,
    );
  });

  test('the payback is the published amount, whole', () {
    // What a covering business pays back is the row it published, not a
    // proportion of it - and it costs the customer nothing to be owed it.
    final listed = freightPaybackFor(
      table: table, categoryId: 'electronics', itemId: 'iphone',
    );
    expect(listed.paybackAmount, 400);
    expect(listed.source, 'item');
    expect(listed.label, 'iPhone');
  });

  test('the funnel unions items and matches like the web', () {
    const withTable = <String, dynamic>{
      'electronics': {
        'items': [
          {'id': 'iphone', 'label': 'iPhone', 'paybackAmount': 400},
        ],
        'otherPaybackAmount': 0,
      },
    };
    const withCatchAll = <String, dynamic>{
      'electronics': {'items': <Object>[], 'otherPaybackAmount': 50},
    };

    final choices =
        freightItemChoicesFor([withTable, withCatchAll], 'electronics');
    expect(choices.map((c) => c.id).toList(), ['iphone', otherItemId]);

    expect(providerQualifiesForItem(withTable, 'electronics', 'iphone'), true);
    expect(
      providerQualifiesForItem(withCatchAll, 'electronics', 'iphone'),
      true,
    );
    expect(
      providerQualifiesForItem(withTable, 'electronics', otherItemId),
      false,
    );
    expect(providerQualifiesForItem(null, 'electronics', 'anything'), true);
    expect(freightItemChoicesFor([withTable], 'clothing'), isEmpty);
  });

  group('how a business prices what it carries', () {
    // The same fixture the functions authority resolves against, row for row,
    // so a drift in either resolution order fails on one of the two sides.
    const priced = <String, dynamic>{
      'electronics': {
        'items': [
          // A known object: one price, and an allowance so the retail box and
          // charger do not come out of the business's pocket.
          {
            'id': 'iphone', 'label': 'iPhone 16', 'paybackAmount': 400,
            'pricingMode': 'flat', 'flatPrice': 50, 'includedKg': 2,
          },
          // A set price covering the parcel however heavy it is.
          {
            'id': 'sim', 'label': 'SIM card', 'paybackAmount': 5,
            'pricingMode': 'flat', 'flatPrice': 10,
          },
          // Goods that vary, priced by the scale at this row's own factor.
          {
            'id': 'mixed-tech', 'label': 'Assorted tech', 'paybackAmount': 100,
            'pricingMode': 'per_kg', 'weightFactor': 2.5,
          },
          // A row saved before a row could carry a price.
          {'id': 'legacy', 'label': 'Legacy row', 'paybackAmount': 90},
        ],
        'otherPaybackAmount': 60,
        'otherPricingMode': 'per_kg',
        'otherWeightFactor': 1.8,
      },
      'clothing': {'items': <Object>[], 'otherPaybackAmount': 40},
    };

    test('prices a known object once, and never weighs it at booking', () {
      final p = freightItemPricing(
        table: priced,
        categoryId: 'electronics',
        itemId: 'iphone',
        categoryMultiplier: 2,
      );
      expect(p.mode, 'flat');
      expect(p.isFlat, true);
      expect(p.flatPrice, 50);
      expect(p.includedKg, 2);
      // The customer picks the item and sees the price - nobody guesses the
      // weight of an iPhone at their kitchen table.
      expect(p.needsWeightAtBooking, false);
      // The counter still weighs it, because the price covers only 2kg.
      expect(p.weighsAtDropOff, true);
      expect(p.source, 'item');
    });

    test('never weighs a set price that covers any weight', () {
      final p = freightItemPricing(
        table: priced,
        categoryId: 'electronics',
        itemId: 'sim',
        categoryMultiplier: 2,
      );
      expect(p.flatPrice, 10);
      expect(p.includedKg, 0);
      expect(p.needsWeightAtBooking, false);
      expect(p.weighsAtDropOff, false);
    });

    test("weighs goods that vary, at the row's own factor", () {
      final p = freightItemPricing(
        table: priced,
        categoryId: 'electronics',
        itemId: 'mixed-tech',
        categoryMultiplier: 2,
      );
      expect(p.mode, 'per_kg');
      expect(p.weightFactor, 2.5);
      expect(p.needsWeightAtBooking, true);
      expect(p.weighsAtDropOff, true);
    });

    test('prices a row saved before this existed exactly as before', () {
      // The migration promise: nothing anyone is charged moves on the day
      // item pricing ships.
      for (final itemId in const ['legacy', 'nothing-listed']) {
        final p = freightItemPricing(
          table: priced,
          categoryId: 'clothing',
          itemId: itemId,
          categoryMultiplier: 1.5,
        );
        expect(p.mode, 'per_kg', reason: itemId);
        expect(p.weightFactor, 1.5, reason: itemId);
      }
      final legacy = freightItemPricing(
        table: priced,
        categoryId: 'electronics',
        itemId: 'legacy',
        categoryMultiplier: 2,
      );
      expect(legacy.weightFactor, 2);
      expect(legacy.source, 'item');
    });

    test("falls through to the category's catch-all pricing", () {
      final p = freightItemPricing(
        table: priced,
        categoryId: 'electronics',
        itemId: 'not-a-row',
        categoryMultiplier: 2,
      );
      expect(p.source, 'other');
      expect(p.weightFactor, 1.8);
    });

    test('prices a business with no table at the category multiplier', () {
      final p = freightItemPricing(
        table: null,
        categoryId: 'electronics',
        itemId: 'iphone',
        categoryMultiplier: 2,
      );
      expect(p.mode, 'per_kg');
      expect(p.weightFactor, 2);
      expect(p.source, isNull);
    });

    test('resolves in the order the functions authority documents', () {
      // Item row before catch-all, and a priced row wins over the catch-all
      // even when the catch-all names a different mode entirely.
      const catchAllIsFlat = <String, dynamic>{
        'electronics': {
          'items': [
            {
              'id': 'mixed-tech', 'label': 'Assorted tech',
              'paybackAmount': 100, 'pricingMode': 'per_kg',
              'weightFactor': 2.5,
            },
            {'id': 'legacy', 'label': 'Legacy row', 'paybackAmount': 90},
          ],
          'otherPaybackAmount': 60,
          'otherPricingMode': 'flat',
          'otherFlatPrice': 25,
          'otherIncludedKg': 3,
        },
      };
      // The sharp edge of the migration: a LISTED row that states no pricing
      // keeps its category multiplier. Letting it reach the catch-all would
      // hand every legacy row a set price nobody set for it.
      final legacy = freightItemPricing(
        table: catchAllIsFlat,
        categoryId: 'electronics',
        itemId: 'legacy',
        categoryMultiplier: 2,
      );
      expect(legacy.mode, 'per_kg');
      expect(legacy.weightFactor, 2);
      expect(legacy.source, 'item');
      final row = freightItemPricing(
        table: catchAllIsFlat,
        categoryId: 'electronics',
        itemId: 'mixed-tech',
        categoryMultiplier: 2,
      );
      expect(row.mode, 'per_kg');
      expect(row.weightFactor, 2.5);

      final catchAll = freightItemPricing(
        table: catchAllIsFlat,
        categoryId: 'electronics',
        itemId: '',
        categoryMultiplier: 2,
      );
      expect(catchAll.mode, 'flat');
      expect(catchAll.flatPrice, 25);
      expect(catchAll.includedKg, 3);
      expect(catchAll.weighsAtDropOff, true);
      expect(catchAll.source, 'other');
    });
  });

  group('the booking screen prices a set item without a scale', () {
    final screen = File(
      'lib/screens/send_freight_screen.dart',
    ).readAsStringSync();
    final service = File(
      'lib/services/freight_shipment_service.dart',
    ).readAsStringSync();

    test('a set price hides the weight field and never sends a weight', () {
      // Asking what an iPhone weighs would put a number in the booking that
      // nothing is ever charged against.
      expect(screen, contains('bool get _setPrice => _itemPricing.isFlat;'));
      expect(screen, contains('if (_setPrice)\n          _setPriceSection('));
      expect(screen, contains('weightKg: _setPrice ? 0 : _weightKg'));
      // And the guard on the button must not hold the order for a weight
      // this parcel has no reason to carry.
      expect(screen, contains('if (!_setPrice && _weightKg <= 0)'));
      expect(service, contains("if (weightKg > 0) 'weightKg': weightKg"));
      expect(service, contains('double weightKg = 0,'));
    });

    test('the allowance and what excess costs are both shown', () {
      // An allowance is the one thing that can still move this price at the
      // counter, so it is said before the parcel is handed over.
      expect(screen, contains('freightSetPriceCoversUpTo'));
      expect(screen, contains('freightSetPriceCoversAnyWeight'));
      expect(screen, contains('freightSetPriceOverAllowanceNote'));
      expect(screen, contains('freightSetPriceFinal'));
      // The excess rides on the route's own per-kg rate, not the item factor
      // (which a set-price row does not have).
      expect(
        screen,
        contains("'\\\$\${_ratePerKg.toStringAsFixed(2)}',"),
      );
    });

    test('the price is the set price, and the total adds the fees to it', () {
      expect(
        screen,
        contains(
          'double get _price => _setPrice\n'
          '      ? _itemPricing.flatPrice',
        ),
      );
      expect(
        screen,
        contains(
          'double get _totalPrice => _price + _appliedPickupFee + '
          '_appliedDeliveryFee;',
        ),
      );
    });

    test("a by-weight row is priced at the row's factor", () {
      // The category multiplier is the fallback, not the knob: a row with its
      // own factor must not be quoted at the category's.
      expect(
        screen,
        contains('multiplier: _itemPricing.weightFactor,'),
      );
      expect(
        screen,
        contains(
          'double get _effectiveRatePerKg => _ratePerKg * '
          '_itemPricing.weightFactor;',
        ),
      );
      // The category card only claims to price the parcel while it actually
      // does.
      expect(screen, contains('_categoryPricesParcel'));
    });

    test('the set-price copy exists in both catalogs', () {
      Map<String, dynamic> arb(String locale) =>
          Map<String, dynamic>.from(
            jsonDecode(
              File('lib/l10n/app_$locale.arb').readAsStringSync(),
            ) as Map,
          );
      final en = arb('en');
      final fr = arb('fr');
      for (final key in const [
        'freightSetPriceTitle',
        'freightSetPriceLine',
        'freightSetPriceCoversUpTo',
        'freightSetPriceCoversAnyWeight',
        'freightSetPriceFinal',
        'freightSetPriceOverAllowanceNote',
      ]) {
        expect(en[key], isNotNull, reason: 'app_en.arb is missing $key');
        expect(fr[key], isNotNull, reason: 'app_fr.arb is missing $key');
        expect(
          (fr[key] as String).trim(),
          isNotEmpty,
          reason: 'app_fr.arb has an empty $key',
        );
      }
    });
  });
}
