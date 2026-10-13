import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/inventory.dart';
import 'package:my_flutter_app/services/inventory_context.dart';
import 'package:my_flutter_app/services/inventory_service.dart';
import 'package:my_flutter_app/services/inventory_stores.dart';
import 'package:my_flutter_app/services/lot_ledger.dart' show LotStaff;

/// Brands and quick entry (inventory v3), the pure half: how a branded product
/// reads, the form's payloads (and that a brandless request is exactly the v2
/// one), the brand filter and search, the new answers and refusals, the three
/// brand callables and the watcher that reads the list.

InventoryItem _item(
  String id, {
  String name = 'Item',
  String brand = '',
  String brandId = '',
  String category = '',
  String categoryId = '',
  int quantity = 10,
  bool archived = false,
}) => InventoryItem(
  id: id,
  businessId: 'b1',
  name: name,
  code: 'IT-K7M4P2',
  priceCents: 450,
  quantity: quantity,
  brand: brand,
  brandId: brandId,
  category: category,
  categoryId: categoryId,
  archived: archived,
);

void main() {
  group('a product reads brand first', () {
    test('"Jordan 11" with a brand, the name alone without', () {
      expect(_item('i1', name: '11', brand: 'Jordan').displayName, 'Jordan 11');
      expect(_item('i1', name: 'Soap').displayName, 'Soap');
      expect(inventoryDisplayName('  Nike ', ' Air '), 'Nike Air');
      expect(inventoryDisplayName('Nike', ''), 'Nike');
      expect(inventoryDisplayName('', ''), '');
    });

    test('the fields are read from the document; an old one has none', () {
      final item = InventoryItem.fromMap('i1', {
        'businessId': 'b1',
        'name': '11',
        'code': 'it-k7m4p2',
        'priceCents': 9000,
        'brand': 'Jordan',
        'brandId': 'br1',
      });
      expect(item.brand, 'Jordan');
      expect(item.brandId, 'br1');
      expect(item.displayName, 'Jordan 11');
      final old = InventoryItem.fromMap('i2', {
        'businessId': 'b1',
        'name': 'Soap',
        'code': 'IT-K7M4P2',
        'priceCents': 450,
      });
      expect(old.brand, '');
      expect(old.brandId, '');
      expect(old.displayName, 'Soap');
    });

    test('one store\'s view of a product keeps its brand', () {
      final shown = _item(
        'i1',
        name: '11',
        brand: 'Jordan',
        brandId: 'br1',
      ).withQuantity(3);
      expect(shown.quantity, 3);
      expect(shown.brand, 'Jordan');
      expect(shown.brandId, 'br1');
      expect(shown.displayName, 'Jordan 11');
    });

    test('a sale line keeps the brand it was sold under', () {
      final line = InventorySaleLine.fromMap({
        'itemId': 'i1',
        'name': '11',
        'code': 'IT-K7M4P2',
        'quantity': 1,
        'listPriceCents': 9000,
        'soldPriceCents': 8000,
        'brandId': 'br1',
        'brand': 'Jordan',
      });
      expect(line.displayName, 'Jordan 11');
      // A line from before brands reads as the name alone.
      final old = InventorySaleLine.fromMap({
        'itemId': 'i1',
        'name': 'Soap',
        'code': 'IT-K7M4P2',
        'quantity': 1,
        'listPriceCents': 450,
        'soldPriceCents': 450,
      });
      expect(old.brand, '');
      expect(old.displayName, 'Soap');
    });
  });

  group('the brand list', () {
    test('brands are read, clipped, and the archived are not offered', () {
      final brand = InventoryBrand.fromMap('br1', {
        'businessId': 'b1',
        'name': 'x' * 80,
        'archived': false,
      });
      expect(brand.name.length, inventoryMaxBrand);
      final list = [
        const InventoryBrand(id: 'b', name: 'nike'),
        const InventoryBrand(id: 'a', name: 'Adidas'),
        const InventoryBrand(id: 'c', name: 'Old', archived: true),
      ];
      expect(inventoryActiveBrands(list).map((b) => b.id), ['a', 'b']);
      expect(inventoryBrandById(list, 'c')?.name, 'Old');
      expect(inventoryBrandById(list, ''), isNull);
      expect(inventoryBrandById(list, 'zz'), isNull);
    });

    test('names are 1 to 60 characters', () {
      expect(validateInventoryBrandName('  '), ['brand_name_required']);
      expect(validateInventoryBrandName('Jordan'), isEmpty);
      expect(validateInventoryBrandName('x' * 60), isEmpty);
      expect(validateInventoryBrandName('x' * 61), ['brand_too_long']);
    });

    test('the request of each brand callable', () {
      expect(createInventoryBrandRequest('b1', '  Jordan '), {
        'businessId': 'b1',
        'name': 'Jordan',
      });
      expect(renameInventoryBrandRequest('b1', 'br1', ' Nike '), {
        'businessId': 'b1',
        'brandId': 'br1',
        'name': 'Nike',
      });
      expect(archiveInventoryBrandRequest('b1', 'br1', archived: true), {
        'businessId': 'b1',
        'brandId': 'br1',
        'archived': true,
      });
    });

    test('a server with no brand callable is told from a refusal', () {
      expect(inventoryBrandCallableMissing(code: 'unimplemented'), isTrue);
      expect(inventoryBrandCallableMissing(code: 'not-found'), isTrue);
      expect(
        inventoryBrandCallableMissing(
          code: 'not-found',
          details: {'reason': 'brand_not_found'},
        ),
        isFalse,
      );
      expect(inventoryBrandCallableMissing(code: 'permission-denied'), isFalse);
    });
  });

  group('the product form sends the brand', () {
    const filled = InventoryItemDraft(name: '11', price: '90', quantity: '4');

    test('no brand, no brand fields: exactly the v2 request', () {
      final request = createInventoryItemRequest('b1', filled);
      expect(request.containsKey('brandId'), isFalse);
      expect(request.containsKey('brand'), isFalse);
      expect(request, {
        'businessId': 'b1',
        'name': '11',
        'priceCents': 9000,
        'quantity': 4,
      });
    });

    test('a brand from the list goes by id, a typed one by name', () {
      final byId = createInventoryItemRequest(
        'b1',
        const InventoryItemDraft(
          name: '11',
          price: '90',
          quantity: '4',
          brand: 'Jordan',
          brandId: 'br1',
        ),
      );
      expect(byId['brandId'], 'br1');
      expect(byId.containsKey('brand'), isFalse);
      final typed = createInventoryItemRequest(
        'b1',
        const InventoryItemDraft(
          name: '11',
          price: '90',
          quantity: '4',
          brand: ' Jordan ',
        ),
      );
      expect(typed['brand'], 'Jordan');
      expect(typed.containsKey('brandId'), isFalse);
    });

    test('an edit sends the brand only when it changed', () {
      final existing = _item('i1', name: '11', brand: 'Jordan', brandId: 'br1');
      final same = updateInventoryItemRequest(
        'b1',
        existing,
        InventoryItemDraft.fromItem(existing),
      );
      expect(same.containsKey('brandId'), isFalse);
      expect(same.containsKey('brand'), isFalse);
      expect(inventoryUpdateIsEmpty(same), isTrue);

      final other = updateInventoryItemRequest(
        'b1',
        existing,
        const InventoryItemDraft(
          name: '11',
          price: '4.50',
          quantity: '10',
          brand: 'Nike',
          brandId: 'br2',
        ),
      );
      expect(other['brandId'], 'br2');
      expect(other.containsKey('brand'), isFalse);

      final typed = updateInventoryItemRequest(
        'b1',
        _item('i1', name: '11'),
        const InventoryItemDraft(
          name: '11',
          price: '4.50',
          quantity: '10',
          brand: 'Puma',
        ),
      );
      expect(typed['brand'], 'Puma');
      expect(typed.containsKey('brandId'), isFalse);
    });

    test('clearing the brand sends both fields empty; nothing to clear sends '
        'nothing', () {
      final existing = _item('i1', name: '11', brand: 'Jordan', brandId: 'br1');
      final cleared = updateInventoryItemRequest(
        'b1',
        existing,
        const InventoryItemDraft(name: '11', price: '4.50', quantity: '10'),
      );
      expect(cleared['brand'], '');
      expect(cleared['brandId'], '');
      final nothing = updateInventoryItemRequest(
        'b1',
        _item('i2', name: 'Soap'),
        const InventoryItemDraft(name: 'Soap', price: '4.50', quantity: '10'),
      );
      expect(nothing.containsKey('brand'), isFalse);
      expect(nothing.containsKey('brandId'), isFalse);
    });

    test('quick entry keeps only the brand and the category', () {
      const full = InventoryItemDraft(
        name: '11',
        price: '90',
        cost: '60',
        quantity: '4',
        lowStockAt: '2',
        category: 'Shoes',
        categoryId: 'c1',
        brand: 'Jordan',
        brandId: 'br1',
        photoUrl: 'https://example.com/a.jpg',
        stock: {'s1': '3'},
      );
      final next = full.keepingBrandAndCategory();
      expect(next.brand, 'Jordan');
      expect(next.brandId, 'br1');
      expect(next.category, 'Shoes');
      expect(next.categoryId, 'c1');
      expect(next.name, '');
      expect(next.price, '');
      expect(next.cost, '');
      expect(next.quantity, '');
      expect(next.lowStockAt, '');
      expect(next.photoUrl, '');
      expect(next.stock, isEmpty);
    });
  });

  group('the list: brand filter and search', () {
    final items = [
      _item('i1', name: '11', brand: 'Jordan', brandId: 'br1'),
      _item('i2', name: 'Air Max', brand: 'Nike', brandId: 'br2'),
      _item('i3', name: 'Soap'),
      _item(
        'i4',
        name: 'Slides',
        brand: 'Nike',
        brandId: 'br2',
        archived: true,
      ),
    ];

    List<String> ids(
      String brandId, {
      String query = '',
      bool archived = false,
    }) => [
      for (final i in inventoryListing(
        items,
        brandId: brandId,
        query: query,
        showArchived: archived,
      ))
        i.id,
    ];

    test('all brands, no brand, one brand', () {
      expect(ids(''), unorderedEquals(['i1', 'i2', 'i3']));
      expect(ids(inventoryNoBrandFilter), ['i3']);
      expect(ids('br1'), ['i1']);
      expect(ids('br2'), ['i2']);
      expect(ids('br2', archived: true), ['i4']);
    });

    test('search finds the brand, the name, or both as the shelf says it', () {
      expect(ids('', query: 'jordan'), ['i1']);
      expect(ids('', query: 'Jordan 11'), ['i1']);
      expect(ids('', query: 'air max'), ['i2']);
      expect(ids('', query: 'nike air'), ['i2']);
      expect(ids('', query: 'nike'), ['i2']);
      expect(ids('', query: 'soap'), ['i3']);
    });

    test('the list is ordered by what it reads, brand first', () {
      final ordered = inventoryListing([
        _item('a', name: 'Zed'),
        _item('b', name: '11', brand: 'Jordan', brandId: 'br1'),
        _item('c', name: 'Air', brand: 'Adidas', brandId: 'br3'),
      ]);
      expect(ordered.map((i) => i.displayName), [
        'Adidas Air',
        'Jordan 11',
        'Zed',
      ]);
    });

    test('the tag-will-not-scan search finds by brand too', () {
      expect(inventorySellSearch(items, 'jor').map((i) => i.id), ['i1']);
    });
  });

  group('the answers and refusals', () {
    test('a summary carries the brand block, biggest money first', () {
      final summary = InventorySummary.fromCallable({
        'salesCount': 3,
        'byBrand': [
          {
            'brandId': 'br1',
            'name': 'Jordan',
            'itemsSold': 1,
            'revenueCents': 500,
            'profitCents': 100,
          },
          {
            'brandId': '',
            'name': 'No brand',
            'itemsSold': 2,
            'revenueCents': 900,
            'profitCents': 0,
          },
        ],
      });
      expect(summary.byBrand.map((b) => b.brandId), ['', 'br1']);
      expect(summary.byBrand.last.name, 'Jordan');
      expect(summary.byBrand.last.itemsSold, 1);
      expect(summary.byBrand.last.profitCents, 100);
    });

    test('a v2 summary has no brand block and nothing breaks', () {
      final summary = InventorySummary.fromCallable({
        'salesCount': 1,
        'byCategory': [
          {'categoryId': 'c1', 'name': 'Body', 'revenueCents': 100},
        ],
      });
      expect(summary.byBrand, isEmpty);
      expect(summary.byCategory, hasLength(1));
    });

    test('each brand refusal maps to its own failure', () {
      InventoryFailure failure(
        String reason, {
        String code = 'invalid-argument',
      }) => inventoryFailureOf(code: code, details: {'reason': reason});
      expect(
        failure('brand_name_required'),
        InventoryFailure.brandNameRequired,
      );
      expect(
        failure('brand_name_taken', code: 'already-exists'),
        InventoryFailure.brandNameTaken,
      );
      expect(
        failure('brand_not_found', code: 'not-found'),
        InventoryFailure.brandNotFound,
      );
      expect(failure('brand_too_long'), InventoryFailure.brandTooLong);
      // Several codes in one refusal: any of ours names it.
      expect(
        inventoryFailureOf(
          code: 'invalid-argument',
          details: {
            'reason': 'name_invalid',
            'reasons': ['name_invalid', 'brand_too_long'],
          },
        ),
        InventoryFailure.brandTooLong,
      );
      expect(
        inventoryFailureIsRetryable(InventoryFailure.brandNameTaken),
        isFalse,
      );
    });
  });

  group('the callables and the watcher', () {
    test('create, rename and archive call the contract names', () async {
      final log = <({String name, Map<String, Object?> payload})>[];
      final service = InventoryService(
        caller: (name, payload) async {
          log.add((name: name, payload: payload));
          return {'brandId': 'br9'};
        },
      );
      expect(await service.createBrand('b1', ' Jordan '), 'br9');
      await service.renameBrand('b1', 'br9', 'Nike');
      await service.setBrandArchived('b1', 'br9', archived: true);
      expect(log.map((c) => c.name), [
        'createInventoryBrand',
        'renameInventoryBrand',
        'archiveInventoryBrand',
      ]);
      expect(log[0].payload, {'businessId': 'b1', 'name': 'Jordan'});
      expect(log[1].payload, {
        'businessId': 'b1',
        'brandId': 'br9',
        'name': 'Nike',
      });
      expect(log[2].payload, {
        'businessId': 'b1',
        'brandId': 'br9',
        'archived': true,
      });
    });

    test('the brands read is business-scoped', () {
      final spec = inventoryBrandsSpec('b1');
      expect(spec.collection, 'inventoryBrands');
      expect(spec.filters, hasLength(1));
    });

    test('the watcher holds the brands beside the categories', () async {
      final source = _BrandSource(const [
        InventoryBrand(id: 'br1', name: 'Jordan'),
      ]);
      var changes = 0;
      final watcher = InventoryContextWatcher(
        source: source,
        businessId: 'b1',
        onChange: () => changes++,
      )..start();
      await Future<void>.delayed(Duration.zero);
      expect(watcher.brands.single.name, 'Jordan');
      expect(changes, greaterThan(0));
      watcher.dispose();
    });

    test('a brand list that cannot be read leaves it empty', () async {
      final watcher = InventoryContextWatcher(
        source: _BrandSource(const [], fail: true),
        businessId: 'b1',
        onChange: () {},
      )..start();
      await Future<void>.delayed(Duration.zero);
      expect(watcher.brands, isEmpty);
      watcher.dispose();
    });

    test('a screen that does not need brands does not read them', () async {
      final source = _BrandSource(const [
        InventoryBrand(id: 'br1', name: 'Jordan'),
      ]);
      final watcher = InventoryContextWatcher(
        source: source,
        businessId: 'b1',
        watchBrands: false,
        onChange: () {},
      )..start();
      await Future<void>.delayed(Duration.zero);
      expect(source.brandReads, 0);
      watcher.dispose();
    });
  });
}

class _BrandSource implements InventorySource {
  _BrandSource(this.brands, {this.fail = false});

  final List<InventoryBrand> brands;
  final bool fail;
  int brandReads = 0;

  @override
  Stream<List<InventoryBrand>> watchBrands(String businessId) {
    brandReads++;
    return fail ? Stream.error(StateError('denied')) : Stream.value(brands);
  }

  @override
  Stream<List<InventoryStore>> watchStores(String businessId) =>
      Stream.value(const []);

  @override
  Stream<List<InventoryCategory>> watchCategories(String businessId) =>
      Stream.value(const []);

  @override
  Stream<List<InventoryStockRow>> watchStock(
    String businessId, {
    String storeId = '',
  }) => Stream.value(const []);

  @override
  Stream<List<InventoryItem>> watchItems(String businessId) =>
      Stream.value(const []);

  @override
  Future<InventoryItem?> findItemByCode(String businessId, String code) async =>
      null;

  @override
  Stream<List<InventorySale>> watchSales(
    String businessId, {
    required int limit,
    String storeId = '',
  }) => Stream.value(const []);

  @override
  Stream<InventorySale?> watchSale(String businessId, String saleId) =>
      Stream.value(null);

  @override
  Stream<List<InventoryMovement>> watchMovements(
    String businessId,
    String itemId, {
    String storeId = '',
  }) => Stream.value(const []);

  @override
  Stream<List<LotStaff>> watchStaff(String businessId) =>
      Stream.value(const []);
}
