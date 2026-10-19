import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/inventory.dart';
import 'package:my_flutter_app/services/inventory_credit.dart';

/// Credit sales, the pure half: the checkout's validator and request, how a
/// sale reads (old sales are paid in full by the seller), where a credit
/// stands, the open-credit list and totals, later payments.

InventorySale _sale(
  String id, {
  int total = 6000,
  int credit = 0,
  int creditPaid = 0,
  String status = 'none',
  String collector = 'u-ama',
  String due = '',
  String storeId = '',
  bool voided = false,
  DateTime? createdAt,
  String name = 'Fatou',
}) => InventorySale.fromMap(id, {
  'businessId': 'b1',
  'totalCents': total,
  'paymentMethod': 'cash',
  'soldByStaffId': 'u-seller',
  'storeId': storeId,
  'voided': voided,
  'createdAt': createdAt,
  if (status != 'none') ...{
    'paidNowCents': total - credit,
    'creditCents': credit,
    'creditPaidCents': creditPaid,
    'creditStatus': status,
    'credit': {
      'customerName': name,
      'customerPhone': '+12125550100',
      'collectorStaffId': collector,
      'dueDate': due,
    },
  },
});

final _today = DateTime(2026, 10, 16, 14, 30);

const _credit = InventoryCheckoutDraft(
  onCredit: true,
  paidNow: '20',
  customerName: 'Fatou Diallo',
  customerPhone: '+12125550100',
  collectorStaffId: 'u-ama',
  dueDate: '2026-10-30',
);

void main() {
  group('a sale reads its money', () {
    test('an old sale (no credit fields) is paid in full by the seller', () {
      final sale = InventorySale.fromMap('s1', {
        'businessId': 'b1',
        'totalCents': 4500,
        'paymentMethod': 'cash',
        'soldByStaffId': 'u-seller',
      });
      expect(sale.isOnCredit, isFalse);
      expect(sale.creditOpen, isFalse);
      expect(sale.paidAtSaleCents, 4500);
      expect(sale.creditBalanceCents, 0);
      expect(sale.moneyReceivedBy, 'u-seller');
      expect(sale.creditStatus, 'none');
      expect(
        inventoryCreditStanding(sale, today: _today),
        InventoryCreditStanding.none,
      );
    });

    test('a credit sale reads its parts, who took the money and the terms', () {
      final sale = InventorySale.fromMap('s2', {
        'businessId': 'b1',
        'totalCents': 6000,
        'soldByStaffId': 'u-seller',
        'receivedByStaffId': 'u-owner',
        'paidNowCents': 2000,
        'creditCents': 4000,
        'creditPaidCents': 1500,
        'creditStatus': 'open',
        'credit': {
          'customerName': ' Fatou ',
          'customerPhone': '+224620000000',
          'collectorStaffId': 'u-ama',
          'dueDate': '2026-10-30',
        },
      });
      expect(sale.isOnCredit, isTrue);
      expect(sale.paidAtSaleCents, 2000);
      expect(sale.creditBalanceCents, 2500);
      expect(sale.moneyReceivedBy, 'u-owner');
      expect(sale.credit!.customerName, 'Fatou');
      expect(sale.credit!.dueDate, '2026-10-30');
      expect(sale.creditOpen, isTrue);
    });

    test('an unknown status reads as none; a voided credit is owed nothing', () {
      final odd = InventorySale.fromMap('s3', {
        'creditStatus': 'weird',
        'creditCents': 100,
      });
      expect(odd.creditStatus, 'none');
      expect(odd.isOnCredit, isFalse);
      final voided = _sale('s4', credit: 4000, status: 'open', voided: true);
      expect(voided.creditOpen, isFalse);
      expect(
        inventoryCreditStanding(voided, today: _today),
        InventoryCreditStanding.none,
      );
    });

    test('the sale answer carries what is left owed (0 from an old server)', () {
      expect(
        InventorySaleResult.fromCallable({
          'saleId': 's',
          'totalCents': 6000,
          'creditCents': 4000,
        })!.creditCents,
        4000,
      );
      expect(
        InventorySaleResult.fromCallable({
          'saleId': 's',
          'totalCents': 6000,
        })!.creditCents,
        0,
      );
    });
  });

  group('checkout validation', () {
    test('a plain sale needs only a payment method', () {
      expect(
        validateInventoryCheckout(
          const InventoryCheckoutDraft(),
          totalCents: 6000,
          today: _today,
        ),
        isEmpty,
      );
      expect(
        validateInventoryCheckout(
          const InventoryCheckoutDraft(paymentMethod: 'bitcoin'),
          totalCents: 6000,
          today: _today,
        ),
        ['payment_method_invalid'],
      );
    });

    test('received by must be someone in the business (when the team is known)',
        () {
      const draft = InventoryCheckoutDraft(receivedByStaffId: 'u-stranger');
      expect(
        validateInventoryCheckout(
          draft,
          totalCents: 6000,
          staffIds: const ['u-ama', 'u-owner'],
          today: _today,
        ),
        ['received_by_invalid'],
      );
      // The team could not be read: the server decides.
      expect(
        validateInventoryCheckout(draft, totalCents: 6000, today: _today),
        isEmpty,
      );
      // The owner, added by withBusinessOwner, is fine.
      expect(
        validateInventoryCheckout(
          const InventoryCheckoutDraft(receivedByStaffId: 'u-owner'),
          totalCents: 6000,
          staffIds: const ['u-ama', 'u-owner'],
          today: _today,
        ),
        isEmpty,
      );
    });

    test('a complete credit checkout passes', () {
      expect(
        validateInventoryCheckout(
          _credit,
          totalCents: 6000,
          staffIds: const ['u-ama'],
          today: _today,
        ),
        isEmpty,
      );
    });

    test('credit asks for every part, all at once', () {
      final codes = validateInventoryCheckout(
        const InventoryCheckoutDraft(onCredit: true, customerPhone: '+1'),
        totalCents: 6000,
        today: _today,
      );
      // The phone is optional: the "+1" the field starts with is no phone.
      expect(codes, [
        'customer_name_required',
        'collector_required',
      ]);
    });

    test('the customer phone is optional, but a typed one must be whole', () {
      List<String> phone(String typed) => validateInventoryCheckout(
            _credit.copyWith(customerPhone: typed),
            totalCents: 6000,
            today: _today,
          );
      expect(phone(''), isEmpty);
      expect(phone('+1'), isEmpty);
      expect(phone('+224'), isEmpty);
      expect(phone('+1207555'), ['customer_phone_invalid']);
      expect(phone('+12075550100'), isEmpty);
      expect(inventoryCreditPhoneGiven('+1'), isFalse);
      expect(inventoryCreditPhoneGiven('+12075550100'), isTrue);
    });

    test('paid now: blank is nothing, never the whole total, never unreadable',
        () {
      List<String> paid(String typed, {int total = 6000}) =>
          validateInventoryCheckout(
            _credit.copyWith(paidNow: typed),
            totalCents: total,
            today: _today,
          );
      expect(paid(''), isEmpty);
      expect(paid('0'), isEmpty);
      expect(paid('59.99'), isEmpty);
      expect(paid('60'), ['paid_now_too_large']);
      expect(paid('75'), ['paid_now_too_large']);
      expect(paid('abc'), ['paid_now_invalid']);
      expect(paid('-5'), ['paid_now_invalid']);
      // A giveaway (total 0) cannot be put on credit.
      expect(paid('', total: 0), ['paid_now_too_large']);
    });

    test('nothing paid now: no payment method is needed', () {
      expect(
        validateInventoryCheckout(
          _credit.copyWith(paidNow: '', paymentMethod: 'nonsense'),
          totalCents: 6000,
          today: _today,
        ),
        isEmpty,
      );
      expect(
        validateInventoryCheckout(
          _credit.copyWith(paidNow: '10', paymentMethod: 'nonsense'),
          totalCents: 6000,
          today: _today,
        ),
        ['payment_method_invalid'],
      );
    });

    test('the phone must be a full international number', () {
      expect(
        validateInventoryCheckout(
          _credit.copyWith(customerPhone: '5550100'),
          totalCents: 6000,
          today: _today,
        ),
        ['customer_phone_invalid'],
      );
      expect(
        validateInventoryCheckout(
          _credit.copyWith(customerPhone: '+224 620 00 00 00'),
          totalCents: 6000,
          today: _today,
        ),
        isEmpty,
      );
    });

    test('collector must be in the business; due date today or later', () {
      expect(
        validateInventoryCheckout(
          _credit.copyWith(collectorStaffId: 'u-gone'),
          totalCents: 6000,
          staffIds: const ['u-ama'],
          today: _today,
        ),
        ['collector_invalid'],
      );
      List<String> due(String day) => validateInventoryCheckout(
        _credit.copyWith(dueDate: day),
        totalCents: 6000,
        today: _today,
      );
      expect(due(''), isEmpty);
      expect(due('2026-10-16'), isEmpty, reason: 'today is fine');
      expect(due('2026-10-15'), ['due_date_invalid']);
      expect(due('2026-02-30'), ['due_date_invalid']);
      expect(due('10/30/2026'), ['due_date_invalid']);
    });
  });

  group('checkout request', () {
    test('split and the credit object', () {
      expect(
        inventoryCheckoutSplit(6000, _credit),
        (paidNowCents: 2000, creditCents: 4000),
      );
      expect(
        inventoryCheckoutSplit(6000, const InventoryCheckoutDraft()),
        (paidNowCents: 6000, creditCents: 0),
      );
      expect(inventoryCreditRequest(6000, const InventoryCheckoutDraft()),
          isNull);
      expect(
        inventoryCreditRequest(
          6000,
          _credit.copyWith(customerPhone: '+1 (212) 555-0100'),
        ),
        {
          'paidNowCents': 2000,
          'customerName': 'Fatou Diallo',
          'customerPhone': '+12125550100',
          'collectorStaffId': 'u-ama',
          'dueDate': '2026-10-30',
        },
      );
    });

    test('the sale request: received by only when someone, method only when '
        'money is taken now', () {
      final basket = const Basket().addScan(
        const InventoryItem(
          id: 'i1',
          businessId: 'b1',
          name: 'Soap',
          code: 'IT-K7M4P2',
          priceCents: 6000,
        ),
      );
      final plain = recordInventorySaleRequest(
        businessId: 'b1',
        clientRequestId: 'r1',
        paymentMethod: 'cash',
        basket: basket,
      );
      expect(plain.containsKey('receivedByStaffId'), isFalse);
      expect(plain.containsKey('credit'), isFalse);
      expect(plain['paymentMethod'], 'cash');

      final nothingNow = recordInventorySaleRequest(
        businessId: 'b1',
        clientRequestId: 'r2',
        paymentMethod: 'cash',
        basket: basket,
        receivedByStaffId: 'u-owner',
        credit: inventoryCreditRequest(6000, _credit.copyWith(paidNow: '')),
      );
      expect(nothingNow['receivedByStaffId'], 'u-owner');
      expect(nothingNow.containsKey('paymentMethod'), isFalse);
      expect((nothingNow['credit'] as Map)['paidNowCents'], 0);

      final partNow = recordInventorySaleRequest(
        businessId: 'b1',
        clientRequestId: 'r3',
        paymentMethod: 'zelle',
        basket: basket,
        credit: inventoryCreditRequest(6000, _credit),
      );
      expect(partNow['paymentMethod'], 'zelle');
    });

    test('changing the credit terms is another sale (a fresh retry id)', () {
      var n = 0;
      final attempt = SaleAttempt(newId: () => 'id-${++n}');
      const basket = Basket();
      final first = attempt.idFor(basket, 'cash', details: _credit.signature);
      expect(attempt.idFor(basket, 'cash', details: _credit.signature), first);
      expect(
        attempt.idFor(
          basket,
          'cash',
          details: _credit.copyWith(paidNow: '25').signature,
        ),
        isNot(first),
      );
      // The phone's formatting is not a different sale.
      expect(
        _credit.copyWith(customerPhone: '+1 212 555 0100').signature,
        _credit.signature,
      );
    });
  });

  group('where a credit stands', () {
    test('open, overdue (due day itself is on time), paid', () {
      final open = _sale('a', credit: 4000, status: 'open', due: '2026-10-16');
      expect(
        inventoryCreditStanding(open, today: _today),
        InventoryCreditStanding.open,
      );
      final late = _sale('b', credit: 4000, status: 'open', due: '2026-10-15');
      expect(
        inventoryCreditStanding(late, today: _today),
        InventoryCreditStanding.overdue,
      );
      final paid = _sale('c', credit: 4000, creditPaid: 4000, status: 'paid');
      expect(
        inventoryCreditStanding(paid, today: _today),
        InventoryCreditStanding.paid,
      );
      // A status still "open" with nothing left reads paid.
      final settled = _sale('d', credit: 4000, creditPaid: 4000, status: 'open');
      expect(
        inventoryCreditStanding(settled, today: _today),
        InventoryCreditStanding.paid,
      );
    });

    test('the sales list credit filter', () {
      final sales = [
        _sale('plain'),
        _sale('open', credit: 4000, status: 'open'),
        _sale('paid', credit: 4000, creditPaid: 4000, status: 'paid'),
        _sale('void', credit: 4000, status: 'open', voided: true),
      ];
      List<String> ids(InventoryCreditFilter f) =>
          [for (final s in inventorySalesForCredit(sales, f)) s.id];
      expect(ids(InventoryCreditFilter.all), hasLength(4));
      expect(ids(InventoryCreditFilter.open), ['open']);
      expect(ids(InventoryCreditFilter.paid), ['paid']);
    });
  });

  group('the open-credit list', () {
    final sales = [
      _sale('later', credit: 1000, status: 'open', due: '2026-11-20',
          createdAt: DateTime(2026, 10, 1)),
      _sale('none', credit: 2000, status: 'open', collector: 'u-kofi',
          createdAt: DateTime(2026, 9, 1)),
      _sale('late', credit: 3000, creditPaid: 500, status: 'open',
          due: '2026-10-10', storeId: 's-bk'),
      _sale('soon', credit: 4000, status: 'open', due: '2026-10-20'),
      _sale('paid', credit: 4000, creditPaid: 4000, status: 'paid'),
      _sale('void', credit: 4000, status: 'open', voided: true),
      _sale('plain'),
    ];

    test('overdue first, then nearest due date, then no due date', () {
      expect(
        [for (final s in inventoryOpenCredits(sales, today: _today)) s.id],
        ['late', 'soon', 'later', 'none'],
      );
    });

    test('by collector and by store (an old sale counts in every store)', () {
      expect(
        [
          for (final s in inventoryOpenCredits(
            sales,
            collectorId: 'u-kofi',
            today: _today,
          ))
            s.id,
        ],
        ['none'],
      );
      expect(
        [
          for (final s in inventoryOpenCredits(
            sales,
            storeId: 's-main',
            today: _today,
          ))
            s.id,
        ],
        ['soon', 'later', 'none'],
      );
    });

    test('totals: count, owed, overdue', () {
      final t = inventoryCreditTotals(
        inventoryOpenCredits(sales, today: _today),
        today: _today,
      );
      expect(t.count, 4);
      expect(t.owedCents, 1000 + 2000 + 2500 + 4000);
      expect(t.overdueCount, 1);
      expect(t.overdueCents, 2500);
      expect(inventoryCreditTotals(const [], today: _today).count, 0);
    });

    test('collectors with something open, and who starts on what', () {
      expect(inventoryCreditCollectors(sales), ['u-ama', 'u-kofi']);
      expect(
        inventoryCreditDefaultCollector(isOwner: true, currentUserId: 'u-x'),
        '',
      );
      expect(
        inventoryCreditDefaultCollector(isOwner: false, currentUserId: 'u-x'),
        'u-x',
      );
    });
  });

  group('later payments', () {
    test('the same rules as a package payment, against the balance', () {
      List<String> pay(String amount, {String by = 'u-ama'}) =>
          validateInventoryCreditPayment(
            amount: amount,
            method: 'cash',
            creditCents: 4000,
            creditPaidCents: 1500,
            receivedByStaffId: by,
            staffIds: const ['u-ama'],
          );
      expect(pay('25'), isEmpty);
      expect(pay('10.50'), isEmpty, reason: 'partial is fine');
      expect(pay('25.01'), ['payment_exceeds_balance']);
      expect(pay(''), ['amount_required']);
      expect(pay('20', by: ''), ['received_by_required']);
      expect(pay('20', by: 'u-other'), ['received_by_invalid']);
    });

    test('requests', () {
      expect(
        recordInventoryCreditPaymentRequest(
          businessId: 'b1',
          saleId: 's1',
          amountCents: 2500,
          method: 'zelle',
          receivedByStaffId: 'u-ama',
          note: '  ',
        ),
        {
          'businessId': 'b1',
          'saleId': 's1',
          'amountCents': 2500,
          'method': 'zelle',
          'receivedByStaffId': 'u-ama',
        },
      );
      expect(
        revertInventoryCreditPaymentRequest('b1', 'p1'),
        {'businessId': 'b1', 'paymentId': 'p1'},
      );
      expect(
        setInventoryCreditCollectorRequest(
          businessId: 'b1',
          saleId: 's1',
          collectorStaffId: 'u-kofi',
        ),
        {'businessId': 'b1', 'saleId': 's1', 'collectorStaffId': 'u-kofi'},
      );
      expect(
        setInventoryCreditCollectorRequest(
          businessId: 'b1',
          saleId: 's1',
          collectorStaffId: 'u-kofi',
          dueDate: '',
        )['dueDate'],
        '',
      );
    });

    test('payment rows and answers', () {
      final row = InventoryCreditPayment.fromMap('p1', {
        'amountCents': 2500,
        'method': 'cash',
        'receivedByStaffId': 'u-ama',
        'recordedByStaffId': 'u-owner',
        'reverted': true,
        'revertedByStaffId': 'u-owner',
      });
      expect(row.amountCents, 2500);
      expect(row.reverted, isTrue);
      final sorted = sortCreditPaymentsNewestFirst([
        InventoryCreditPayment(
          id: 'old',
          amountCents: 1,
          createdAt: DateTime(2026, 10, 1),
        ),
        const InventoryCreditPayment(id: 'pending', amountCents: 1),
        InventoryCreditPayment(
          id: 'new',
          amountCents: 1,
          createdAt: DateTime(2026, 10, 9),
        ),
      ]);
      expect([for (final p in sorted) p.id], ['pending', 'new', 'old']);
      final answer = InventoryCreditPaymentResult.fromCallable({
        'success': true,
        'paymentId': 'p9',
        'creditPaidCents': 4000,
        'creditStatus': 'paid',
      });
      expect(answer.creditPaidCents, 4000);
      expect(answer.creditStatus, 'paid');
      expect(InventoryCreditPaymentResult.fromCallable(null).creditPaidCents,
          isNull);
    });
  });

  test('the new refusal codes map to their own failures', () {
    InventoryFailure of(String reason) => inventoryFailureOf(
      code: 'failed-precondition',
      details: {'reason': reason},
    );
    expect(of('received_by_invalid'), InventoryFailure.receivedByInvalid);
    expect(
      of('credit_customer_required'),
      InventoryFailure.creditCustomerRequired,
    );
    expect(of('collector_invalid'), InventoryFailure.collectorInvalid);
    expect(of('due_date_invalid'), InventoryFailure.dueDateInvalid);
    expect(
      of('payment_exceeds_balance'),
      InventoryFailure.paymentExceedsBalance,
    );
    expect(of('no_credit'), InventoryFailure.noCredit);
    expect(of('credit_has_payments'), InventoryFailure.creditHasPayments);
    expect(of('sale_voided'), InventoryFailure.saleVoided);
    expect(of('credit_invalid'), InventoryFailure.creditInvalid);
    expect(of('paid_now_invalid'), InventoryFailure.paidNowInvalid);
    expect(
      of('customer_phone_invalid'),
      InventoryFailure.customerPhoneInvalid,
    );
    expect(of('amount_invalid'), InventoryFailure.amountInvalid);
    expect(
      inventoryFailureOf(
        code: 'not-found',
        details: {'reason': 'payment_not_found'},
      ),
      InventoryFailure.paymentNotFound,
    );
    expect(of('payment_already_reverted'), InventoryFailure.paymentReverted);
    // Several codes at once: any of ours names it.
    expect(
      inventoryFailureOf(
        code: 'invalid-argument',
        details: {
          'reason': 'lines_required',
          'reasons': ['lines_required', 'collector_invalid'],
        },
      ),
      InventoryFailure.collectorInvalid,
    );
  });
}
