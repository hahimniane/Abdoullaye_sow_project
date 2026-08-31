import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/utils/freight_contents.dart';

const _table = {
  'electronics': {
    'items': [
      {
        'id': 'iphone',
        'label': 'iPhone',
        'pricingMode': 'flat',
        'flatPrice': 25,
        'includedKg': 1,
      },
      {
        'id': 'laptop',
        'label': 'Laptop',
        'pricingMode': 'flat',
        'flatPrice': 40,
        'includedKg': 2,
      },
      {'id': 'tv', 'label': 'Television', 'pricingMode': 'per_kg'},
    ],
  },
};

const _mixedBox = FreightContents(
  items: [
    ContentsItem(
      categoryId: 'electronics',
      itemId: 'iphone',
      label: 'iPhone',
      quantity: 2,
    ),
    ContentsItem(categoryId: 'electronics', itemId: 'laptop', label: 'Laptop'),
  ],
  otherGoodsKg: 4,
  otherCategoryId: 'clothing',
  totalWeightKg: 6,
);

void main() {
  group('a declared box travels under the keys the server reads', () {
    test('the payload mirrors functions/freight_contents.js', () {
      final payload = _mixedBox.payloadFields();
      expect((payload['contentsItems'] as List).length, 2);
      expect(payload['otherGoodsKg'], 4);
      expect(payload['otherCategoryId'], 'clothing');
      expect(payload['totalWeightKg'], 6);
    });

    test('nothing declared means nothing sent - prose requests unchanged', () {
      expect(const FreightContents().payloadFields(), isEmpty);
      expect(const FreightContents().declared, isFalse);
    });
  });

  group('junk is named beside the row, before any round trip', () {
    test('each broken field maps to its own code', () {
      expect(
        contentsProblem(
          const FreightContents(
            items: [ContentsItem(categoryId: 'weapons', label: 'x')],
          ),
        ),
        'category_invalid',
      );
      expect(
        contentsProblem(
          const FreightContents(
            items: [ContentsItem(categoryId: 'electronics', label: '')],
          ),
        ),
        'label_invalid',
      );
      expect(
        contentsProblem(
          const FreightContents(
            items: [
              ContentsItem(
                categoryId: 'electronics',
                label: 'iPhone',
                quantity: 0,
              ),
            ],
          ),
        ),
        'quantity_invalid',
      );
      expect(contentsProblem(_mixedBox), isNull);
    });
  });

  group('the box prices as the sum of its lines', () {
    test('flat items sum, the bucket rides the rate - same as the server', () {
      final priced = priceContentsForBusiness(
        table: _table,
        ratePerKgCents: 400,
        contents: _mixedBox,
      );
      expect(priced.ok, isTrue);
      expect(priced.flatCents, 2 * 2500 + 4000);
      expect(priced.includedKg, 4);
      expect(priced.weighedCents, 1600);
      expect(priced.estimateCents, 10600);
    });

    test('an item this business weighs is routed to the kilos', () {
      final priced = priceContentsForBusiness(
        table: _table,
        ratePerKgCents: 400,
        contents: const FreightContents(
          items: [
            ContentsItem(
              categoryId: 'electronics',
              itemId: 'tv',
              label: 'Television',
            ),
          ],
        ),
      );
      expect(priced.ok, isFalse);
      expect(priced.error, 'contents_item_weighed');
      expect(priced.itemLabel, 'Television');
    });

    test('an unpriced item is a request, not a guess', () {
      final priced = priceContentsForBusiness(
        table: _table,
        ratePerKgCents: 400,
        contents: const FreightContents(
          items: [
            ContentsItem(
              categoryId: 'fragile',
              itemId: 'dishes',
              label: 'Dishes',
            ),
          ],
        ),
      );
      expect(priced.ok, isFalse);
      expect(priced.error, 'contents_item_unpriced');
    });
  });

  group('one line says what is in the box', () {
    test('summary joins items and kilos', () {
      expect(_mixedBox.summary(), '2 × iPhone, 1 × Laptop, 4.0 kg');
    });
  });
}
