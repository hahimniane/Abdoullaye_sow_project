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
}
