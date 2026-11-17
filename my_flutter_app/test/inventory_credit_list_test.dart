import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/inventory.dart';
import 'package:my_flutter_app/services/inventory_credit.dart';
import 'package:my_flutter_app/services/inventory_credit_list.dart';

final _today = DateTime(2026, 10, 16);

InventorySale _credit(
  String id, {
  String name = 'Awa',
  String phone = '+12125550100',
  String collector = 'u-me',
  String due = '',
  int credit = 4000,
  int paid = 0,
  String store = '',
  String storeName = '',
  String status = 'open',
}) => InventorySale.fromMap(id, {
  'businessId': 'b1',
  'totalCents': 6000,
  'paymentMethod': 'cash',
  'storeId': store,
  'storeName': storeName,
  'createdAt': DateTime(2026, 10, 2, 11),
  'paidNowCents': 6000 - credit,
  'creditCents': credit,
  'creditPaidCents': paid,
  'creditStatus': status,
  'credit': {
    'customerName': name,
    'customerPhone': phone,
    'collectorStaffId': collector,
    'dueDate': due,
  },
});

List<String> _ids(Iterable<InventorySale> s) => s.map((e) => e.id).toList();

void main() {
  final a = _credit(
    'a',
    name: 'Awa Diallo',
    phone: '+1 212 555 0100',
    due: '2026-10-30',
  );
  final b = _credit(
    'b',
    name: 'Binta Bah',
    phone: '+233 20 111 2222',
    collector: 'u-kofi',
    due: '2026-10-01',
    store: 's2',
    storeName: 'Brooklyn',
  );
  final c = _credit(
    'c',
    name: 'awa diallo',
    phone: '1-212-555-0100',
    due: '2026-10-12',
    paid: 1000,
  );
  final d = _credit(
    'd',
    name: 'Cheikh Sy',
    phone: '',
    due: '',
    store: 's2',
    storeName: 'Brooklyn',
  );
  final all = [b, c, a, d];

  group('customer key', () {
    test('a phone of seven digits or more names the customer', () {
      expect(
        inventoryCreditCustomerKey('Awa', '+1 (212) 555-0100'),
        inventoryCreditCustomerKey('A. Diallo', '12125550100'),
      );
      expect(
        inventoryCreditCustomerKey('Awa', '+1 212 555 0100'),
        'tel:12125550100',
      );
    });
    test('with no usable phone the name, lower case, single spaces', () {
      expect(
        inventoryCreditCustomerKey('  Awa   DIALLO ', '123'),
        'name:awa diallo',
      );
    });
  });

  group('filter', () {
    test('no filter returns the same list', () {
      expect(
        identical(filterInventoryCredits(all, today: _today), all),
        isTrue,
      );
    });
    test('overdue only keeps credits past their due day', () {
      expect(
        _ids(filterInventoryCredits(all, overdueOnly: true, today: _today)),
        ['b', 'c'],
      );
    });
    test('the due day itself is still on time', () {
      final dueToday = _credit('t', due: '2026-10-16');
      expect(
        filterInventoryCredits([dueToday], overdueOnly: true, today: _today),
        isEmpty,
      );
    });
    test('search: every word in the name, any case', () {
      expect(
        _ids(filterInventoryCredits(all, query: 'DIALLO awa', today: _today)),
        ['c', 'a'],
      );
      expect(_ids(filterInventoryCredits(all, query: 'cheik', today: _today)), [
        'd',
      ]);
      expect(filterInventoryCredits(all, query: 'zzz', today: _today), isEmpty);
    });
    test('search: three or more phone digits match the phone', () {
      expect(
        _ids(filterInventoryCredits(all, query: '555 01', today: _today)),
        ['c', 'a'],
      );
      expect(_ids(filterInventoryCredits(all, query: '233', today: _today)), [
        'b',
      ]);
      // Two digits are too few to mean a phone.
      expect(filterInventoryCredits(all, query: '55', today: _today), isEmpty);
    });
    test('overdue and search combine', () {
      expect(
        _ids(
          filterInventoryCredits(
            all,
            overdueOnly: true,
            query: 'awa',
            today: _today,
          ),
        ),
        ['c'],
      );
    });
  });

  group('grouping', () {
    test('none is one group with the totals', () {
      final g = groupInventoryCredits(
        all,
        InventoryCreditGroupBy.none,
        today: _today,
      );
      expect(g, hasLength(1));
      expect(g.single.rows, all);
      // b 4000 + c 3000 + a 4000 + d 4000.
      expect(g.single.totals.owedCents, 15000);
      expect(g.single.totals.overdueCount, 2);
    });
    test('by customer: one phone is one group, first row leads', () {
      final g = groupInventoryCredits(
        all,
        InventoryCreditGroupBy.customer,
        today: _today,
      );
      expect(g.map((x) => x.rows.map((s) => s.id).toList()), [
        ['b'],
        ['c', 'a'],
        ['d'],
      ]);
      expect(g[1].label, 'awa diallo');
      expect(g[1].detail, '1-212-555-0100');
      expect(g[1].totals.owedCents, 7000);
      expect(g[1].totals.overdueCents, 3000);
    });
    test('by collector, named through the lookup', () {
      final g = groupInventoryCredits(
        all,
        InventoryCreditGroupBy.collector,
        today: _today,
        collectorName: (id) => id == 'u-me' ? 'Ama' : 'Kofi',
      );
      expect(g.map((x) => x.label), ['Kofi', 'Ama']);
      expect(g.map((x) => x.rows.length), [1, 3]);
    });
    test('by store, a sale with no store is its own group', () {
      final g = groupInventoryCredits(
        all,
        InventoryCreditGroupBy.store,
        today: _today,
      );
      expect(g.map((x) => x.label), ['Brooklyn', '']);
      expect(g.first.rows.map((s) => s.id), ['b', 'd']);
    });
  });

  group('On credit sales filter', () {
    final plain = InventorySale.fromMap('plain', {
      'businessId': 'b1',
      'totalCents': 1000,
      'paymentMethod': 'cash',
    });
    final open = _credit('open');
    final paidOff = _credit('paid', paid: 4000, status: 'paid');
    final voided = InventorySale.fromMap('void', {
      'businessId': 'b1',
      'totalCents': 6000,
      'paymentMethod': 'cash',
      'creditCents': 4000,
      'creditStatus': 'open',
      'voided': true,
      'credit': {'customerName': 'X', 'customerPhone': ''},
    });
    final sales = [plain, open, paidOff, voided];

    test('every credit sale, paid off ones included, like the console', () {
      expect(
        _ids(inventorySalesForCredit(sales, InventoryCreditFilter.credit)),
        ['open', 'paid', 'void'],
      );
    });
    test('the other three filters are unchanged', () {
      expect(
        _ids(inventorySalesForCredit(sales, InventoryCreditFilter.all)).length,
        4,
      );
      expect(_ids(inventorySalesForCredit(sales, InventoryCreditFilter.open)), [
        'open',
      ]);
      expect(_ids(inventorySalesForCredit(sales, InventoryCreditFilter.paid)), [
        'paid',
      ]);
    });
  });
}
