import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/inventory.dart';
import 'package:my_flutter_app/services/inventory_service.dart';

InventoryItem _item(
  String id, {
  int price = 1000,
  int quantity = 10,
  int? lowStockAt,
  int? cost,
  bool archived = false,
  bool countWasOff = false,
  String name = '',
  String category = '',
}) =>
    InventoryItem(
      id: id,
      businessId: 'b1',
      name: name.isEmpty ? 'Item $id' : name,
      code: 'IT-K7M4P2',
      priceCents: price,
      costCents: cost,
      quantity: quantity,
      lowStockAt: lowStockAt,
      archived: archived,
      countWasOff: countWasOff,
      category: category,
    );

void main() {
  group('tag codes', () {
    test('a typed code reads however it is written', () {
      expect(inventoryCodeFromScan('IT-K7M4P2'), 'IT-K7M4P2');
      expect(inventoryCodeFromScan('it k7m4p2'), 'IT-K7M4P2');
      expect(inventoryCodeFromScan('  ITK7M4P2 '), 'IT-K7M4P2');
    });

    test('the tag link reads, with or without the scheme', () {
      expect(
        inventoryCodeFromScan('https://customer.laawoldigital.com/i/IT-K7M4P2'),
        'IT-K7M4P2',
      );
      expect(
        inventoryCodeFromScan('customer.laawoldigital.com/i/it-k7m4p2'),
        'IT-K7M4P2',
      );
      expect(
        inventoryCodeFromLink(
            Uri.parse('https://customer.laawoldigital.com/i/IT-K7M4P2/')),
        'IT-K7M4P2',
      );
    });

    test('another host, another path or another prefix is not ours', () {
      expect(inventoryCodeFromScan('https://example.com/i/IT-K7M4P2'), isNull);
      expect(
        inventoryCodeFromScan('https://customer.laawoldigital.com/t/IT-K7M4P2'),
        isNull,
      );
      expect(
        inventoryCodeFromScan('https://customer.laawoldigital.com/i/CL-K7M4P2'),
        isNull,
      );
      expect(
        inventoryCodeFromScan('https://customer.laawoldigital.com/i/IT-K7M4P2/x'),
        isNull,
      );
      expect(inventoryCodeFromScan('CL-K7M4P2'), isNull);
      expect(inventoryCodeFromScan('evil.com/IT-K7M4P2'), isNull);
      expect(inventoryCodeFromLink(null), isNull);
      expect(
        inventoryCodeFromLink(
            Uri.parse('ftp://customer.laawoldigital.com/i/IT-K7M4P2')),
        isNull,
      );
    });

    test('the short alphabet refuses look-alikes and wrong lengths', () {
      expect(inventoryCodeFromScan('IT-K7M4P0'), isNull); // zero
      expect(inventoryCodeFromScan('IT-K7M4PO'), isNull); // letter O
      expect(inventoryCodeFromScan('IT-K7M4P'), isNull);
      expect(inventoryCodeFromScan('IT-K7M4P22'), isNull);
      expect(inventoryCodeFromScan(''), isNull);
      expect(inventoryCodeFromScan(null), isNull);
      expect(inventoryCodeFromScan('hello'), isNull);
    });

    test('a held tag counts once per cooldown, another tag at once', () {
      final debounce = ScanDebouncer(cooldown: const Duration(seconds: 2));
      final t0 = DateTime(2026, 10, 10, 12);
      expect(debounce.accept('IT-K7M4P2', t0), isTrue);
      expect(debounce.accept('IT-K7M4P2', t0.add(const Duration(milliseconds: 300))),
          isFalse);
      expect(debounce.accept('IT-BBBBBB', t0.add(const Duration(milliseconds: 400))),
          isTrue);
      expect(debounce.accept('IT-K7M4P2', t0.add(const Duration(milliseconds: 500))),
          isTrue);
      expect(debounce.accept('IT-K7M4P2', t0.add(const Duration(seconds: 3))),
          isTrue);
    });
  });

  group('who may use it', () {
    test('both gates and a business are needed', () {
      expect(
        inventoryAvailable(
            services: const ['inventory'], hasPermission: true, businessId: 'b1'),
        isTrue,
      );
      expect(
        inventoryAvailable(
            services: const ['freight'], hasPermission: true, businessId: 'b1'),
        isFalse,
      );
      expect(
        inventoryAvailable(
            services: const ['inventory'], hasPermission: false, businessId: 'b1'),
        isFalse,
      );
      expect(
        inventoryAvailable(
            services: const ['inventory'], hasPermission: true, businessId: ' '),
        isFalse,
      );
    });
  });

  group('stock status', () {
    test('low at or below the level, always at zero, never when unset', () {
      expect(stockStatus(quantity: 5), InventoryStock.ok);
      expect(stockStatus(quantity: 5, lowStockAt: 4), InventoryStock.ok);
      expect(stockStatus(quantity: 4, lowStockAt: 4), InventoryStock.low);
      expect(stockStatus(quantity: 1, lowStockAt: 4), InventoryStock.low);
      expect(stockStatus(quantity: 0), InventoryStock.out);
      expect(stockStatus(quantity: 0, lowStockAt: 0), InventoryStock.out);
      expect(_item('a', quantity: 0).isLow, isTrue);
      expect(_item('a', quantity: 3, lowStockAt: 3).isLow, isTrue);
    });

    test('a product reads from its document, never negative', () {
      final item = InventoryItem.fromMap('i1', {
        'businessId': 'b1',
        'name': ' Soap ',
        'code': 'it-k7m4p2',
        'priceCents': 450,
        'costCents': null,
        'quantity': -3,
        'lowStockAt': 2,
        'archived': false,
        'countWasOff': true,
      });
      expect(item.name, 'Soap');
      expect(item.code, 'IT-K7M4P2');
      expect(item.quantity, 0);
      expect(item.costCents, isNull);
      expect(item.stock, InventoryStock.out);
      expect(item.countWasOff, isTrue);
      expect(item.needsAttention, isTrue);
    });
  });

  group('listing', () {
    final items = [
      _item('a', name: 'Zinc cream', quantity: 20),
      _item('b', name: 'Apple soap', quantity: 20, category: 'Soap'),
      _item('c', name: 'Mango oil', quantity: 1, lowStockAt: 3),
      _item('d', name: 'Old tin', archived: true),
      _item('e', name: 'Bar', quantity: 5, countWasOff: true),
    ];

    test('attention first, then by name; archived hidden', () {
      final names = inventoryListing(items).map((i) => i.name).toList();
      expect(names, ['Bar', 'Mango oil', 'Apple soap', 'Zinc cream']);
    });

    test('the archived toggle shows only archived', () {
      final names =
          inventoryListing(items, showArchived: true).map((i) => i.name).toList();
      expect(names, ['Old tin']);
    });

    test('search matches name, category and the code with or without dash', () {
      expect(inventoryListing(items, query: 'soap').length, 1);
      expect(inventoryListing(items, query: 'mango').length, 1);
      expect(inventoryListing(items, query: 'it-k7m4p2').length, 4);
      expect(inventoryListing(items, query: 'itk7m4').length, 4);
      expect(inventoryListing(items, query: 'nothing here'), isEmpty);
    });

    test('the sell search needs two letters and skips archived', () {
      expect(inventorySellSearch(items, 'a'), isEmpty);
      expect(inventorySellSearch(items, 'old'), isEmpty);
      expect(inventorySellSearch(items, 'soap').single.id, 'b');
    });
  });

  group('basket', () {
    final soap = _item('soap', price: 450);
    final oil = _item('oil', price: 1200);

    test('a scan adds the product with quantity 1', () {
      final basket = const Basket().addScan(soap);
      expect(basket.lines.single.quantity, 1);
      expect(basket.totalCents, 450);
      expect(basket.itemCount, 1);
    });

    test('scanning the same product again adds one to that line', () {
      final basket = const Basket().addScan(soap).addScan(soap);
      expect(basket.lines.length, 1);
      expect(basket.lines.single.quantity, 2);
      expect(basket.totalCents, 900);
      final three = basket.addScan(oil).addScan(soap);
      expect(three.lines.length, 2);
      expect(three.lineFor('soap')!.quantity, 3);
      expect(three.lineFor('oil')!.quantity, 1);
      expect(three.totalCents, 3 * 450 + 1200);
      expect(three.itemCount, 4);
    });

    test('quantity is editable, kept between 1 and the cap', () {
      var basket = const Basket().addScan(soap);
      basket = basket.withQuantity('soap', 5);
      expect(basket.totalCents, 2250);
      expect(basket.withQuantity('soap', 0).lines.single.quantity, 1);
      expect(basket.withQuantity('soap', -4).lines.single.quantity, 1);
      expect(basket.withQuantity('soap', 5000000).lines.single.quantity,
          inventoryMaxSaleQuantity);
      expect(basket.withQuantity('nope', 9), same(basket));
    });

    test('a per-line price changes the total and keeps the list price', () {
      var basket = const Basket().addScan(soap).addScan(soap).addScan(oil);
      basket = basket.withPrice('soap', 400);
      final line = basket.lineFor('soap')!;
      expect(line.soldPriceCents, 400);
      expect(line.listPriceCents, 450);
      expect(line.priceChanged, isTrue);
      expect(basket.totalCents, 2 * 400 + 1200);
      // 50 cents off each of two.
      expect(basket.discountCents, 100);
    });

    test('a price above the list is not a discount; the list price clears it', () {
      var basket = const Basket().addScan(soap).withPrice('soap', 500);
      expect(basket.totalCents, 500);
      expect(basket.discountCents, 0);
      expect(basket.lines.single.priceChanged, isTrue);
      basket = basket.withPrice('soap', 450);
      expect(basket.lines.single.priceOverrideCents, isNull);
      expect(basket.lines.single.priceChanged, isFalse);
      // A giveaway is allowed.
      final free = const Basket().addScan(soap).withPrice('soap', 0);
      expect(free.totalCents, 0);
      expect(free.discountCents, 450);
    });

    test('removing a line, and a product that refreshes keeps its edits', () {
      var basket = const Basket().addScan(soap).addScan(oil);
      basket = basket.withPrice('oil', 1000).withQuantity('oil', 2);
      final repriced = _item('oil', price: 1300);
      basket = basket.refreshed([repriced]);
      expect(basket.lineFor('oil')!.listPriceCents, 1300);
      expect(basket.lineFor('oil')!.soldPriceCents, 1000);
      expect(basket.lineFor('oil')!.quantity, 2);
      basket = basket.withoutLine('soap');
      expect(basket.lines.map((l) => l.item.id), ['oil']);
      expect(basket.withoutLine('oil').isEmpty, isTrue);
    });

    test('selling more than the count is a heads-up, not a stop', () {
      final few = _item('few', quantity: 2);
      final basket = const Basket().addScan(few).addScan(few);
      expect(basket.lines.single.exceedsCount, isFalse);
      final three = basket.addScan(few);
      expect(three.lines.single.exceedsCount, isTrue);
      expect(three.problems, isEmpty);
    });

    test('what blocks a sale: empty, archived, too large', () {
      expect(const Basket().problems, ['basket_empty']);
      final archived = const Basket().addScan(_item('x', archived: true));
      expect(archived.problems, contains('item_archived'));
      final huge = const Basket()
          .addScan(_item('h', price: inventoryMaxCents))
          .addScan(_item('h', price: inventoryMaxCents));
      expect(huge.problems, contains('total_too_large'));
    });

    test('the signature changes with lines, quantities and prices', () {
      final a = const Basket().addScan(soap);
      final b = a.addScan(soap);
      final c = a.withPrice('soap', 400);
      expect({a.signature, b.signature, c.signature}.length, 3);
      expect(a.signature, const Basket().addScan(soap).signature);
    });
  });

  group('retrying a sale', () {
    test('the same sale keeps one id, a changed one gets a new one', () {
      var n = 0;
      final attempt = SaleAttempt(newId: () => 'id-${++n}');
      final soap = _item('soap');
      final basket = const Basket().addScan(soap);
      expect(attempt.idFor(basket, 'cash'), 'id-1');
      // A retry after a lost answer.
      expect(attempt.idFor(basket, 'cash'), 'id-1');
      // A different basket or payment is a different sale.
      expect(attempt.idFor(basket.addScan(soap), 'cash'), 'id-2');
      expect(attempt.idFor(basket.addScan(soap), 'zelle'), 'id-3');
      attempt.clear();
      expect(attempt.idFor(basket.addScan(soap), 'zelle'), 'id-4');
    });

    test('request ids are long and never repeat', () {
      final ids = {for (var i = 0; i < 50; i++) newInventoryRequestId()};
      expect(ids.length, 50);
      expect(ids.first.length, greaterThan(24));
    });
  });

  group('the product form', () {
    const good = InventoryItemDraft(
      name: 'Shea butter',
      price: '12.50',
      quantity: '24',
    );

    test('a good draft is clean', () {
      expect(validateInventoryItemDraft(good, creating: true), isEmpty);
    });

    test('each field is refused with its own code', () {
      List<String> check(InventoryItemDraft d, {bool creating = true}) =>
          validateInventoryItemDraft(d, creating: creating);
      expect(check(const InventoryItemDraft(price: '1', quantity: '1')),
          ['name_required']);
      expect(
          check(InventoryItemDraft(
              name: 'x' * 121, price: '1', quantity: '1')),
          ['name_too_long']);
      expect(check(const InventoryItemDraft(name: 'a', quantity: '1')),
          ['price_invalid']);
      expect(check(const InventoryItemDraft(name: 'a', price: '0', quantity: '1')),
          ['price_invalid']);
      expect(
          check(const InventoryItemDraft(
              name: 'a', price: '1', cost: 'abc', quantity: '1')),
          ['cost_invalid']);
      expect(check(const InventoryItemDraft(name: 'a', price: '1')),
          ['quantity_invalid']);
      expect(
          check(const InventoryItemDraft(
              name: 'a', price: '1', quantity: '2.5')),
          ['quantity_invalid']);
      expect(
          check(const InventoryItemDraft(
              name: 'a', price: '1', quantity: '1', lowStockAt: 'x')),
          ['low_stock_invalid']);
      expect(
          check(const InventoryItemDraft(
              name: 'a', price: '1', quantity: '1', photoUrl: 'not a link')),
          ['photo_invalid']);
    });

    test('editing never asks for the count', () {
      expect(
        validateInventoryItemDraft(
          const InventoryItemDraft(name: 'a', price: '1'),
          creating: false,
        ),
        isEmpty,
      );
    });

    test('optional fields may be blank; "12,50" is twelve fifty', () {
      expect(
        validateInventoryItemDraft(
          const InventoryItemDraft(name: 'a', price: '12,50', quantity: '0'),
          creating: true,
        ),
        isEmpty,
      );
      expect(readSoldPrice('12,50'), 1250);
      expect(readSoldPrice('0'), 0);
      expect(readSoldPrice('-1'), isNull);
      expect(readSoldPrice('abc'), isNull);
      expect(readSoldPrice(''), isNull);
    });

    test('a stock adjustment is a whole number; add needs at least one', () {
      expect(validateStockAdjustment('5', adding: true), isEmpty);
      expect(validateStockAdjustment('0', adding: true), isNotEmpty);
      expect(validateStockAdjustment('0', adding: false), isEmpty);
      expect(validateStockAdjustment('-1', adding: false), isNotEmpty);
      expect(validateStockAdjustment('', adding: false), isNotEmpty);
    });

    test('tag copies are 1 to 500', () {
      expect(readTagCopies('1'), 1);
      expect(readTagCopies('500'), 500);
      expect(readTagCopies('0'), isNull);
      expect(readTagCopies('501'), isNull);
      expect(readTagCopies('x'), isNull);
    });
  });

  group('request builders', () {
    test('createInventoryItem sends only what was filled in', () {
      final request = createInventoryItemRequest(
        'b1',
        const InventoryItemDraft(
          name: '  Shea  ',
          price: '12.50',
          cost: '8',
          quantity: '24',
          lowStockAt: '5',
          category: 'Body',
          photoUrl: 'https://example.com/a.jpg',
        ),
      );
      expect(request, {
        'businessId': 'b1',
        'name': 'Shea',
        'priceCents': 1250,
        'costCents': 800,
        'quantity': 24,
        'lowStockAt': 5,
        'category': 'Body',
        'photoUrl': 'https://example.com/a.jpg',
      });
      final bare = createInventoryItemRequest(
        'b1',
        const InventoryItemDraft(name: 'a', price: '1', quantity: '0'),
      );
      expect(bare.keys.toSet(),
          {'businessId', 'name', 'priceCents', 'quantity'});
    });

    test('updateInventoryItem sends only the changes and never the count', () {
      final existing = _item('i1',
          price: 1250, cost: 800, quantity: 24, lowStockAt: 5, name: 'Shea');
      final same = InventoryItemDraft.fromItem(existing);
      final untouched = updateInventoryItemRequest('b1', existing, same);
      expect(inventoryUpdateIsEmpty(untouched), isTrue);
      expect(untouched, {'businessId': 'b1', 'itemId': 'i1'});

      final changed = updateInventoryItemRequest(
        'b1',
        existing,
        const InventoryItemDraft(
          name: 'Shea butter',
          price: '13',
          cost: '',
          quantity: '999',
          lowStockAt: '',
          category: 'Body',
        ),
      );
      expect(changed, {
        'businessId': 'b1',
        'itemId': 'i1',
        'name': 'Shea butter',
        'priceCents': 1300,
        'costCents': null,
        'lowStockAt': null,
        'category': 'Body',
      });
      expect(changed.containsKey('quantity'), isFalse);
    });

    test('adjust, archive, delete, void, labels and summary payloads', () {
      expect(
        adjustInventoryStockRequest(
            businessId: 'b1', itemId: 'i1', add: true, quantity: 5, note: ' box '),
        {
          'businessId': 'b1',
          'itemId': 'i1',
          'mode': 'add',
          'quantity': 5,
          'note': 'box',
        },
      );
      expect(
        adjustInventoryStockRequest(
            businessId: 'b1', itemId: 'i1', add: false, quantity: 0),
        {'businessId': 'b1', 'itemId': 'i1', 'mode': 'set', 'quantity': 0},
      );
      expect(archiveInventoryItemRequest('b1', 'i1', archived: true),
          {'businessId': 'b1', 'itemId': 'i1', 'archived': true});
      // Delete always carries the confirmation the server demands.
      expect(deleteInventoryItemRequest('b1', 'i1'),
          {'businessId': 'b1', 'itemId': 'i1', 'confirm': true});
      expect(voidInventorySaleRequest('b1', 's1'),
          {'businessId': 'b1', 'saleId': 's1'});
      expect(voidInventorySaleRequest('b1', 's1', reason: 'mistake'),
          {'businessId': 'b1', 'saleId': 's1', 'reason': 'mistake'});
      expect(inventoryLabelsRequest('b1', 'i1', 0)['copies'], 1);
      expect(inventoryLabelsRequest('b1', 'i1', 12)['copies'], 12);
      expect(inventoryLabelsRequest('b1', 'i1', 9000)['copies'], 500);
      expect(
        inventorySummaryRequest('b1', range: 'month', timeZone: 'America/New_York'),
        {'businessId': 'b1', 'range': 'month', 'timeZone': 'America/New_York'},
      );
      expect(
        inventorySummaryRequest('b1', range: 'year', timeZone: '')['range'],
        'today',
      );
    });

    test('recordInventorySale sends one line per product at the sold price', () {
      final soap = _item('soap', price: 450);
      final oil = _item('oil', price: 1200);
      final basket = const Basket()
          .addScan(soap)
          .addScan(soap)
          .addScan(oil)
          .withPrice('oil', 1000);
      final request = recordInventorySaleRequest(
        businessId: 'b1',
        clientRequestId: 'req-1',
        paymentMethod: 'zelle',
        basket: basket,
      );
      expect(request, {
        'businessId': 'b1',
        'clientRequestId': 'req-1',
        'paymentMethod': 'zelle',
        'lines': [
          {'itemId': 'soap', 'quantity': 2, 'soldPriceCents': 450},
          {'itemId': 'oil', 'quantity': 1, 'soldPriceCents': 1000},
        ],
      });
      // An unknown method falls back to the catch-all the server accepts.
      expect(
        recordInventorySaleRequest(
          businessId: 'b1',
          clientRequestId: 'r',
          paymentMethod: 'bitcoin',
          basket: basket,
        )['paymentMethod'],
        'other',
      );
      expect(inventoryPaymentMethods, contains('card_in_person'));
    });

    test('the zone is named from the phone clock', () {
      expect(inventoryTimeZoneName(DateTime.utc(2026, 10, 10)), 'UTC');
    });
  });

  group('answers and failures', () {
    test('a recorded sale reads with its warnings', () {
      final result = InventorySaleResult.fromCallable({
        'saleId': 's1',
        'totalCents': 1350,
        'warnings': [
          {'itemId': 'i1', 'reason': 'count_was_off'},
          {'itemId': 'i2', 'reason': 'something_else'},
        ],
      })!;
      expect(result.saleId, 's1');
      expect(result.totalCents, 1350);
      expect(result.countWasOffItemIds, ['i1']);
      expect(InventorySaleResult.fromCallable({'totalCents': 5}), isNull);
      expect(InventorySaleResult.fromCallable(null), isNull);
    });

    test('the summary reads, and an unreadable answer is empty not a crash', () {
      final summary = InventorySummary.fromCallable({
        'salesCount': 3,
        'itemsSold': 7,
        'revenueCents': 5000,
        'costCents': 2000,
        'profitCents': 3000,
        'discountCents': 150,
        'best': [
          {'itemId': 'i1', 'name': 'Soap', 'quantity': 4, 'revenueCents': 1800}
        ],
        'low': [
          {'itemId': 'i2', 'name': 'Oil', 'quantity': 1, 'lowStockAt': 3}
        ],
        'countWasOff': [
          {'itemId': 'i3', 'name': 'Tin'}
        ],
      });
      expect(summary.salesCount, 3);
      expect(summary.profitCents, 3000);
      expect(summary.best.single.name, 'Soap');
      expect(summary.low.single.lowStockAt, 3);
      expect(summary.countWasOff.single.name, 'Tin');
      final empty = InventorySummary.fromCallable('garbage');
      expect(empty.salesCount, 0);
      expect(empty.low, isEmpty);
    });

    test('a failure reads from its reason and its code', () {
      InventoryFailure of(String code, {Object? details}) =>
          inventoryFailureOf(code: code, details: details);
      expect(of('failed-precondition', details: {'reason': 'item_archived'}),
          InventoryFailure.itemArchived);
      expect(of('not-found', details: {'reason': 'item_not_found'}),
          InventoryFailure.itemNotFound);
      expect(of('failed-precondition', details: {'reason': 'sale_voided'}),
          InventoryFailure.saleVoided);
      expect(of('unavailable'), InventoryFailure.network);
      expect(of('deadline-exceeded'), InventoryFailure.network);
      expect(of('permission-denied'), InventoryFailure.noPermission);
      expect(of('invalid-argument'), InventoryFailure.invalid);
      expect(of('internal'), InventoryFailure.unknown);
      expect(inventoryFailureIsRetryable(InventoryFailure.network), isTrue);
      expect(inventoryFailureIsRetryable(InventoryFailure.itemArchived), isFalse);
    });
  });

  group('the queries', () {
    test('every read names the business and is bounded', () {
      final specs = [
        inventoryItemsSpec('b1'),
        inventoryItemByCodeSpec('b1', 'IT-K7M4P2'),
        inventorySalesSpec('b1', limit: inventorySalesPageSize),
        inventoryMovementsSpec('b1', 'i1'),
      ];
      for (final spec in specs) {
        expect(spec.isBusinessScoped, isTrue, reason: '$spec');
      }
      // Products are the whole shop list, read by business alone.
      expect(inventoryItemsSpec('b1').orderBy, isNull);
      for (final spec in [
        inventoryItemByCodeSpec('b1', 'IT-K7M4P2'),
        inventorySalesSpec('b1', limit: 25),
        inventoryMovementsSpec('b1', 'i1'),
      ]) {
        expect(spec.isBounded, isTrue, reason: '$spec');
      }
    });

    test('the sales page needs the one composite index it documents', () {
      final index = inventorySalesSpec('b1', limit: 25).compositeIndex!;
      expect(index.map((f) => f.toString()).toList(),
          ['businessId ASCENDING', 'createdAt DESCENDING']);
      // The others merge single-field indexes: nothing to deploy.
      expect(inventoryItemsSpec('b1').compositeIndex, isNull);
      expect(inventoryItemByCodeSpec('b1', 'IT-K7M4P2').compositeIndex, isNull);
      expect(inventoryMovementsSpec('b1', 'i1').compositeIndex, isNull);
    });
  });

  group('models from documents', () {
    test('a sale and its lines read, with the discount and the voided mark', () {
      final sale = InventorySale.fromMap('s1', {
        'businessId': 'b1',
        'totalCents': 1800,
        'paymentMethod': 'cash',
        'soldByStaffId': 'u1',
        'voided': true,
        'voidedByStaffId': 'u2',
        'lines': [
          {
            'itemId': 'i1',
            'name': 'Soap',
            'code': 'IT-K7M4P2',
            'quantity': 2,
            'listPriceCents': 500,
            'soldPriceCents': 400,
            'costCents': 200,
            'countWasOff': true,
          },
          {
            'itemId': 'i2',
            'name': 'Oil',
            'quantity': 1,
            'listPriceCents': 1000,
            'soldPriceCents': 1000,
          },
        ],
      });
      expect(sale.lines.length, 2);
      expect(sale.itemCount, 3);
      expect(sale.discountCents, 200);
      expect(sale.voided, isTrue);
      expect(sale.hadCountWasOff, isTrue);
      expect(sale.lines.first.priceChanged, isTrue);
      expect(sale.lines.last.priceChanged, isFalse);
    });

    test('movements sort newest first', () {
      final moves = sortMovementsNewestFirst([
        InventoryMovement.fromMap('a', {
          'itemId': 'i',
          'type': 'add',
          'delta': 5,
          'quantityAfter': 5,
          'createdAt': DateTime(2026, 10, 1),
        }),
        InventoryMovement.fromMap('b', {
          'itemId': 'i',
          'type': 'sale',
          'delta': -1,
          'quantityAfter': 4,
          'createdAt': DateTime(2026, 10, 2),
        }),
        InventoryMovement.fromMap('c', {'itemId': 'i', 'type': 'set'}),
      ]);
      expect(moves.map((m) => m.id).toList(), ['b', 'a', 'c']);
      expect(moves.first.delta, -1);
    });
  });
}
