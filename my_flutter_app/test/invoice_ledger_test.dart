import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/invoice_ledger.dart';

Invoice inv({
  String id = 'i1',
  String number = 'INV-0007',
  String title = 'Corolla',
  String customer = 'Amadou Bah',
  String status = invoiceStatusOpen,
  String issuedOn = '2026-09-26',
  String dueOn = '2026-10-15',
}) =>
    Invoice.fromMap(id, {
      'businessId': 'b1',
      'number': number,
      'title': title,
      'customerName': customer,
      'status': status,
      'issuedOn': issuedOn,
      'dueOn': dueOn,
    });

void main() {
  group('an invoice', () {
    test('needs a title and a customer; dates must be real and in order', () {
      expect(validateInvoice(const InvoiceDraft()),
          ['title_required', 'customer_name_required']);
      expect(
          validateInvoice(
              const InvoiceDraft(title: 'Corolla', customerName: 'Amadou')),
          isEmpty);
      expect(
          validateInvoice(const InvoiceDraft(
              title: 'x', customerName: 'y', issuedOn: '2026-02-30')),
          ['issued_on_invalid']);
      expect(
          validateInvoice(const InvoiceDraft(
              title: 'x',
              customerName: 'y',
              issuedOn: '2026-09-20',
              dueOn: '2026-09-01')),
          ['due_before_issued']);
    });

    test('dates are calendar days', () {
      expect(invoiceDayKey('2026-10-15T12:00:00'), '2026-10-15');
      expect(invoiceDayKey(DateTime.utc(2026, 9, 1, 23)), '2026-09-01');
      expect(invoiceDayKey(''), '');
    });
  });

  group('a line', () {
    test('is typed in dollars and sent in cents, amount worked out server-side',
        () {
      expect(invoiceDollarsToCents('1,250.50'), 125050);
      expect(invoiceDollarsToCents(r'$120'), 12000);
      expect(invoiceDollarsToCents('abc'), isNull);
      expect(invoiceCentsToInput(12000), '120');
      expect(invoiceCentsToInput(12050), '120.50');
      expect(validateInvoiceLine(const InvoiceLineDraft()),
          ['description_required', 'unit_price_invalid']);
      expect(
          invoiceLinePayload(const InvoiceLineDraft(
              description: ' Barrels ', quantity: 8, unitPriceCents: 12000)),
          {
            'description': 'Barrels',
            'quantity': 8,
            'unitPriceCents': 12000,
            'vinNumber': ''
          });
    });

    test('keeps a VIN only when it is a whole one', () {
      expect(
          validateInvoiceLine(const InvoiceLineDraft(
              description: 'Corolla',
              unitPriceCents: 550000,
              vinNumber: '1hgcm82633a004352')),
          isEmpty);
      expect(
          validateInvoiceLine(const InvoiceLineDraft(
              description: 'Corolla', unitPriceCents: 1, vinNumber: 'ABC')),
          ['vin_invalid']);
      expect(
          invoiceLinePayload(const InvoiceLineDraft(
              description: 'c',
              unitPriceCents: 1,
              vinNumber: ' 1hgcm82633a004352 '))['vinNumber'],
          '1HGCM82633A004352');
    });
  });

  group('a payment', () {
    test('must fit the balance and say how it arrived', () {
      expect(validateInvoicePayment(const InvoicePaymentDraft(), 10000),
          ['amount_required']);
      expect(
          validateInvoicePayment(
              const InvoicePaymentDraft(amountCents: 20000), 10000),
          ['payment_exceeds_balance']);
      expect(
          validateInvoicePayment(
              const InvoicePaymentDraft(amountCents: 100, method: 'wire'),
              10000),
          ['payment_method_invalid']);
      expect(
          validateInvoicePayment(
              const InvoicePaymentDraft(amountCents: 10000, method: 'zelle'),
              10000),
          isEmpty);
    });
  });

  group('what the invoice adds up to', () {
    final lines = [
      InvoiceLine.fromMap('l1', {'amountCents': 550000}),
      InvoiceLine.fromMap('l2', {'amountCents': 5000}),
    ];
    test('is total minus the payments that still stand', () {
      final t = invoiceTotals(lines, [
        InvoicePayment.fromMap('p1', {'amountCents': 200000}),
        InvoicePayment.fromMap('p2', {'amountCents': 100000, 'reverted': true}),
      ]);
      expect(t.totalCents, 555000);
      expect(t.paidCents, 200000);
      expect(t.balanceCents, 355000);
      expect(t.paymentCount, 1);
      expect(t.status, invoiceStatusOpen);
    });

    test('is paid when nothing is owed; a blank invoice is never paid', () {
      expect(
          invoiceTotals(
              lines, [InvoicePayment.fromMap('p', {'amountCents': 555000})])
              .status,
          invoiceStatusPaid);
      expect(invoiceTotals(const [], const []).status, invoiceStatusOpen);
    });

    test('overdue only while open and past the due day', () {
      expect(invoiceIsOverdue(inv(dueOn: '2026-09-20'), '2026-09-26'), isTrue);
      expect(invoiceIsOverdue(inv(dueOn: '2026-09-26'), '2026-09-26'), isFalse);
      expect(
          invoiceIsOverdue(
              inv(status: invoiceStatusPaid, dueOn: '2026-09-20'), '2026-09-26'),
          isFalse);
      expect(invoiceIsOverdue(inv(dueOn: ''), '2026-09-26'), isFalse);
    });

    test('the list filters and sorts like the console', () {
      final rows = [
        inv(id: 'a', number: 'INV-0001', issuedOn: '2026-09-01', dueOn: '2026-09-20'),
        inv(id: 'b', number: 'INV-0002', title: 'Barrels', customer: 'Fatou',
            status: invoiceStatusPaid, issuedOn: '2026-09-10', dueOn: ''),
        inv(id: 'c', number: 'INV-0003', title: 'Tyres', issuedOn: '2026-09-10', dueOn: ''),
      ];
      List<String> ids(String f, String q) =>
          filterInvoices(rows, f, q, '2026-09-26').map((r) => r.id).toList();
      expect(ids(invoiceFilterOpen, ''), ['a', 'c']);
      expect(ids(invoiceFilterPaid, ''), ['b']);
      expect(ids(invoiceFilterOverdue, ''), ['a']);
      expect(ids(invoiceFilterAll, 'amadou'), ['a', 'c']);
      expect(ids(invoiceFilterAll, '0002'), ['b']);
      expect(sortInvoices(rows).map((r) => r.id).toList(), ['c', 'b', 'a']);
    });
  });

  test('the WhatsApp text mirrors the server byte for byte', () {
    final txt = invoiceTextSummary(
      businessName: 'Keren Auto Sales',
      invoice: inv(),
      lines: [
        InvoiceLine.fromMap('l1', {
          'description': '2014 Toyota Corolla',
          'quantity': 1,
          'unitPriceCents': 550000,
          'amountCents': 550000,
          'vinNumber': '1HGCM82633A004352',
        }),
        InvoiceLine.fromMap('l2', {
          'description': 'Barrels',
          'quantity': 8,
          'unitPriceCents': 12000,
          'amountCents': 96000,
        }),
      ],
      payments: [
        InvoicePayment.fromMap('p1', {
          'amountCents': 200000,
          'paidOn': '2026-09-26',
          'method': 'zelle',
          'forDescription': '2014 Toyota Corolla',
        })
      ],
    );
    expect(txt, [
      'Keren Auto Sales — Invoice INV-0007',
      'Corolla · 2026-09-26',
      'For: Amadou Bah',
      '',
      '2014 Toyota Corolla — \$5,500.00\nVIN 1HGCM82633A004352',
      'Barrels (8 × \$120.00) — \$960.00',
      '',
      'Total: \$6,460.00',
      'Paid: -\$2,000.00',
      '  2026-09-26 · zelle · for 2014 Toyota Corolla — \$2,000.00',
      'BALANCE DUE: \$4,460.00 (due 2026-10-15)',
    ].join('\n'));
  });
}
