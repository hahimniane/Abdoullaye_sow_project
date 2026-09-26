/// Invoices and receipts a business writes by hand. Mirrors
/// `functions/invoice_ledger.js`: the same checks the server runs, so the
/// sheet refuses what the callable would refuse, and the same totals, so the
/// phone never shows a number the server would not.
library;

import 'package:intl/intl.dart';

import 'lot_ledger.dart' show lotDateOf;

const invoiceStatusOpen = 'open';
const invoiceStatusPaid = 'paid';

/// How a hand-recorded payment arrived. Same vocabulary as the server.
const invoicePaymentMethods = <String>[
  'cash',
  'zelle',
  'cashapp',
  'venmo',
  'check',
  'card_in_person',
  'other',
];

const invoiceMaxText = 200;
const invoiceMaxNotes = 1000;
const invoiceMaxVin = 17;
const invoiceMaxQuantity = 10000;
const invoiceMaxCents = 100000000;

String _text(Object? v, [int max = invoiceMaxText]) {
  final t = (v ?? '').toString().trim();
  return t.length > max ? t.substring(0, max) : t;
}

int _positiveInt(Object? v) {
  final n = v is num ? v.truncate() : int.tryParse((v ?? '').toString().trim());
  return n != null && n > 0 ? n : 0;
}

int? _cents(Object? v) {
  if (v is num) return v.round();
  return int.tryParse((v ?? '').toString().trim());
}

/// "YYYY-MM-DD" or "" - invoice dates are calendar days with no clock.
String invoiceDayKey(Object? value) {
  if (value == null) return '';
  if (value is String) {
    final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})').firstMatch(value.trim());
    if (m == null) return '';
    final probe = DateTime.tryParse('${m[1]}-${m[2]}-${m[3]}T00:00:00Z');
    if (probe == null) return '';
    final day = probe.toIso8601String().substring(0, 10);
    return day == '${m[1]}-${m[2]}-${m[3]}' ? day : '';
  }
  final date = lotDateOf(value);
  return date == null ? '' : date.toUtc().toIso8601String().substring(0, 10);
}

String invoiceTodayKey([DateTime? now]) =>
    DateFormat('yyyy-MM-dd').format(now ?? DateTime.now());

// ---------------------------------------------------------------------------
// The invoice.
// ---------------------------------------------------------------------------

class InvoiceDraft {
  const InvoiceDraft({
    this.title = '',
    this.customerName = '',
    this.customerPhone = '',
    this.customerEmail = '',
    this.issuedOn = '',
    this.dueOn = '',
    this.notes = '',
  });

  final String title;
  final String customerName;
  final String customerPhone;
  final String customerEmail;
  final String issuedOn;
  final String dueOn;
  final String notes;
}

/// Error codes. Mirrors `validateInvoice`.
List<String> validateInvoice(InvoiceDraft d) {
  final errors = <String>[];
  if (_text(d.title).isEmpty) errors.add('title_required');
  if (_text(d.customerName).isEmpty) errors.add('customer_name_required');
  final issued = _text(d.issuedOn, 40);
  final issuedDay = invoiceDayKey(issued);
  if (issued.isNotEmpty && issuedDay.isEmpty) errors.add('issued_on_invalid');
  final due = _text(d.dueOn, 40);
  final dueDay = invoiceDayKey(due);
  if (due.isNotEmpty && dueDay.isEmpty) errors.add('due_on_invalid');
  if (issuedDay.isNotEmpty &&
      dueDay.isNotEmpty &&
      dueDay.compareTo(issuedDay) < 0) {
    errors.add('due_before_issued');
  }
  return errors;
}

/// The body `createInvoice` / `updateInvoice` take.
Map<String, dynamic> invoicePayload(InvoiceDraft d) => {
      'title': _text(d.title),
      'customerName': _text(d.customerName),
      'customerPhone': _text(d.customerPhone, 40),
      'customerEmail': _text(d.customerEmail, 180),
      'issuedOn': invoiceDayKey(d.issuedOn),
      'dueOn': invoiceDayKey(d.dueOn),
      'notes': _text(d.notes, invoiceMaxNotes),
    };

// ---------------------------------------------------------------------------
// Lines.
// ---------------------------------------------------------------------------

class InvoiceLineDraft {
  const InvoiceLineDraft({
    this.description = '',
    this.quantity = 1,
    this.unitPriceCents,
    this.vinNumber = '',
  });

  final String description;
  final int quantity;

  /// Null when nothing usable was typed.
  final int? unitPriceCents;
  final String vinNumber;
}

/// "1,250.50" or "$120" as typed → cents, or null when it is not a number.
int? invoiceDollarsToCents(String value) {
  final cleaned = value.replaceAll(RegExp(r'[$,\s]'), '');
  if (cleaned.isEmpty) return null;
  final n = double.tryParse(cleaned);
  return n == null ? null : (n * 100).round();
}

String invoiceCentsToInput(int cents) =>
    cents % 100 == 0 ? '${cents ~/ 100}' : (cents / 100).toStringAsFixed(2);

String _cleanVin(String v) =>
    v.toUpperCase().replaceAll(RegExp(r'[^A-Z0-9]'), '');

/// Error codes. Mirrors `validateInvoiceLine`.
List<String> validateInvoiceLine(InvoiceLineDraft d) {
  final errors = <String>[];
  if (_text(d.description).isEmpty) errors.add('description_required');
  final quantity = _positiveInt(d.quantity);
  if (quantity <= 0) errors.add('quantity_required');
  final unit = d.unitPriceCents;
  if (unit == null || unit < 0) errors.add('unit_price_invalid');
  if (unit != null &&
      unit >= 0 &&
      (quantity > invoiceMaxQuantity ? invoiceMaxQuantity : quantity) * unit >
          invoiceMaxCents) {
    errors.add('amount_too_large');
  }
  final vin = _cleanVin(_text(d.vinNumber, 40));
  if (vin.isNotEmpty && vin.length != invoiceMaxVin) errors.add('vin_invalid');
  return errors;
}

Map<String, dynamic> invoiceLinePayload(InvoiceLineDraft d) {
  final quantity = _positiveInt(d.quantity);
  final vin = _cleanVin(_text(d.vinNumber, 40));
  return {
    'description': _text(d.description),
    'quantity': quantity > invoiceMaxQuantity ? invoiceMaxQuantity : quantity,
    'unitPriceCents': (d.unitPriceCents ?? 0) < 0 ? 0 : (d.unitPriceCents ?? 0),
    'vinNumber': vin.length > invoiceMaxVin ? vin.substring(0, invoiceMaxVin) : vin,
  };
}

// ---------------------------------------------------------------------------
// Payments.
// ---------------------------------------------------------------------------

class InvoicePaymentDraft {
  const InvoicePaymentDraft({
    this.amountCents,
    this.method = 'cash',
    this.paidOn = '',
    this.note = '',
  });

  final int? amountCents;
  final String method;
  final String paidOn;
  final String note;
}

/// Error codes. Mirrors `validateInvoicePayment`.
List<String> validateInvoicePayment(InvoicePaymentDraft d, int balanceCents) {
  final errors = <String>[];
  final amount = d.amountCents;
  if (amount == null || amount <= 0) {
    errors.add('amount_required');
  } else if (amount > invoiceMaxCents) {
    errors.add('amount_too_large');
  } else if (amount > (balanceCents < 0 ? 0 : balanceCents)) {
    errors.add('payment_exceeds_balance');
  }
  if (!invoicePaymentMethods.contains(_text(d.method, 40))) {
    errors.add('payment_method_invalid');
  }
  final paidOn = _text(d.paidOn, 40);
  if (paidOn.isNotEmpty && invoiceDayKey(paidOn).isEmpty) {
    errors.add('paid_on_invalid');
  }
  return errors;
}

Map<String, dynamic> invoicePaymentPayload(InvoicePaymentDraft d) => {
      'amountCents': d.amountCents ?? 0,
      'method': _text(d.method, 40),
      'paidOn': invoiceDayKey(d.paidOn),
      'note': _text(d.note),
    };

// ---------------------------------------------------------------------------
// Stored records.
// ---------------------------------------------------------------------------

class Invoice {
  const Invoice({
    required this.id,
    required this.businessId,
    required this.number,
    required this.title,
    required this.customerName,
    required this.customerPhone,
    required this.customerEmail,
    required this.issuedOn,
    required this.dueOn,
    required this.paidOn,
    required this.notes,
    required this.status,
    required this.totalCents,
    required this.paidCents,
    required this.balanceCents,
    required this.lineCount,
    required this.paymentCount,
    required this.createdByStaffId,
    required this.createdAt,
  });

  final String id;
  final String businessId;
  final String number;
  final String title;
  final String customerName;
  final String customerPhone;
  final String customerEmail;
  final String issuedOn;
  final String dueOn;
  final String paidOn;
  final String notes;
  final String status;
  final int totalCents;
  final int paidCents;
  final int balanceCents;
  final int lineCount;
  final int paymentCount;
  final String createdByStaffId;
  final DateTime? createdAt;

  bool get isPaid => status == invoiceStatusPaid;
  bool get isOpen => !isPaid;

  /// "INV-0007 · Corolla".
  String get displayName =>
      [number, title].where((p) => p.isNotEmpty).join(' · ');

  factory Invoice.fromMap(String id, Map<String, dynamic> d) => Invoice(
        id: id,
        businessId: _text(d['businessId']),
        number: _text(d['number'], 20),
        title: _text(d['title']),
        customerName: _text(d['customerName']),
        customerPhone: _text(d['customerPhone'], 40),
        customerEmail: _text(d['customerEmail'], 180),
        issuedOn: invoiceDayKey(d['issuedOn']),
        dueOn: invoiceDayKey(d['dueOn']),
        paidOn: invoiceDayKey(d['paidOn']),
        notes: _text(d['notes'], invoiceMaxNotes),
        status: _text(d['status'], 20) == invoiceStatusPaid
            ? invoiceStatusPaid
            : invoiceStatusOpen,
        totalCents: _cents(d['totalCents']) ?? 0,
        paidCents: _cents(d['paidCents']) ?? 0,
        balanceCents: _cents(d['balanceCents']) ?? 0,
        lineCount: _positiveInt(d['lineCount']),
        paymentCount: _positiveInt(d['paymentCount']),
        createdByStaffId: _text(d['createdByStaffId']),
        createdAt: lotDateOf(d['createdAt']),
      );
}

class InvoiceLine {
  const InvoiceLine({
    required this.id,
    required this.invoiceId,
    required this.description,
    required this.quantity,
    required this.unitPriceCents,
    required this.amountCents,
    required this.vinNumber,
    required this.addedByStaffId,
    required this.createdAt,
  });

  final String id;
  final String invoiceId;
  final String description;
  final int quantity;
  final int unitPriceCents;
  final int amountCents;
  final String vinNumber;
  final String addedByStaffId;
  final DateTime? createdAt;

  factory InvoiceLine.fromMap(String id, Map<String, dynamic> d) => InvoiceLine(
        id: id,
        invoiceId: _text(d['invoiceId']),
        description: _text(d['description']),
        quantity: _positiveInt(d['quantity']) == 0 ? 1 : _positiveInt(d['quantity']),
        unitPriceCents: _cents(d['unitPriceCents']) ?? 0,
        amountCents: _cents(d['amountCents']) ?? 0,
        vinNumber: _cleanVin(_text(d['vinNumber'], 40)),
        addedByStaffId: _text(d['addedByStaffId']),
        createdAt: lotDateOf(d['createdAt']),
      );
}

class InvoicePayment {
  const InvoicePayment({
    required this.id,
    required this.invoiceId,
    required this.amountCents,
    required this.method,
    required this.paidOn,
    required this.note,
    required this.reverted,
    required this.receivedByStaffId,
    required this.createdAt,
  });

  final String id;
  final String invoiceId;
  final int amountCents;
  final String method;
  final String paidOn;
  final String note;
  final bool reverted;
  final String receivedByStaffId;
  final DateTime? createdAt;

  factory InvoicePayment.fromMap(String id, Map<String, dynamic> d) =>
      InvoicePayment(
        id: id,
        invoiceId: _text(d['invoiceId']),
        amountCents: _cents(d['amountCents']) ?? 0,
        method: _text(d['method'], 40),
        paidOn: invoiceDayKey(d['paidOn']),
        note: _text(d['note']),
        reverted: d['reverted'] == true,
        receivedByStaffId: _text(d['receivedByStaffId']),
        createdAt: lotDateOf(d['createdAt']),
      );
}

// ---------------------------------------------------------------------------
// What it adds up to.
// ---------------------------------------------------------------------------

class InvoiceTotals {
  const InvoiceTotals({
    required this.totalCents,
    required this.paidCents,
    required this.balanceCents,
    required this.lineCount,
    required this.paymentCount,
    required this.status,
  });

  final int totalCents;
  final int paidCents;
  final int balanceCents;
  final int lineCount;
  final int paymentCount;
  final String status;
}

/// Mirrors `invoiceTotals`: total minus the payments that still stand; paid
/// when nothing is owed - but a blank invoice is never paid.
InvoiceTotals invoiceTotals(
    Iterable<InvoiceLine> lines, Iterable<InvoicePayment> payments) {
  final rows = lines.toList();
  final standing = payments.where((p) => !p.reverted).toList();
  final total = rows.fold<int>(0, (s, l) => s + (l.amountCents < 0 ? 0 : l.amountCents));
  final paid = standing.fold<int>(0, (s, p) => s + (p.amountCents < 0 ? 0 : p.amountCents));
  final balance = total - paid < 0 ? 0 : total - paid;
  return InvoiceTotals(
    totalCents: total,
    paidCents: paid,
    balanceCents: balance,
    lineCount: rows.length,
    paymentCount: standing.length,
    status: rows.isNotEmpty && balance == 0 ? invoiceStatusPaid : invoiceStatusOpen,
  );
}

/// Overdue is a fact about an open invoice with a due day behind today.
bool invoiceIsOverdue(Invoice invoice, [String? today]) {
  final t = today ?? invoiceTodayKey();
  return invoice.isOpen && invoice.dueOn.isNotEmpty && invoice.dueOn.compareTo(t) < 0;
}

/// "$1,250.50", never rounded away.
String invoiceMoney(int cents) {
  final whole = NumberFormat('#,##0', 'en_US').format(cents.abs() ~/ 100);
  final part = (cents.abs() % 100).toString().padLeft(2, '0');
  return '${cents < 0 ? '-' : ''}\$$whole.$part';
}

/// Newest invoice date first, then by number, so today's work is on top.
List<Invoice> sortInvoices(Iterable<Invoice> rows) => rows.toList()
  ..sort((a, b) {
    final byDay = b.issuedOn.compareTo(a.issuedOn);
    return byDay != 0 ? byDay : b.number.compareTo(a.number);
  });

const invoiceFilterAll = 'all';
const invoiceFilterOpen = 'open';
const invoiceFilterOverdue = 'overdue';
const invoiceFilterPaid = 'paid';
const invoiceFilters = <String>[
  invoiceFilterOpen,
  invoiceFilterOverdue,
  invoiceFilterPaid,
  invoiceFilterAll,
];

List<Invoice> filterInvoices(
  Iterable<Invoice> rows,
  String filter,
  String search, [
  String? today,
]) {
  final q = search.trim().toLowerCase();
  return [
    for (final row in rows)
      if ((filter != invoiceFilterOpen || row.isOpen) &&
          (filter != invoiceFilterPaid || row.isPaid) &&
          (filter != invoiceFilterOverdue || invoiceIsOverdue(row, today)) &&
          (q.isEmpty ||
              '${row.number} ${row.title} ${row.customerName} ${row.customerPhone}'
                  .toLowerCase()
                  .contains(q)))
        row,
  ];
}

/// The message pasted into WhatsApp beside the PDF. Mirrors the server's.
String invoiceTextSummary({
  required Invoice invoice,
  required List<InvoiceLine> lines,
  required List<InvoicePayment> payments,
  required String businessName,
}) {
  final totals = invoiceTotals(lines, payments);
  final kind = totals.status == invoiceStatusPaid ? 'Receipt' : 'Invoice';
  final out = <String>[
    '${businessName.trim().isEmpty ? 'Invoice' : businessName.trim()} — $kind'
        '${invoice.number.isNotEmpty ? ' ${invoice.number}' : ''}',
    '${invoice.title}${invoice.issuedOn.isNotEmpty ? ' · ${invoice.issuedOn}' : ''}',
    'For: ${invoice.customerName.isEmpty ? '—' : invoice.customerName}',
    '',
  ];
  for (final l in lines) {
    final each = l.quantity > 1
        ? ' (${l.quantity} × ${invoiceMoney(l.unitPriceCents)})'
        : '';
    out.add('${l.description}$each — ${invoiceMoney(l.amountCents)}'
        '${l.vinNumber.isNotEmpty ? '\nVIN ${l.vinNumber}' : ''}');
  }
  out
    ..add('')
    ..add('Total: ${invoiceMoney(totals.totalCents)}');
  if (totals.paidCents > 0) out.add('Paid: -${invoiceMoney(totals.paidCents)}');
  out.add(totals.balanceCents > 0
      ? 'BALANCE DUE: ${invoiceMoney(totals.balanceCents)}'
          '${invoice.dueOn.isNotEmpty ? ' (due ${invoice.dueOn})' : ''}'
      : 'PAID IN FULL');
  return out.join('\n');
}
