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

  test('the fee comes from the business payback, never a claim', () {
    expect(coverageFeeCentsFor(400, 2), 800);
    expect(coverageFeeCentsFor(0, 2), 0);
    expect(coverageFeeCentsFor(400, 0), 0);
  });
}
