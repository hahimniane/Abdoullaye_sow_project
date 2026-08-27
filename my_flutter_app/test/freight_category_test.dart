import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/business_destination_option.dart';
import 'package:my_flutter_app/services/freight_categories.dart';

/// The app half of freight categories. These assertions are deliberately the
/// same ones `functions/test/freight-categories.test.js` makes: a price the
/// screen shows and the server then charges differently is a bug, not a
/// rounding difference. The quote on the button has to be the quote on the
/// card statement.

Map<String, Object?> categoryRow(
  String id,
  double multiplier, {
  String label = 'Row',
  bool custom = false,
}) => {
  'id': id,
  'label': label,
  'hint': '',
  'multiplier': multiplier,
  'custom': custom,
};

void main() {
  group('the platform owns the list', () {
    test('standard ids and defaults mirror the server', () {
      expect(standardFreightCategoryIds, <String>[
        'general',
        'clothing',
        'food',
        'documents',
        'cosmetics',
        'electronics',
        'fragile',
      ]);
      final defaults = <String, double>{
        for (final category in standardFreightCategories)
          category.id: category.defaultMultiplier,
      };
      expect(defaults, <String, double>{
        'general': 1,
        'clothing': 1,
        'food': 1,
        'documents': 1,
        'cosmetics': 1,
        'electronics': 1,
        'fragile': 1,
      });
    });

    test('standardFreightCategoryIds stays in step with the table', () {
      expect(
        standardFreightCategories.map((category) => category.id).toList(),
        standardFreightCategoryIds,
      );
    });

    test('a business cannot shadow a standard row with its own', () {
      expect(
        normalizeCustomFreightCategory({
          'id': 'electronics',
          'label': 'Appareils',
        }),
        isNull,
      );
    });

    test('a business keeps its own rows after the standard ones', () {
      final categories = freightCategoriesFromBusinessData({
        'freightCustomCategories': [
          {'id': 'car-parts', 'label': 'Car parts', 'multiplier': 3},
        ],
      });
      expect(categories.length, standardFreightCategoryIds.length + 1);
      expect(categories.last.id, 'car-parts');
      expect(categories.last.custom, isTrue);
      expect(categories.last.multiplier, 3);
    });

    test('no more than six of a business own rows reach the customer', () {
      final categories = freightCategoriesFromBusinessData({
        'freightCustomCategories': [
          for (var i = 0; i < 12; i++) {'id': 'extra-$i', 'label': 'Extra $i'},
        ],
      });
      expect(
        categories.where((category) => category.custom).length,
        maxCustomFreightCategories,
      );
    });
  });

  group('the business owns the price', () {
    test('an override replaces the platform default', () {
      final categories = freightCategoriesFromBusinessData({
        'freightCategoryRates': {'electronics': 3},
      });
      expect(freightCategoryMultiplier(categories, 'electronics'), 3);
      expect(freightCategoryMultiplier(categories, 'fragile'), 1);
    });

    test('an unreadable multiplier falls back to the platform default', () {
      final categories = freightCategoriesFromBusinessData({
        'freightCategoryRates': {'electronics': 'a lot'},
      });
      expect(freightCategoryMultiplier(categories, 'electronics'), 1);
    });

    test('a multiplier outside the band is clamped, not honoured', () {
      expect(normalizeFreightMultiplier(0.1), minFreightCategoryMultiplier);
      expect(normalizeFreightMultiplier(500), maxFreightCategoryMultiplier);
    });

    test('an unknown or missing category prices as freight always did', () {
      final categories = freightCategoriesFromBusinessData(null);
      expect(freightCategoryMultiplier(categories, 'jet-engine'), 1);
      expect(freightCategoryMultiplier(categories, ''), 1);
      expect(freightCategoryMultiplier(categories, null), 1);
      expect(freightCategoryMultiplier(const [], 'electronics'), 1);
    });

    test('a business that sets nothing keeps the old prices exactly', () {
      final categories = freightCategoriesFromBusinessData(<String, dynamic>{});
      expect(freightCategoryMultiplier(categories, 'general'), 1);
      expect(
        freightShippingFee(weightKg: 10, ratePerKg: 6.5, multiplier: 1),
        10 * 6.5,
      );
    });
  });

  group('the shipping fee', () {
    test('rounds to the cent the way the server does', () {
      // 3.33 kg x $4.99 x 1.2 = 19.9400... - the server rounds the product,
      // not each factor, and so does this.
      expect(
        freightShippingFee(weightKg: 3.33, ratePerKg: 4.99, multiplier: 1.2),
        19.94,
      );
    });

    test('is zero rather than negative for an unentered weight', () {
      expect(freightShippingFee(weightKg: 0, ratePerKg: 5), 0);
      expect(freightShippingFee(weightKg: -2, ratePerKg: 5), 0);
    });

    test('a heavier multiplier costs strictly more', () {
      final plain = freightShippingFee(weightKg: 5, ratePerKg: 4);
      final electronics = freightShippingFee(
        weightKg: 5,
        ratePerKg: 4,
        multiplier: 2,
      );
      expect(electronics, greaterThan(plain));
      expect(electronics, plain * 2);
    });
  });

  group('reading what the callable sent', () {
    test('rows arrive in the order the platform sent them', () {
      final categories = FreightCategory.listFromWire([
        categoryRow('general', 1),
        categoryRow('electronics', 2),
        categoryRow('car-parts', 3, custom: true),
      ]);
      expect(categories.map((category) => category.id).toList(), [
        'general',
        'electronics',
        'car-parts',
      ]);
      expect(categories.last.custom, isTrue);
    });

    test('a nameless or idless row is not offered as a choice', () {
      final categories = FreightCategory.listFromWire([
        {'id': '', 'label': 'Nothing'},
        {'id': 'ghost', 'label': ''},
        categoryRow('general', 1),
      ]);
      expect(categories.map((category) => category.id).toList(), ['general']);
    });

    test('a duplicate id is dropped rather than shown twice', () {
      final categories = FreightCategory.listFromWire([
        categoryRow('general', 1),
        categoryRow('general', 5),
      ]);
      expect(categories.length, 1);
      expect(categories.single.multiplier, 1);
    });

    test('anything that is not a list is no categories at all', () {
      expect(FreightCategory.listFromWire(null), isEmpty);
      expect(FreightCategory.listFromWire('electronics'), isEmpty);
    });

    test('a row at 1 says it does not change the price', () {
      final categories = FreightCategory.listFromWire([
        categoryRow('general', 1),
        categoryRow('electronics', 2),
      ]);
      expect(categories.first.changesPrice, isFalse);
      expect(categories.last.changesPrice, isTrue);
    });
  });

  group('the row the screen starts on', () {
    test('is general, wherever it sits in the list', () {
      final categories = FreightCategory.listFromWire([
        categoryRow('electronics', 2),
        categoryRow('general', 1),
      ]);
      expect(defaultFreightCategoryId(categories), 'general');
    });

    test('falls back to the first row when general is gone', () {
      final categories = FreightCategory.listFromWire([
        categoryRow('electronics', 2),
      ]);
      expect(defaultFreightCategoryId(categories), 'electronics');
    });

    test('is empty when the business offers no categories', () {
      expect(defaultFreightCategoryId(const []), '');
    });

    test('lookup finds a row by id and misses everything else', () {
      final categories = FreightCategory.listFromWire([
        categoryRow('general', 1),
      ]);
      expect(freightCategoryLookup(categories, 'GENERAL')?.id, 'general');
      expect(freightCategoryLookup(categories, 'retired'), isNull);
      expect(freightCategoryLookup(categories, null), isNull);
    });
  });

  group('the destination option carries them', () {
    test('categories and coverage ride along with the option', () {
      final option = BusinessDestinationOption.fromFunctionData({
        'id': 'biz_gn',
        'businessId': 'biz',
        'businessName': 'Business',
        'enabledServices': ['freight'],
        'freightCategories': [
          categoryRow('general', 1),
          categoryRow('electronics', 2.5),
        ],
        'freightCoverage': {
          'coversLoss': true,
          'ratePct': 2,
          'maxDeclaredValue': 2000,
          'declarationThreshold': 200,
        },
        'country': {'id': 'gn', 'name': 'Guinea', 'isActive': true},
      });
      expect(option.freightCategories.length, 2);
      expect(
        freightCategoryMultiplier(option.freightCategories, 'electronics'),
        2.5,
      );
      expect(option.freightCoverage?.coversLoss, isTrue);
    });

    test('a business without freight carries neither', () {
      final option = BusinessDestinationOption.fromFunctionData({
        'id': 'biz_gn',
        'businessId': 'biz',
        'businessName': 'Business',
        'enabledServices': ['barrelShipping'],
        'freightCategories': <Object>[],
        'freightCoverage': null,
        'country': {'id': 'gn', 'name': 'Guinea', 'isActive': true},
      });
      expect(option.freightCategories, isEmpty);
      expect(option.freightCoverage, isNull);
    });
  });

  group('the words a customer reads', () {
    Map<String, Object?> arb(String locale) =>
        jsonDecode(File('lib/l10n/app_$locale.arb').readAsStringSync())
            as Map<String, Object?>;

    test('every standard category has a label and a hint in both catalogs', () {
      final en = arb('en');
      final fr = arb('fr');
      for (final category in standardFreightCategories) {
        final suffix =
            category.id[0].toUpperCase() + category.id.substring(1);
        for (final key in ['freightCategory$suffix', 'freightCategory${suffix}Hint']) {
          expect(en[key], isNotNull, reason: 'app_en.arb is missing $key');
          expect(fr[key], isNotNull, reason: 'app_fr.arb is missing $key');
          expect(
            (fr[key] as String).trim(),
            isNotEmpty,
            reason: 'app_fr.arb has an empty $key',
          );
        }
      }
    });

    test('the picker copy exists in both catalogs', () {
      final en = arb('en');
      final fr = arb('fr');
      const keys = <String>[
        'freightCategoryQuestion',
        'freightCategoryHelp',
      ];
      for (final key in keys) {
        expect(en[key], isNotNull, reason: 'app_en.arb is missing $key');
        expect(fr[key], isNotNull, reason: 'app_fr.arb is missing $key');
      }
    });

    test('the catalogs stay key for key identical', () {
      // Every key, metadata included: a missing message is a French customer
      // reading English, and a missing "@key" is a placeholder that silently
      // stops being typed on one side of the catalog.
      Set<String> messages(String locale) => arb(locale).keys.toSet();
      final en = messages('en');
      final fr = messages('fr');
      expect(en.difference(fr), isEmpty, reason: 'app_fr.arb is behind');
      expect(fr.difference(en), isEmpty, reason: 'app_en.arb is behind');
    });
  });

  test('the booking screen sends the chosen category to the callable', () {
    final screen = File(
      'lib/screens/send_freight_screen.dart',
    ).readAsStringSync();
    final service = File(
      'lib/services/freight_shipment_service.dart',
    ).readAsStringSync();
    expect(screen, contains('itemCategoryId: _categoryId'));
    expect(service, contains("'itemCategoryId'"));
    // The category names the row the business priced and pays back by; it
    // moves no price of its own, so the estimate line quotes the
    // destination's own rate and nothing on top of it.
    expect(screen, isNot(contains('_effectiveRatePerKg')));
    expect(
      screen,
      contains("'\\\$\${_ratePerKg.toStringAsFixed(2)}'"),
    );
  });
}
