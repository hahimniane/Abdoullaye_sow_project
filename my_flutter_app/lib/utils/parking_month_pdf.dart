/// Month-end parking papers, built on the phone: one car's bill for the
/// month, and the business's one-page summary of it. Mirrors the console's
/// `parking-month-pdf.ts`, with the same header as the invoices so a
/// customer who has had one recognises the other.
library;

import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../services/parking_month_statement.dart';
import 'invoice_pdf.dart' show invoiceBusinessAddress;

const _ink = PdfColor.fromInt(0xFF12211F);
const _muted = PdfColor.fromInt(0xFF5B6B68);
const _brand = PdfColor.fromInt(0xFF0D9488);
const _due = PdfColor.fromInt(0xFF92400E);
const _ok = PdfColor.fromInt(0xFF166534);
const _rule = PdfColor.fromInt(0xFFE6E9E8);

class ParkingMonthPdfCopy {
  const ParkingMonthPdfCopy({
    required this.bill,
    required this.summary,
    required this.monthLabel,
    required this.billedTo,
    required this.vehicle,
    required this.period,
    required this.parkingLine,
    required this.priorUnpaid,
    required this.paid,
    required this.balanceDue,
    required this.paidInFull,
    required this.stillParked,
    required this.left,
    required this.soFar,
    required this.carsOnLot,
    required this.billed,
    required this.collected,
    required this.owed,
    required this.whoOwes,
    required this.nobodyOwes,
    required this.daysLabel,
    required this.footer,
  });

  final String bill;
  final String summary;
  final String monthLabel;
  final String billedTo;
  final String vehicle;
  final String period;

  /// "Parking: 30 days × $15.00".
  final String Function(int days, String rate) parkingLine;
  final String priorUnpaid;
  final String paid;
  final String balanceDue;
  final String paidInFull;
  final String stillParked;
  final String left;
  final String soFar;
  final String carsOnLot;
  final String billed;
  final String collected;
  final String owed;
  final String whoOwes;
  final String nobodyOwes;
  final String Function(int days) daysLabel;
  final String footer;
}

String _t(Object? v) => (v ?? '').toString().trim();

Future<pw.Widget> _header(
  Map<String, dynamic> business,
  String kind,
  String title,
  String sub,
) async {
  final name = _t(business['name']).isEmpty ? 'Laawol Digital' : _t(business['name']);
  final logoUrl = _t(business['logoUrl']).isNotEmpty
      ? _t(business['logoUrl'])
      : _t(business['profileImageUrl']);
  pw.ImageProvider? logo;
  if (logoUrl.startsWith('https://')) {
    try {
      logo = await networkImage(logoUrl);
    } catch (_) {
      logo = null;
    }
  }
  final address = invoiceBusinessAddress(business);
  final contact = [_t(business['phone']), _t(business['email'])]
      .where((p) => p.isNotEmpty)
      .join('  |  ');
  return pw.Column(children: [
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
            pw.Text(kind,
                style: pw.TextStyle(fontSize: 20, fontWeight: pw.FontWeight.bold, color: _brand)),
            pw.Text(title,
                style: pw.TextStyle(fontSize: 12, fontWeight: pw.FontWeight.bold, color: _ink)),
            if (sub.isNotEmpty)
              pw.Text(sub, style: const pw.TextStyle(fontSize: 10, color: _muted)),
          ],
        ),
      ],
    ),
    pw.Container(
      margin: const pw.EdgeInsets.symmetric(vertical: 12),
      height: 1.5,
      color: _brand,
    ),
  ]);
}

pw.Widget _row(String label, String value, {bool bold = false, PdfColor? color}) {
  final style = pw.TextStyle(
    fontSize: bold ? 12 : 10.5,
    fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal,
    color: color ?? (bold ? _ink : _muted),
  );
  return pw.Padding(
    padding: const pw.EdgeInsets.symmetric(vertical: 4),
    child: pw.Row(
      mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
      children: [pw.Text(label, style: style), pw.Text(value, style: style)],
    ),
  );
}

pw.Widget _label(String text) => pw.Text(text.toUpperCase(),
    style: pw.TextStyle(fontSize: 8, color: _muted, fontWeight: pw.FontWeight.bold));

pw.Widget _footer(String text) => pw.Center(
      child: pw.Text(text, style: const pw.TextStyle(fontSize: 8, color: _muted)),
    );

Future<Uint8List> buildParkingMonthBillPdf({
  required Map<String, dynamic> business,
  required ParkingMonthBill bill,
  required ParkingMonthPdfCopy copy,
}) async {
  final b = bill;
  final head = await _header(business, copy.bill, copy.monthLabel, b.trackingCode);
  final doc = pw.Document(title: '${copy.bill} ${copy.monthLabel}');
  doc.addPage(pw.MultiPage(
    pageFormat: PdfPageFormat.letter,
    margin: const pw.EdgeInsets.all(48),
    footer: (_) => _footer(copy.footer),
    build: (_) => [
      head,
      pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
        pw.Expanded(
          child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
            _label(copy.billedTo),
            pw.SizedBox(height: 4),
            pw.Text(b.customerName.isEmpty ? '—' : b.customerName,
                style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold, color: _ink)),
            if ([b.customerPhone, b.customerEmail].any((p) => p.isNotEmpty))
              pw.Text(
                [b.customerPhone, b.customerEmail].where((p) => p.isNotEmpty).join('  |  '),
                style: const pw.TextStyle(fontSize: 9.5, color: _muted),
              ),
          ]),
        ),
        pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.end, children: [
          _label(copy.vehicle),
          pw.SizedBox(height: 4),
          pw.Text(b.vehicle.isEmpty ? '—' : b.vehicle,
              style: pw.TextStyle(fontSize: 11, fontWeight: pw.FontWeight.bold, color: _ink)),
          if (b.vinNumber.isNotEmpty)
            pw.Text('VIN ${b.vinNumber}',
                style: pw.TextStyle(fontSize: 8.5, color: _muted, font: pw.Font.courier())),
        ]),
      ]),
      pw.SizedBox(height: 18),
      pw.Row(children: [
        _label(copy.period),
        pw.SizedBox(width: 12),
        pw.Expanded(
          child: pw.Text(
            '${b.periodFrom} → ${b.periodTo}${b.partialMonth ? ' (${copy.soFar})' : ''}',
            style: const pw.TextStyle(fontSize: 10.5, color: _ink),
          ),
        ),
        pw.Text(b.stillParked ? copy.stillParked : copy.left,
            style: const pw.TextStyle(fontSize: 10.5, color: _ink)),
      ]),
      pw.Container(height: 1, color: _rule, margin: const pw.EdgeInsets.symmetric(vertical: 10)),
      _row(copy.parkingLine(b.days, parkingMoney(b.dayRateCents)), parkingMoney(b.monthCents),
          color: _ink),
      if (b.priorUnpaidCents > 0)
        _row(copy.priorUnpaid, parkingMoney(b.priorUnpaidCents), color: _due),
      if (b.monthPaidCents > 0)
        _row(copy.paid, '-${parkingMoney(b.monthPaidCents)}', color: _ok),
      pw.Container(height: 1.2, color: _ink, margin: const pw.EdgeInsets.symmetric(vertical: 6)),
      b.dueCents > 0
          ? _row(copy.balanceDue, parkingMoney(b.dueCents), bold: true, color: _due)
          : _row(copy.paidInFull, parkingMoney(0), bold: true, color: _ok),
    ],
  ));
  return doc.save();
}

Future<Uint8List> buildParkingMonthSummaryPdf({
  required Map<String, dynamic> business,
  required ParkingMonthSummary summary,
  required ParkingMonthPdfCopy copy,
}) async {
  final s = summary;
  final head = await _header(business, copy.summary, copy.monthLabel, '');
  pw.Widget stat(String label, String value, PdfColor color) => pw.Expanded(
        child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
          _label(label),
          pw.SizedBox(height: 4),
          pw.Text(value,
              style: pw.TextStyle(fontSize: 15, fontWeight: pw.FontWeight.bold, color: color)),
        ]),
      );
  final doc = pw.Document(title: '${copy.summary} ${copy.monthLabel}');
  doc.addPage(pw.MultiPage(
    pageFormat: PdfPageFormat.letter,
    margin: const pw.EdgeInsets.all(48),
    footer: (_) => _footer(copy.footer),
    build: (_) => [
      head,
      pw.Row(children: [
        stat(copy.carsOnLot, '${s.carsOnLot}', _ink),
        stat(copy.billed, parkingMoney(s.billedCents), _ink),
        stat(copy.collected, parkingMoney(s.collectedCents), _ok),
        stat(copy.owed, parkingMoney(s.dueCents), s.dueCents > 0 ? _due : _ink),
      ]),
      pw.SizedBox(height: 20),
      _label('${copy.whoOwes} (${s.carsOwing})'),
      pw.Container(height: 1, color: _rule, margin: const pw.EdgeInsets.symmetric(vertical: 6)),
      if (s.owing.isEmpty)
        pw.Text(copy.nobodyOwes, style: const pw.TextStyle(fontSize: 10.5, color: _ink)),
      for (final b in s.owing)
        pw.Container(
          padding: const pw.EdgeInsets.symmetric(vertical: 5),
          decoration: const pw.BoxDecoration(
            border: pw.Border(bottom: pw.BorderSide(color: _rule, width: 0.5)),
          ),
          child: pw.Row(children: [
            pw.SizedBox(
              width: 140,
              child: pw.Text(b.customerName.isEmpty ? '—' : b.customerName,
                  style: pw.TextStyle(fontSize: 10.5, fontWeight: pw.FontWeight.bold, color: _ink)),
            ),
            pw.Expanded(
              child: pw.Text(
                '${b.vehicle}${b.vinNumber.isNotEmpty ? ' · ${b.vinNumber.length > 8 ? b.vinNumber.substring(b.vinNumber.length - 8) : b.vinNumber}' : ''} · ${copy.daysLabel(b.days)}',
                style: const pw.TextStyle(fontSize: 9, color: _muted),
              ),
            ),
            pw.Text(parkingMoney(b.dueCents),
                style: pw.TextStyle(fontSize: 10.5, fontWeight: pw.FontWeight.bold, color: _due)),
          ]),
        ),
    ],
  ));
  return doc.save();
}

String parkingMonthFileName(String kind, String monthKey, String who, String business) {
  String slug(String v) => v
      .replaceAll(RegExp(r'[^A-Za-z0-9]+'), '-')
      .replaceAll(RegExp(r'^-|-$'), '')
      .toLowerCase();
  return [kind, monthKey, slug(who), slug(business)].where((p) => p.isNotEmpty).join('-');
}

Future<void> shareParkingMonthPdf(Uint8List bytes, String fileName) =>
    Printing.sharePdf(bytes: bytes, filename: '$fileName.pdf');
