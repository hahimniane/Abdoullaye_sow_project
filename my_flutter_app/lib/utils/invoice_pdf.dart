/// The paper: an invoice or receipt as a PDF, built on the phone and handed
/// to the share sheet. Mirrors the console's `invoice-pdf.ts` so the same
/// invoice looks the same whichever device made it - the business's logo
/// when it can be fetched, its name, address and contact, "Invoice" while
/// money is owed and "Receipt" once it is not. Cost and margin never appear.
library;

import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../services/invoice_ledger.dart';

const _ink = PdfColor.fromInt(0xFF12211F);
const _muted = PdfColor.fromInt(0xFF5B6B68);
const _brand = PdfColor.fromInt(0xFF0D9488);
const _due = PdfColor.fromInt(0xFF92400E);
const _ok = PdfColor.fromInt(0xFF166534);
const _rule = PdfColor.fromInt(0xFFE6E9E8);

class InvoicePdfCopy {
  const InvoicePdfCopy({
    required this.invoice,
    required this.receipt,
    required this.billedTo,
    required this.date,
    required this.due,
    required this.paidOn,
    required this.description,
    required this.qty,
    required this.each,
    required this.amount,
    required this.total,
    required this.paid,
    required this.balanceDue,
    required this.paidInFull,
    required this.notes,
    required this.payments,
    required this.issuedBy,
    required this.customer,
    required this.footer,
    required this.methodLabel,
  });

  final String invoice;
  final String receipt;
  final String billedTo;
  final String date;
  final String due;
  final String paidOn;
  final String description;
  final String qty;
  final String each;
  final String amount;
  final String total;
  final String paid;
  final String balanceDue;
  final String paidInFull;
  final String notes;
  final String payments;
  final String issuedBy;
  final String customer;
  final String footer;
  final String Function(String method) methodLabel;
}

String invoiceBusinessAddress(Map<String, dynamic> business) {
  String t(Object? v) => (v ?? '').toString().trim();
  final region = [t(business['city']), t(business['state'])]
      .where((p) => p.isNotEmpty)
      .join(', ');
  final tail = [region, t(business['postalCode'])]
      .where((p) => p.isNotEmpty)
      .join(' ');
  return [
    t(business['addressLine1']),
    t(business['addressLine2']),
    tail,
    t(business['country']),
  ].where((p) => p.isNotEmpty).join(', ');
}

String invoiceFileName(Invoice invoice, String businessName) {
  String slug(String v) => v
      .replaceAll(RegExp(r'[^A-Za-z0-9]+'), '-')
      .replaceAll(RegExp(r'^-|-$'), '')
      .toLowerCase();
  return [
    invoice.isPaid ? 'receipt' : 'invoice',
    slug(invoice.number),
    slug(invoice.customerName),
    slug(businessName),
  ].where((p) => p.isNotEmpty).join('-');
}

Future<Uint8List> buildInvoicePdf({
  required Map<String, dynamic> business,
  required Invoice invoice,
  required List<InvoiceLine> lines,
  required List<InvoicePayment> payments,
  required InvoicePdfCopy copy,
}) async {
  String t(Object? v) => (v ?? '').toString().trim();
  final totals = invoiceTotals(lines, payments);
  final paid = totals.status == invoiceStatusPaid;
  final name = t(business['name']).isEmpty ? 'Laawol Digital' : t(business['name']);
  final logoUrl = t(business['logoUrl']).isNotEmpty
      ? t(business['logoUrl'])
      : t(business['profileImageUrl']);

  // A logo that cannot be fetched is left off, never a broken box.
  pw.ImageProvider? logo;
  if (logoUrl.startsWith('https://')) {
    try {
      logo = await networkImage(logoUrl);
    } catch (_) {
      logo = null;
    }
  }

  final address = invoiceBusinessAddress(business);
  final contact = [t(business['phone']), t(business['email'])]
      .where((p) => p.isNotEmpty)
      .join('  |  ');
  final standing = payments.where((p) => !p.reverted).toList();

  pw.Widget small(String text, {PdfColor color = _muted, double size = 8}) =>
      pw.Text(text.toUpperCase(),
          style: pw.TextStyle(fontSize: size, color: color, fontWeight: pw.FontWeight.bold));

  final doc = pw.Document(title: '${paid ? copy.receipt : copy.invoice} ${invoice.number}');
  doc.addPage(
    pw.MultiPage(
      pageFormat: PdfPageFormat.letter,
      margin: const pw.EdgeInsets.all(48),
      footer: (_) => pw.Center(
        child: pw.Text(copy.footer, style: const pw.TextStyle(fontSize: 8, color: _muted)),
      ),
      build: (context) => [
        pw.Row(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            if (logo != null)
              pw.Container(
                width: 44,
                height: 44,
                margin: const pw.EdgeInsets.only(right: 12),
                child: pw.ClipRRect(
                  horizontalRadius: 8,
                  verticalRadius: 8,
                  child: pw.Image(logo, fit: pw.BoxFit.cover),
                ),
              ),
            pw.Expanded(
              child: pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                  pw.Text(name,
                      style: pw.TextStyle(fontSize: 16, fontWeight: pw.FontWeight.bold, color: _ink)),
                  if (address.isNotEmpty)
                    pw.Text(address, style: const pw.TextStyle(fontSize: 9, color: _muted)),
                  if (contact.isNotEmpty)
                    pw.Text(contact, style: const pw.TextStyle(fontSize: 9, color: _muted)),
                ],
              ),
            ),
            pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.end,
              children: [
                pw.Text(paid ? copy.receipt : copy.invoice,
                    style: pw.TextStyle(fontSize: 22, fontWeight: pw.FontWeight.bold, color: _brand)),
                pw.Text(invoice.number,
                    style: pw.TextStyle(fontSize: 12, fontWeight: pw.FontWeight.bold, color: _ink)),
                pw.Text(invoice.title, style: const pw.TextStyle(fontSize: 10, color: _muted)),
              ],
            ),
          ],
        ),
        pw.Container(
          margin: const pw.EdgeInsets.symmetric(vertical: 12),
          height: 1.5,
          color: _brand,
        ),
        pw.Row(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            pw.Expanded(
              child: pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                  small(copy.billedTo),
                  pw.SizedBox(height: 4),
                  pw.Text(invoice.customerName.isEmpty ? '—' : invoice.customerName,
                      style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold, color: _ink)),
                  if ([invoice.customerPhone, invoice.customerEmail].any((p) => p.isNotEmpty))
                    pw.Text(
                      [invoice.customerPhone, invoice.customerEmail]
                          .where((p) => p.isNotEmpty)
                          .join('  |  '),
                      style: const pw.TextStyle(fontSize: 9.5, color: _muted),
                    ),
                ],
              ),
            ),
            pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.end,
              children: [
                pw.Row(mainAxisSize: pw.MainAxisSize.min, children: [
                  small(copy.date),
                  pw.SizedBox(width: 12),
                  pw.Text(invoice.issuedOn,
                      style: pw.TextStyle(fontSize: 10, fontWeight: pw.FontWeight.bold, color: _ink)),
                ]),
                if (paid && invoice.paidOn.isNotEmpty)
                  pw.Row(mainAxisSize: pw.MainAxisSize.min, children: [
                    small(copy.paidOn),
                    pw.SizedBox(width: 12),
                    pw.Text(invoice.paidOn,
                        style: pw.TextStyle(fontSize: 10, fontWeight: pw.FontWeight.bold, color: _ink)),
                  ])
                else if (invoice.dueOn.isNotEmpty)
                  pw.Row(mainAxisSize: pw.MainAxisSize.min, children: [
                    small(copy.due),
                    pw.SizedBox(width: 12),
                    pw.Text(invoice.dueOn,
                        style: pw.TextStyle(fontSize: 10, fontWeight: pw.FontWeight.bold, color: _ink)),
                  ]),
              ],
            ),
          ],
        ),
        pw.SizedBox(height: 20),
        pw.Table(
          columnWidths: const {
            0: pw.FlexColumnWidth(4),
            1: pw.FlexColumnWidth(0.8),
            2: pw.FlexColumnWidth(1.4),
            3: pw.FlexColumnWidth(1.5),
          },
          border: const pw.TableBorder(
            horizontalInside: pw.BorderSide(color: _rule, width: 0.5),
            bottom: pw.BorderSide(color: _rule, width: 0.5),
          ),
          children: [
            pw.TableRow(
              decoration: const pw.BoxDecoration(
                border: pw.Border(bottom: pw.BorderSide(color: _rule, width: 1)),
              ),
              children: [
                pw.Padding(padding: const pw.EdgeInsets.only(bottom: 6), child: small(copy.description)),
                pw.Padding(padding: const pw.EdgeInsets.only(bottom: 6), child: pw.Align(alignment: pw.Alignment.centerRight, child: small(copy.qty))),
                pw.Padding(padding: const pw.EdgeInsets.only(bottom: 6), child: pw.Align(alignment: pw.Alignment.centerRight, child: small(copy.each))),
                pw.Padding(padding: const pw.EdgeInsets.only(bottom: 6), child: pw.Align(alignment: pw.Alignment.centerRight, child: small(copy.amount))),
              ],
            ),
            for (final line in lines)
              pw.TableRow(children: [
                pw.Padding(
                  padding: const pw.EdgeInsets.symmetric(vertical: 7),
                  child: pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.start,
                    children: [
                      pw.Text(line.description, style: const pw.TextStyle(fontSize: 10.5, color: _ink)),
                      if (line.vinNumber.isNotEmpty)
                        pw.Text('VIN ${line.vinNumber}',
                            style: pw.TextStyle(fontSize: 8.5, color: _muted, font: pw.Font.courier())),
                    ],
                  ),
                ),
                pw.Padding(
                  padding: const pw.EdgeInsets.symmetric(vertical: 7),
                  child: pw.Text('${line.quantity}',
                      textAlign: pw.TextAlign.right, style: const pw.TextStyle(fontSize: 10.5, color: _ink)),
                ),
                pw.Padding(
                  padding: const pw.EdgeInsets.symmetric(vertical: 7),
                  child: pw.Text(invoiceMoney(line.unitPriceCents),
                      textAlign: pw.TextAlign.right, style: const pw.TextStyle(fontSize: 10.5, color: _ink)),
                ),
                pw.Padding(
                  padding: const pw.EdgeInsets.symmetric(vertical: 7),
                  child: pw.Text(invoiceMoney(line.amountCents),
                      textAlign: pw.TextAlign.right,
                      style: pw.TextStyle(fontSize: 10.5, fontWeight: pw.FontWeight.bold, color: _ink)),
                ),
              ]),
          ],
        ),
        pw.SizedBox(height: 14),
        pw.Align(
          alignment: pw.Alignment.centerRight,
          child: pw.SizedBox(
            width: 220,
            child: pw.Column(
              children: [
                _totalRow(copy.total, invoiceMoney(totals.totalCents)),
                if (totals.paidCents > 0)
                  _totalRow(copy.paid, '-${invoiceMoney(totals.paidCents)}', color: _ok),
                pw.Container(height: 1.2, color: _ink, margin: const pw.EdgeInsets.symmetric(vertical: 6)),
                _totalRow(
                  paid ? copy.paidInFull : copy.balanceDue,
                  invoiceMoney(paid ? 0 : totals.balanceCents),
                  bold: true,
                  color: paid ? _ok : _due,
                ),
              ],
            ),
          ),
        ),
        if (standing.isNotEmpty) ...[
          pw.SizedBox(height: 16),
          small(copy.payments),
          pw.SizedBox(height: 6),
          for (final p in standing)
            pw.Padding(
              padding: const pw.EdgeInsets.only(bottom: 4),
              child: pw.Row(
                mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                children: [
                  pw.Text(
                    '${p.paidOn}  ·  ${copy.methodLabel(p.method)}${p.note.isNotEmpty ? '  ·  ${p.note}' : ''}',
                    style: const pw.TextStyle(fontSize: 9.5, color: _ink),
                  ),
                  pw.Text(invoiceMoney(p.amountCents), style: const pw.TextStyle(fontSize: 9.5, color: _ink)),
                ],
              ),
            ),
        ],
        if (invoice.notes.isNotEmpty) ...[
          pw.SizedBox(height: 16),
          small(copy.notes),
          pw.SizedBox(height: 5),
          pw.Text(invoice.notes, style: const pw.TextStyle(fontSize: 9.5, color: _ink)),
        ],
        pw.SizedBox(height: 44),
        pw.Row(
          children: [
            pw.Expanded(child: _signature(name, copy.issuedBy)),
            pw.SizedBox(width: 24),
            pw.Expanded(child: _signature(invoice.customerName, copy.customer)),
          ],
        ),
      ],
    ),
  );
  return doc.save();
}

pw.Widget _totalRow(String label, String value, {bool bold = false, PdfColor? color}) {
  final style = pw.TextStyle(
    fontSize: bold ? 12 : 10,
    fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal,
    color: color ?? (bold ? _ink : _muted),
  );
  return pw.Padding(
    padding: const pw.EdgeInsets.symmetric(vertical: 3),
    child: pw.Row(
      mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
      children: [pw.Text(label, style: style), pw.Text(value, style: style)],
    ),
  );
}

pw.Widget _signature(String who, String label) => pw.Column(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        pw.Text(who, style: const pw.TextStyle(fontSize: 10, color: _ink)),
        pw.Container(height: 0.7, color: _ink, margin: const pw.EdgeInsets.only(top: 4, bottom: 4)),
        pw.Text(label, style: const pw.TextStyle(fontSize: 8, color: _muted)),
      ],
    );

/// Hand the file to the share sheet (WhatsApp is one tap away there).
Future<void> shareInvoicePdf(Uint8List bytes, String fileName) =>
    Printing.sharePdf(bytes: bytes, filename: '$fileName.pdf');
