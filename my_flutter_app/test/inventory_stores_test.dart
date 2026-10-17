import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/inventory.dart';
import 'package:my_flutter_app/services/inventory_context.dart';
import 'package:my_flutter_app/services/inventory_service.dart';
import 'package:my_flutter_app/services/inventory_stores.dart';
import 'package:my_flutter_app/services/lot_ledger.dart' show LotStaff;

/// Categories and stores (inventory v2), the pure half: when a business is
/// single-store, who sees which store, how a count reads, where a sale goes,
/// the payload of every new callable (and that a v1-shaped request is
/// unchanged), how each new refusal reads, and the new fields of the answers.

const _main = InventoryStore(id: 's-main', name: 'Main store', isMain: true);
const _brooklyn = InventoryStore(id: 's-bk', name: 'Brooklyn');
const _old = InventoryStore(id: 's-old', name: 'Old store', archived: true);

InventoryItem _item(
  String id, {
  int quantity = 10,
  int? lowStockAt,
  bool countWasOff = false,
  String category = '',
  String categoryId = '',
}) => InventoryItem(
  id: id,
  businessId: 'b1',
  name: 'Item $id',
  code: 'IT-K7M4P2',
  priceCents: 450,
  quantity: quantity,
  lowStockAt: lowStockAt,
  countWasOff: countWasOff,
  category: category,
  categoryId: categoryId,
);

InventoryStockRow _row(
  String itemId,
  String storeId,
  int quantity, {
  bool off = false,
}) => InventoryStockRow(
  itemId: itemId,
  storeId: storeId,
  quantity: quantity,
  countWasOff: off,
);

InventoryStoreContext _ctx(
  List<InventoryStore> stores, {
  InventoryAccess access = const InventoryAccess.owner(),
}) => InventoryStoreContext(stores: stores, access: access);

const _staffAtBrooklyn = InventoryAccess(homeStoreId: 's-bk');

void main() {
  group('store mode', () {
    test('zero or one active store is single-store; two or more is multi', () {
      expect(_ctx(const []).multi, isFalse);
      expect(_ctx(const [_main]).multi, isFalse);
      // An archived store does not count.
      expect(_ctx(const [_main, _old]).multi, isFalse);
      expect(_ctx(const [_main, _brooklyn]).multi, isTrue);
      expect(_ctx(const [_main, _brooklyn, _old]).active, hasLength(2));
      // Active stores read by name.
      expect(_ctx(const [_main, _brooklyn]).active.map((s) => s.name), [
        'Brooklyn',
        'Main store',
      ]);
    });

    test('a single-store business shows nothing about stores to anyone', () {
      for (final access in const [
        InventoryAccess.owner(),
        InventoryAccess(allStores: true),
        InventoryAccess(homeStoreId: 's-main'),
        InventoryAccess(),
      ]) {
        final ctx = _ctx(const [_main], access: access);
        expect(ctx.viewerSeesAll, isFalse);
        expect(ctx.homeStoreMissing, isFalse);
        expect(ctx.ownStoreId, '');
        expect(inventoryNeedsStock(ctx), isFalse);
        expect(inventorySellStore(ctx).mode, InventorySellStoreMode.single);
      }
    });

    test('who sees which store in a multi-store business', () {
      const stores = [_main, _brooklyn];
      final owner = _ctx(stores);
      expect(owner.viewerSeesAll, isTrue);
      expect(owner.ownStoreId, '');
      expect(owner.access.canManageStores, isTrue);
      expect(owner.access.canTransfer, isTrue);

      final all = _ctx(stores, access: const InventoryAccess(allStores: true));
      expect(all.viewerSeesAll, isTrue);
      expect(all.access.canManageStores, isFalse);
      expect(all.access.canTransfer, isTrue);

      final staff = _ctx(stores, access: _staffAtBrooklyn);
      expect(staff.viewerSeesAll, isFalse);
      expect(staff.ownStoreId, 's-bk');
      expect(staff.homeStoreMissing, isFalse);
      expect(staff.access.canTransfer, isFalse);
      expect(staff.storeName('s-bk'), 'Brooklyn');
      expect(staff.storeName('s-old'), '');

      final lost = _ctx(stores);
      expect(lost.storeName('nope'), '');
    });

    test('staff with no store, or one that was archived, have no home', () {
      const stores = [_main, _brooklyn, _old];
      expect(
        _ctx(stores, access: const InventoryAccess()).homeStoreMissing,
        isTrue,
      );
      expect(
        _ctx(
          stores,
          access: const InventoryAccess(homeStoreId: 's-old'),
        ).homeStoreMissing,
        isTrue,
      );
      expect(
        _ctx(
          stores,
          access: const InventoryAccess(homeStoreId: 'gone'),
        ).homeStoreMissing,
        isTrue,
      );
      expect(
        inventoryNeedsStock(_ctx(stores, access: const InventoryAccess())),
        isFalse,
      );
    });
  });

  group('where a sale goes', () {
    const stores = [_main, _brooklyn];

    test('staff with a home store sell from it without being asked', () {
      final sell = inventorySellStore(_ctx(stores, access: _staffAtBrooklyn));
      expect(sell.mode, InventorySellStoreMode.home);
      expect(sell.defaultStoreId, 's-bk');
      expect(sell.canSell, isTrue);
      // The server routes it: nothing is sent.
      expect(inventoryRequestStoreId(sell, ''), '');
      expect(inventoryRequestStoreId(sell, 's-main'), '');
    });

    test(
      'the owner and all-stores staff pick; the home store is the default',
      () {
        final owner = inventorySellStore(_ctx(stores));
        expect(owner.mode, InventorySellStoreMode.pick);
        // No home store: the first store by name.
        expect(owner.defaultStoreId, 's-bk');
        expect(inventoryRequestStoreId(owner, ''), 's-bk');
        expect(inventoryRequestStoreId(owner, 's-main'), 's-main');

        final all = inventorySellStore(
          _ctx(
            stores,
            access: const InventoryAccess(
              allStores: true,
              homeStoreId: 's-main',
            ),
          ),
        );
        expect(all.mode, InventorySellStoreMode.pick);
        expect(all.defaultStoreId, 's-main');
        expect(inventoryRequestStoreId(all, ''), 's-main');
      },
    );

    test('an archived home store falls back to the first store', () {
      final sell = inventorySellStore(
        _ctx(
          const [_main, _brooklyn, _old],
          access: const InventoryAccess(allStores: true, homeStoreId: 's-old'),
        ),
      );
      expect(sell.defaultStoreId, 's-bk');
    });

    test('staff with no home store cannot sell', () {
      final sell = inventorySellStore(
        _ctx(stores, access: const InventoryAccess()),
      );
      expect(sell.mode, InventorySellStoreMode.missing);
      expect(sell.canSell, isFalse);
      expect(inventoryRequestStoreId(sell, 's-main'), '');
    });

    test('a single-store business sends no store at all', () {
      final sell = inventorySellStore(_ctx(const [_main]));
      expect(sell.mode, InventorySellStoreMode.single);
      expect(inventoryRequestStoreId(sell, 'anything'), '');
    });
  });

  group('counts per store', () {
    const stores = [_main, _brooklyn];
    final stock = InventoryStockIndex([
      _row('i1', 's-main', 8),
      _row('i1', 's-bk', 2),
      _row('i2', 's-main', 5),
      _row('i3', 's-bk', 0),
      _row('i4', 's-bk', 4, off: true),
    ]);

    test('single-store reads the product exactly as before', () {
      final view = inventoryStockView(
        _item('i1', quantity: 7, lowStockAt: 3),
        _ctx(const [_main]),
        stock,
      );
      expect(view.quantity, 7);
      expect(view.status, InventoryStock.ok);
      expect(view.perStore, isEmpty);
      expect(view.lowStoreIds, isEmpty);
      final low = inventoryStockView(
        _item('i1', quantity: 3, lowStockAt: 3),
        _ctx(const [_main]),
        stock,
      );
      expect(low.status, InventoryStock.low);
    });

    test('a product not yet counted per store sits whole at the Main store', () {
      // No stock rows at all: the server has not materialised this product.
      final none = InventoryStockIndex();
      final item = _item('i9', quantity: 48, countWasOff: true);
      final atMain = inventoryStockView(
        item,
        _ctx(stores, access: const InventoryAccess(homeStoreId: 's-main')),
        none,
      );
      expect(atMain.quantity, 48);
      expect(atMain.status, InventoryStock.ok);
      expect(atMain.countWasOff, isTrue);
      final atBrooklyn = inventoryStockView(
        item,
        _ctx(stores, access: _staffAtBrooklyn),
        none,
      );
      expect(atBrooklyn.quantity, 0);
      final all = inventoryStockView(item, _ctx(stores), none);
      // Active stores are listed by name: Brooklyn, then Main store.
      expect(all.perStore.map((s) => s.quantity), [0, 48]);
      // Once counted per store, a missing Main row really is 0.
      final counted = InventoryItem(
        id: 'i9',
        businessId: 'b1',
        name: 'x',
        code: 'IT-K7M4P2',
        priceCents: 1,
        quantity: 48,
        storeStock: true,
      );
      expect(
        inventoryStockView(
          counted,
          _ctx(stores, access: const InventoryAccess(homeStoreId: 's-main')),
          none,
        ).quantity,
        0,
      );
      // A business whose stores carry no Main flag falls back to 0, as before.
      const unflagged = InventoryStore(id: 's-main', name: 'Main store');
      expect(
        inventoryStockView(
          item,
          _ctx(const [
            unflagged,
            _brooklyn,
          ], access: const InventoryAccess(homeStoreId: 's-main')),
          none,
        ).quantity,
        0,
      );
    });

    test(
      'staff see only their store, and a store the product is not in is 0',
      () {
        final ctx = _ctx(stores, access: _staffAtBrooklyn);
        final at = inventoryStockView(_item('i1', quantity: 10), ctx, stock);
        expect(at.quantity, 2);
        expect(at.perStore, isEmpty);
        final none = inventoryStockView(_item('i2', quantity: 5), ctx, stock);
        expect(none.quantity, 0);
        expect(none.status, InventoryStock.out);
        // The store's own flag, not the product's.
        final off = inventoryStockView(
          _item('i4', quantity: 4, countWasOff: false),
          ctx,
          stock,
        );
        expect(off.countWasOff, isTrue);
      },
    );

    test('low is checked per store with one lowStockAt', () {
      final ctx = _ctx(stores, access: _staffAtBrooklyn);
      // 2 in Brooklyn is low at "3 or below", though 10 in total is fine.
      final low = inventoryStockView(
        _item('i1', quantity: 10, lowStockAt: 3),
        ctx,
        stock,
      );
      expect(low.status, InventoryStock.low);
      final fine = inventoryStockView(
        _item('i1', quantity: 10, lowStockAt: 1),
        ctx,
        stock,
      );
      expect(fine.status, InventoryStock.ok);
      // Zero is always out for that store.
      expect(
        inventoryStockView(_item('i3'), ctx, stock).status,
        InventoryStock.out,
      );
    });

    test('all-store viewers get the total, each store and where it is low', () {
      final ctx = _ctx(stores);
      final view = inventoryStockView(
        _item('i1', quantity: 10, lowStockAt: 3),
        ctx,
        stock,
      );
      expect(view.quantity, 10);
      expect(view.perStore.map((r) => (r.storeId, r.quantity)), [
        ('s-bk', 2),
        ('s-main', 8),
      ]);
      expect(view.lowStoreIds, ['s-bk']);
      // Fine in total, low in a store: low.
      expect(view.status, InventoryStock.low);
      // A store with no row never held the product: not flagged.
      final i2 = inventoryStockView(
        _item('i2', quantity: 5, lowStockAt: 1),
        ctx,
        stock,
      );
      expect(i2.lowStoreIds, isEmpty);
      expect(i2.status, InventoryStock.ok);
      expect(i2.perStore.last.quantity, 5);
      // A row at zero is out in that store.
      final i3 = inventoryStockView(_item('i3', quantity: 0), ctx, stock);
      expect(i3.lowStoreIds, ['s-bk']);
    });

    test('a store filter narrows an all-store viewer to that store', () {
      final ctx = _ctx(stores);
      final view = inventoryStockView(
        _item('i1', quantity: 10, lowStockAt: 3),
        ctx,
        stock,
        storeFilter: 's-main',
      );
      expect(view.quantity, 8);
      expect(view.status, InventoryStock.ok);
      expect(view.perStore, isEmpty);
      // A filter naming nothing active is ignored.
      expect(
        inventoryStockView(
          _item('i1', quantity: 10),
          ctx,
          stock,
          storeFilter: 'nope',
        ).quantity,
        10,
      );
      // Staff cannot widen themselves with a filter.
      final staff = _ctx(stores, access: _staffAtBrooklyn);
      expect(
        inventoryStockView(
          _item('i1', quantity: 10),
          staff,
          stock,
          storeFilter: 's-main',
        ).quantity,
        2,
      );
    });

    test('staff with no store see nothing', () {
      final view = inventoryStockView(
        _item('i1'),
        _ctx(stores, access: const InventoryAccess()),
        stock,
      );
      expect(view.quantity, 0);
      expect(view.status, InventoryStock.out);
    });

    test(
      'the lists and the sale read the store count in place of the total',
      () {
        final items = [_item('i1', quantity: 10), _item('i2', quantity: 5)];
        // Single-store, and all-stores unfiltered: the same items.
        expect(
          inventoryViewItems(
            items,
            _ctx(const [_main]),
            stock,
          ).map((i) => i.quantity),
          [10, 5],
        );
        expect(
          inventoryViewItems(items, _ctx(stores), stock).map((i) => i.quantity),
          [10, 5],
        );
        expect(
          inventoryViewItems(
            items,
            _ctx(stores),
            stock,
            storeFilter: 's-bk',
          ).map((i) => i.quantity),
          [2, 0],
        );
        expect(
          inventoryViewItems(
            items,
            _ctx(stores, access: _staffAtBrooklyn),
            stock,
          ).map((i) => i.quantity),
          [2, 0],
        );
        expect(
          inventoryViewItems(
            items,
            _ctx(stores, access: const InventoryAccess()),
            stock,
          ).map((i) => i.quantity),
          [0, 0],
        );
      },
    );

    test('the stock index answers by product and store', () {
      expect(stock.at('i1', 's-bk'), 2);
      expect(stock.at('i1', 'nope'), 0);
      expect(stock.row('i4', 's-bk')!.countWasOff, isTrue);
      expect(InventoryStockIndex.empty.isEmpty, isTrue);
      expect(
        InventoryStockRow.fromMap({
          'itemId': 'a',
          'storeId': 'b',
          'quantity': -3,
        }).quantity,
        0,
      );
    });
  });

  group('sales of a store', () {
    InventorySale sale(String id, String storeId) => InventorySale(
      id: id,
      businessId: 'b1',
      lines: const [],
      totalCents: 100,
      paymentMethod: 'cash',
      soldByStaffId: 'u',
      storeId: storeId,
    );

    test('a filter keeps that store and sales from before stores existed', () {
      final sales = [sale('a', 's-main'), sale('b', 's-bk'), sale('c', '')];
      expect(inventorySalesForStore(sales, '').map((s) => s.id), [
        'a',
        'b',
        'c',
      ]);
      expect(inventorySalesForStore(sales, 's-bk').map((s) => s.id), [
        'b',
        'c',
      ]);
    });

    test('a sale opened by id reaches exactly as far as the list does', () {
      const stores = [_main, _brooklyn];
      bool visible(InventorySale s, InventoryStoreContext ctx) =>
          inventorySaleVisible(s, businessId: 'b1', context: ctx);
      final main = sale('a', 's-main');
      final bk = sale('b', 's-bk');
      final old = sale('c', '');
      // The owner and all-stores staff: every sale of the business.
      for (final access in const [
        InventoryAccess.owner(),
        InventoryAccess(allStores: true),
      ]) {
        final ctx = _ctx(stores, access: access);
        expect([main, bk, old].every((s) => visible(s, ctx)), isTrue);
      }
      // Staff tied to Brooklyn: Brooklyn's only (the list's storeId filter).
      final staff = _ctx(stores, access: _staffAtBrooklyn);
      expect(visible(bk, staff), isTrue);
      expect(visible(main, staff), isFalse);
      expect(visible(old, staff), isFalse);
      // Staff with no store yet: nothing.
      final none = _ctx(stores, access: const InventoryAccess());
      expect([main, bk, old].any((s) => visible(s, none)), isFalse);
      // A single-store business: every sale, whatever the home store says.
      final single = _ctx(const [_main], access: _staffAtBrooklyn);
      expect([main, bk, old].every((s) => visible(s, single)), isTrue);
      // Never another business's sale, nor any sale without a business.
      final foreign = InventorySale(
        id: 'x',
        businessId: 'other',
        lines: const [],
        totalCents: 1,
        paymentMethod: 'cash',
        soldByStaffId: 'u',
      );
      expect(visible(foreign, _ctx(stores)), isFalse);
      expect(
        inventorySaleVisible(main, businessId: '', context: _ctx(stores)),
        isFalse,
      );
    });
  });

  group('categories', () {
    const cats = [
      InventoryCategory(id: 'c1', name: 'Body'),
      InventoryCategory(id: 'c2', name: 'hair'),
      InventoryCategory(id: 'c3', name: 'Old', archived: true),
    ];

    test('only active categories are offered, by name', () {
      expect(inventoryActiveCategories(cats).map((c) => c.id), ['c1', 'c2']);
      expect(inventoryCategoryById(cats, 'c3')!.name, 'Old');
      expect(inventoryCategoryById(cats, ''), isNull);
    });

    test('a product is matched by id, or by the name it was typed with', () {
      expect(
        inventoryCategoryOfItem(cats, _item('a', categoryId: 'c2'))!.id,
        'c2',
      );
      expect(
        inventoryCategoryOfItem(cats, _item('a', category: 'BODY'))!.id,
        'c1',
      );
      expect(
        inventoryCategoryOfItem(cats, _item('a', category: 'Shoes')),
        isNull,
      );
      // With an id the name is a snapshot, not a second way in.
      expect(
        inventoryCategoryOfItem(
          cats,
          _item('a', categoryId: 'gone', category: 'Body'),
        ),
        isNull,
      );
    });

    test('the list filters by category, legacy names included', () {
      final items = [
        _item('a', categoryId: 'c1', category: 'Body'),
        _item('b', category: 'body'),
        _item('c', categoryId: 'c2', category: 'hair'),
        _item('d'),
      ];
      List<String> ids(String id, String name) => inventoryListing(
        items,
        categoryId: id,
        categoryName: name,
      ).map((i) => i.id).toList()..sort();
      expect(ids('', ''), ['a', 'b', 'c', 'd']);
      expect(ids('c1', 'Body'), ['a', 'b']);
      expect(ids('c2', 'hair'), ['c']);
    });

    test('names are checked before the round trip', () {
      expect(validateInventoryCategoryName('Body'), isEmpty);
      expect(validateInventoryCategoryName('  '), ['category_name_required']);
      expect(validateInventoryCategoryName('x' * 61), [
        'category_name_too_long',
      ]);
    });

    test(
      'an older server with no such callable is told apart from a refusal',
      () {
        expect(inventoryCategoryCallableMissing(code: 'unimplemented'), isTrue);
        expect(inventoryCategoryCallableMissing(code: 'not-found'), isTrue);
        expect(
          inventoryCategoryCallableMissing(
            code: 'not-found',
            details: {'reason': 'business_not_found'},
          ),
          isFalse,
        );
        expect(inventoryCategoryCallableMissing(code: 'unavailable'), isFalse);
      },
    );
  });

  group('request payloads', () {
    test('a v1-shaped product create is unchanged', () {
      const draft = InventoryItemDraft(
        name: 'Soap',
        price: '4.50',
        quantity: '12',
        category: 'Body',
      );
      expect(createInventoryItemRequest('b1', draft), {
        'businessId': 'b1',
        'name': 'Soap',
        'priceCents': 450,
        'quantity': 12,
        'category': 'Body',
      });
    });

    test('a picked category goes by id; a store count goes as stock', () {
      const draft = InventoryItemDraft(
        name: 'Soap',
        price: '4.50',
        category: 'Body',
        categoryId: 'c1',
        stock: {'s-main': '5', 's-bk': ''},
      );
      final request = createInventoryItemRequest('b1', draft);
      expect(request['categoryId'], 'c1');
      expect(request.containsKey('category'), isFalse);
      expect(request.containsKey('quantity'), isFalse);
      expect(request['stock'], {'s-main': 5, 's-bk': 0});
      expect(validateInventoryItemDraft(draft, creating: true), isEmpty);
      expect(
        validateInventoryItemDraft(
          const InventoryItemDraft(
            name: 'a',
            price: '1',
            stock: {'s-main': '2.5'},
          ),
          creating: true,
        ),
        ['quantity_invalid'],
      );
    });

    test(
      'updating the category: by id when picked, by name when typed or cleared',
      () {
        final existing = _item('i1', category: 'Body', categoryId: 'c1');
        Map<String, Object?> update(InventoryItemDraft d) =>
            updateInventoryItemRequest('b1', existing, d);
        InventoryItemDraft draft({
          String category = 'Body',
          String id = 'c1',
        }) => InventoryItemDraft(
          name: existing.name,
          price: '4.50',
          category: category,
          categoryId: id,
        );
        // Nothing changed: nothing sent.
        expect(inventoryUpdateIsEmpty(update(draft())), isTrue);
        // Another category by id.
        expect(update(draft(category: 'Hair', id: 'c2'))['categoryId'], 'c2');
        expect(
          update(draft(category: 'Hair', id: 'c2')).containsKey('category'),
          isFalse,
        );
        // Cleared: an empty name, the shape a v1 server reads.
        final cleared = update(draft(category: '', id: ''));
        expect(cleared['category'], '');
        expect(cleared.containsKey('categoryId'), isFalse);
        // A product typed before categories: unchanged text sends nothing.
        final legacy = _item('i2', category: 'Body');
        expect(
          inventoryUpdateIsEmpty(
            updateInventoryItemRequest(
              'b1',
              legacy,
              InventoryItemDraft(
                name: legacy.name,
                price: '4.50',
                category: 'Body',
              ),
            ),
          ),
          isTrue,
        );
      },
    );

    test(
      'add stock / set count / sale / summary carry a store only when chosen',
      () {
        Map<String, Object?> adjust({String storeId = ''}) =>
            adjustInventoryStockRequest(
              businessId: 'b1',
              itemId: 'i1',
              add: true,
              quantity: 3,
              storeId: storeId,
            );
        expect(adjust(), {
          'businessId': 'b1',
          'itemId': 'i1',
          'mode': 'add',
          'quantity': 3,
        });
        expect(adjust(storeId: 's-bk')['storeId'], 's-bk');

        final basket = const Basket().addScan(_item('i1'));
        Map<String, Object?> sale({String storeId = ''}) =>
            recordInventorySaleRequest(
              businessId: 'b1',
              clientRequestId: 'req-1',
              paymentMethod: 'cash',
              basket: basket,
              storeId: storeId,
            );
        expect(sale().containsKey('storeId'), isFalse);
        expect(sale(storeId: 's-bk')['storeId'], 's-bk');

        expect(
          inventorySummaryRequest('b1', timeZone: 'UTC').containsKey('storeId'),
          isFalse,
        );
        expect(
          inventorySummaryRequest(
            'b1',
            timeZone: 'UTC',
            storeId: 's-bk',
          )['storeId'],
          's-bk',
        );
      },
    );

    test('one sale attempt keeps its id until the store changes', () {
      var n = 0;
      final attempt = SaleAttempt(newId: () => 'id-${++n}');
      final basket = const Basket().addScan(_item('i1'));
      expect(attempt.idFor(basket, 'cash', storeId: 's-bk'), 'id-1');
      expect(attempt.idFor(basket, 'cash', storeId: 's-bk'), 'id-1');
      expect(attempt.idFor(basket, 'cash', storeId: 's-main'), 'id-2');
      expect(attempt.idFor(basket, 'cash'), 'id-3');
    });

    test('category, store and staff-access payloads', () {
      expect(createInventoryCategoryRequest('b1', '  Body '), {
        'businessId': 'b1',
        'name': 'Body',
      });
      expect(renameInventoryCategoryRequest('b1', 'c1', ' Skin '), {
        'businessId': 'b1',
        'categoryId': 'c1',
        'name': 'Skin',
      });
      expect(archiveInventoryCategoryRequest('b1', 'c1', archived: true), {
        'businessId': 'b1',
        'categoryId': 'c1',
        'archived': true,
      });

      expect(
        createInventoryStoreRequest(
          'b1',
          const InventoryStoreDraft(name: ' Brooklyn '),
        ),
        {'businessId': 'b1', 'name': 'Brooklyn'},
      );
      expect(
        createInventoryStoreRequest(
          'b1',
          const InventoryStoreDraft(
            name: 'Brooklyn',
            address: '1 Main St',
            phone: '555',
          ),
        ),
        {
          'businessId': 'b1',
          'name': 'Brooklyn',
          'address': '1 Main St',
          'phone': '555',
        },
      );
      final existing = const InventoryStore(
        id: 's-bk',
        name: 'Brooklyn',
        address: '1 Main St',
      );
      expect(
        inventoryStoreUpdateIsEmpty(
          updateInventoryStoreRequest(
            'b1',
            existing,
            InventoryStoreDraft.fromStore(existing),
          ),
        ),
        isTrue,
      );
      expect(
        updateInventoryStoreRequest(
          'b1',
          existing,
          const InventoryStoreDraft(name: 'Brooklyn', address: '', phone: '9'),
        ),
        {'businessId': 'b1', 'storeId': 's-bk', 'address': '', 'phone': '9'},
      );
      expect(archiveInventoryStoreRequest('b1', 's-bk', archived: true), {
        'businessId': 'b1',
        'storeId': 's-bk',
        'archived': true,
      });
      expect(
        setInventoryStaffAccessRequest(
          businessId: 'b1',
          userId: 'u1',
          homeStoreId: '',
          allStores: true,
        ),
        {
          'businessId': 'b1',
          'userId': 'u1',
          'homeStoreId': '',
          'allStores': true,
        },
      );
    });

    test('store names are checked', () {
      expect(
        validateInventoryStoreDraft(const InventoryStoreDraft(name: 'A')),
        isEmpty,
      );
      expect(validateInventoryStoreDraft(const InventoryStoreDraft()), [
        'store_name_required',
      ]);
      expect(validateInventoryStoreDraft(InventoryStoreDraft(name: 'x' * 81)), [
        'store_name_too_long',
      ]);
    });

    test('a transfer needs two different stores and a whole number', () {
      List<String> check(InventoryTransferDraft d) =>
          validateInventoryTransfer(d);
      const ok = InventoryTransferDraft(
        fromStoreId: 's-main',
        toStoreId: 's-bk',
        quantity: '3',
      );
      expect(check(ok), isEmpty);
      expect(
        check(
          const InventoryTransferDraft(
            fromStoreId: 's-main',
            toStoreId: 's-main',
            quantity: '3',
          ),
        ),
        ['same_store'],
      );
      expect(check(const InventoryTransferDraft(quantity: '3')), [
        'store_required',
      ]);
      expect(
        check(
          const InventoryTransferDraft(
            fromStoreId: 'a',
            toStoreId: 'b',
            quantity: '0',
          ),
        ),
        ['quantity_invalid'],
      );
      expect(
        check(
          const InventoryTransferDraft(
            fromStoreId: 'a',
            toStoreId: 'b',
            quantity: '1.5',
          ),
        ),
        ['quantity_invalid'],
      );
      expect(transferInventoryStockRequest('b1', 'i1', ok), {
        'businessId': 'b1',
        'itemId': 'i1',
        'fromStoreId': 's-main',
        'toStoreId': 's-bk',
        'quantity': 3,
      });
      expect(
        transferInventoryStockRequest(
          'b1',
          'i1',
          const InventoryTransferDraft(
            fromStoreId: 'a',
            toStoreId: 'b',
            quantity: '2',
            note: ' box ',
          ),
        )['note'],
        'box',
      );
    });
  });

  group('the service sends the contract names', () {
    test('every new callable by name with its payload', () async {
      final log = <(String, Map<String, Object?>)>[];
      final service = InventoryService(
        caller: (name, payload) async {
          log.add((name, payload));
          return switch (name) {
            'createInventoryCategory' => {'categoryId': 'c9'},
            'createInventoryStore' => {'storeId': 's9'},
            _ => <String, Object?>{},
          };
        },
      );
      expect(await service.createCategory('b1', 'Body'), 'c9');
      await service.renameCategory('b1', 'c9', 'Skin');
      await service.setCategoryArchived('b1', 'c9', archived: true);
      expect(
        await service.createStore('b1', const InventoryStoreDraft(name: 'BK')),
        's9',
      );
      await service.updateStore(
        'b1',
        const InventoryStore(id: 's9', name: 'BK'),
        const InventoryStoreDraft(name: 'Brooklyn'),
      );
      // Nothing changed: no call.
      await service.updateStore(
        'b1',
        const InventoryStore(id: 's9', name: 'BK'),
        const InventoryStoreDraft(name: 'BK'),
      );
      await service.setStoreArchived('b1', 's9', archived: true);
      await service.setStaffAccess(
        businessId: 'b1',
        userId: 'u1',
        homeStoreId: 's9',
        allStores: false,
      );
      await service.transfer(
        'b1',
        'i1',
        const InventoryTransferDraft(
          fromStoreId: 'a',
          toStoreId: 'b',
          quantity: '2',
        ),
      );
      expect(log.map((c) => c.$1), [
        'createInventoryCategory',
        'renameInventoryCategory',
        'archiveInventoryCategory',
        'createInventoryStore',
        'updateInventoryStore',
        'archiveInventoryStore',
        'setInventoryStaffAccess',
        'transferInventoryStock',
      ]);
      expect(log[4].$2, {
        'businessId': 'b1',
        'storeId': 's9',
        'name': 'Brooklyn',
      });
    });
  });

  group('how each new refusal reads', () {
    InventoryFailure failure(
      String reason, {
      String code = 'failed-precondition',
    }) => inventoryFailureOf(code: code, details: {'reason': reason});

    test('every v2 code maps to its own failure', () {
      expect(
        failure('category_name_required', code: 'invalid-argument'),
        InventoryFailure.categoryNameRequired,
      );
      expect(
        failure('category_name_taken'),
        InventoryFailure.categoryNameTaken,
      );
      expect(
        failure('category_not_found', code: 'not-found'),
        InventoryFailure.categoryNotFound,
      );
      expect(
        failure('store_name_required', code: 'invalid-argument'),
        InventoryFailure.storeNameRequired,
      );
      expect(
        failure('store_not_found', code: 'not-found'),
        InventoryFailure.storeNotFound,
      );
      expect(failure('store_archived'), InventoryFailure.storeArchived);
      expect(failure('store_has_stock'), InventoryFailure.storeHasStock);
      expect(
        failure('store_not_allowed', code: 'permission-denied'),
        InventoryFailure.storeNotAllowed,
      );
      expect(
        failure('home_store_required'),
        InventoryFailure.homeStoreRequired,
      );
      expect(
        failure('same_store', code: 'invalid-argument'),
        InventoryFailure.sameStore,
      );
      expect(failure('insufficient_stock'), InventoryFailure.insufficientStock);
      expect(
        failure('owner_only', code: 'permission-denied'),
        InventoryFailure.ownerOnly,
      );
      // The twelve of v2, the four brand codes of v3, and the nine of
      // "received by" and credit sales (inventory_credit_test.dart).
      expect(inventoryFailureReasons.keys, hasLength(25));
    });

    test('a refusal carrying several codes is read by any of ours', () {
      expect(
        inventoryFailureOf(
          code: 'invalid-argument',
          details: {
            'reason': 'quantity_invalid',
            'reasons': ['quantity_invalid', 'same_store'],
          },
        ),
        InventoryFailure.sameStore,
      );
    });

    test('the old codes still read as they did', () {
      expect(failure('item_archived'), InventoryFailure.itemArchived);
      expect(failure('sale_voided'), InventoryFailure.saleVoided);
      expect(inventoryFailureOf(code: 'unavailable'), InventoryFailure.network);
      expect(
        inventoryFailureOf(code: 'permission-denied'),
        InventoryFailure.noPermission,
      );
      expect(
        inventoryFailureIsRetryable(InventoryFailure.insufficientStock),
        isFalse,
      );
      expect(inventoryFailureIsRetryable(InventoryFailure.network), isTrue);
    });
  });

  group('the answers', () {
    test('a v1 summary has no category or store blocks and nothing breaks', () {
      final summary = InventorySummary.fromCallable({
        'salesCount': 2,
        'revenueCents': 900,
        'low': [
          {'itemId': 'i1', 'name': 'Soap', 'quantity': 1, 'lowStockAt': 3},
        ],
      });
      expect(summary.byCategory, isEmpty);
      expect(summary.byStore, isEmpty);
      expect(summary.low.single.storeId, '');
      expect(summary.low.single.storeName, '');
      expect(summary.salesCount, 2);
    });

    test('by category is sorted by money, biggest first', () {
      final summary = InventorySummary.fromCallable({
        'byCategory': [
          {
            'categoryId': 'c2',
            'name': 'Hair',
            'itemsSold': 9,
            'revenueCents': 500,
            'profitCents': 100,
          },
          {
            'categoryId': '',
            'name': 'Uncategorized',
            'itemsSold': 1,
            'revenueCents': 5000,
            'profitCents': 0,
          },
          {
            'categoryId': 'c1',
            'name': 'Body',
            'itemsSold': 4,
            'revenueCents': 500,
            'profitCents': 200,
          },
        ],
        'byStore': [
          {
            'storeId': 's-bk',
            'name': 'Brooklyn',
            'salesCount': 2,
            'itemsSold': 3,
            'revenueCents': 700,
            'profitCents': 300,
          },
        ],
        'low': [
          {
            'itemId': 'i1',
            'name': 'Soap',
            'quantity': 1,
            'lowStockAt': 3,
            'storeId': 's-bk',
            'storeName': 'Brooklyn',
          },
        ],
      });
      expect(summary.byCategory.map((c) => c.name), [
        'Uncategorized',
        'Body',
        'Hair',
      ]);
      expect(summary.byCategory.first.categoryId, '');
      expect(summary.byCategory[1].itemsSold, 4);
      expect(summary.byCategory[1].profitCents, 200);
      expect(summary.byStore.single.name, 'Brooklyn');
      expect(summary.byStore.single.salesCount, 2);
      expect(summary.low.single.storeName, 'Brooklyn');
    });

    test('the new fields of products, sales and movements read', () {
      final item = InventoryItem.fromMap('i1', {
        'businessId': 'b1',
        'name': 'Soap',
        'code': 'it-k7m4p2',
        'priceCents': 450,
        'quantity': 9,
        'category': 'Body',
        'categoryId': 'c1',
      });
      expect(item.categoryId, 'c1');
      expect(item.withQuantity(2, countWasOff: true).countWasOff, isTrue);
      expect(item.withQuantity(-4).quantity, 0);
      expect(item.withQuantity(2).categoryId, 'c1');
      // A v1 product has no category id.
      expect(InventoryItem.fromMap('i2', {'name': 'x'}).categoryId, '');

      final sale = InventorySale.fromMap('s1', {
        'businessId': 'b1',
        'storeId': 's-bk',
        'storeName': 'Brooklyn',
        'lines': const [],
      });
      expect(sale.storeId, 's-bk');
      expect(sale.storeName, 'Brooklyn');
      expect(InventorySale.fromMap('s2', {'lines': const []}).storeId, '');

      final move = InventoryMovement.fromMap('m1', {
        'itemId': 'i1',
        'type': 'transfer_out',
        'delta': -2,
        'quantityAfter': 3,
        'storeId': 's-bk',
        'transferId': 't1',
      });
      expect(move.isTransfer, isTrue);
      expect(move.storeId, 's-bk');
      expect(
        InventoryMovement.fromMap('m2', {'type': 'sale'}).isTransfer,
        isFalse,
      );

      expect(
        InventoryStore.fromMap('s1', {
          'name': ' Brooklyn ',
          'archived': true,
        }).archived,
        isTrue,
      );
      expect(InventoryCategory.fromMap('c1', {'name': 'Body'}).name, 'Body');
    });
  });

  group('the watcher reads only what a person may', () {
    _Source source(List<InventoryStore> stores) => _Source(stores);

    test('a single-store business never opens the stock stream', () async {
      final src = source(const [_main]);
      final watcher = InventoryContextWatcher(
        source: src,
        businessId: 'b1',
        onChange: () {},
      )..start();
      await Future<void>.delayed(Duration.zero);
      expect(watcher.storesLoaded, isTrue);
      expect(watcher.context.multi, isFalse);
      expect(src.stockAsked, isEmpty);
      watcher.dispose();
    });

    test(
      'the owner reads every store\'s counts, staff only their store\'s',
      () async {
        final owner = _Source(const [_main, _brooklyn]);
        final ownerWatcher = InventoryContextWatcher(
          source: owner,
          businessId: 'b1',
          onChange: () {},
        )..start();
        await Future<void>.delayed(Duration.zero);
        expect(owner.stockAsked, ['']);
        expect(ownerWatcher.stock.at('i1', 's-bk'), 2);
        ownerWatcher.dispose();

        final staff = _Source(const [_main, _brooklyn]);
        final staffWatcher = InventoryContextWatcher(
          source: staff,
          businessId: 'b1',
          access: _staffAtBrooklyn,
          onChange: () {},
        )..start();
        await Future<void>.delayed(Duration.zero);
        expect(staff.stockAsked, ['s-bk']);
        expect(staffWatcher.stock.at('i1', 's-bk'), 2);
        expect(staffWatcher.stock.at('i1', 's-main'), 0);
        staffWatcher.dispose();

        // No home store: nothing is read at all.
        final lost = _Source(const [_main, _brooklyn]);
        final lostWatcher = InventoryContextWatcher(
          source: lost,
          businessId: 'b1',
          access: const InventoryAccess(),
          onChange: () {},
        )..start();
        await Future<void>.delayed(Duration.zero);
        expect(lost.stockAsked, isEmpty);
        lostWatcher.dispose();
      },
    );

    test('stores that cannot be read leave a single-store business', () async {
      final src = _Source(const [], storesFail: true);
      final watcher = InventoryContextWatcher(
        source: src,
        businessId: 'b1',
        onChange: () {},
      )..start();
      await Future<void>.delayed(Duration.zero);
      expect(watcher.storesLoaded, isTrue);
      expect(watcher.context.multi, isFalse);
      watcher.dispose();
    });

    test('a stores stream that never answers still resolves', () async {
      final src = _Source(const [], storesHang: true);
      var changes = 0;
      final watcher = InventoryContextWatcher(
        source: src,
        businessId: 'b1',
        safety: const Duration(milliseconds: 20),
        onChange: () => changes++,
      )..start();
      expect(watcher.storesLoaded, isFalse);
      await Future<void>.delayed(const Duration(milliseconds: 60));
      expect(watcher.storesLoaded, isTrue);
      expect(changes, greaterThan(0));
      watcher.dispose();
    });
  });
}

class _Source implements InventorySource {
  _Source(this.stores, {this.storesFail = false, this.storesHang = false});

  final List<InventoryStore> stores;
  final bool storesFail;
  final bool storesHang;
  final List<String> stockAsked = [];

  @override
  Stream<List<InventoryStore>> watchStores(String businessId) {
    if (storesHang) return StreamController<List<InventoryStore>>().stream;
    return storesFail
        ? Stream.error(StateError('denied'))
        : Stream.value(stores);
  }

  @override
  Stream<List<InventoryStockRow>> watchStock(
    String businessId, {
    String storeId = '',
  }) {
    stockAsked.add(storeId);
    return Stream.value([
      for (final r in [
        const InventoryStockRow(itemId: 'i1', storeId: 's-bk', quantity: 2),
        const InventoryStockRow(itemId: 'i1', storeId: 's-main', quantity: 8),
      ])
        if (storeId.isEmpty || r.storeId == storeId) r,
    ]);
  }

  @override
  Stream<List<InventoryCategory>> watchCategories(String businessId) =>
      Stream.value(const []);

  @override
  Stream<List<InventoryBrand>> watchBrands(String businessId) =>
      Stream.value(const []);

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
