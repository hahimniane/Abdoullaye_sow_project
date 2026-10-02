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
import 'date_display.dart';
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
    this.car = 'Car',
    this.amount = 'Amount',
    this.to = 'to',
    this.registeredTo = 'registered to',
    this.monthTotal = 'Total for the month',
    this.carsLabel,
    this.activitiesTitle = 'Activities',
    this.activity = 'Activity',
    this.date = 'Date',
    this.parkingTitle = 'Parking',
    this.paidToward = 'Paid toward',
    this.paidWord = 'paid',
    this.dueWord = 'due',
    this.itemsLabel,
    this.locale = 'en',
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
  final String car;
  final String amount;
  final String to;
  final String registeredTo;
  final String monthTotal;

  /// "3 cars".
  final String Function(int cars)? carsLabel;
  final String activitiesTitle;
  final String activity;
  final String date;
  final String parkingTitle;
  final String paidToward;
  final String paidWord;
  final String dueWord;

  /// "4 items".
  final String Function(int items)? itemsLabel;

  /// The reader's locale tag, for how dates read ("Sep 1, 2026" in English).
  final String locale;
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
  required ParkingMonthCustomer customer,
  required ParkingMonthPdfCopy copy,
}) async {
  final c = customer;
  final items = c.cars.length + c.activities.length;
  final head = await _header(business, copy.bill, copy.monthLabel,
      copy.itemsLabel?.call(items) ?? '');
  String standing(int paid, int due) => [
        if (paid > 0) '${parkingMoney(paid)} ${copy.paidWord}',
        if (due > 0) '${parkingMoney(due)} ${copy.dueWord}',
      ].join(' · ');
  pw.Widget text(String t, {bool bold = false, pw.TextAlign align = pw.TextAlign.left, double size = 10}) =>
      pw.Padding(
        padding: const pw.EdgeInsets.symmetric(vertical: 6),
        child: pw.Text(t,
            textAlign: align,
            style: pw.TextStyle(
                fontSize: size, color: _ink, fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal)),
      );
  pw.Widget itemCell(String title, String sub) => pw.Padding(
        padding: const pw.EdgeInsets.symmetric(vertical: 6),
        child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
          pw.Text(title, style: pw.TextStyle(fontSize: 10.5, fontWeight: pw.FontWeight.bold, color: _ink)),
          if (sub.isNotEmpty) pw.Text(sub, style: const pw.TextStyle(fontSize: 8.5, color: _muted)),
        ]),
      );
  pw.Widget headCell(String t, {bool right = false}) => pw.Padding(
        padding: const pw.EdgeInsets.only(bottom: 6),
        child: right ? pw.Align(alignment: pw.Alignment.centerRight, child: _label(t)) : _label(t),
      );
  pw.Widget table(List<pw.TableRow> rows) => pw.Table(
        columnWidths: const {
          0: pw.FlexColumnWidth(3.2),
          1: pw.FlexColumnWidth(2.4),
          2: pw.FlexColumnWidth(1.4),
          3: pw.FlexColumnWidth(1.3),
        },
        border: const pw.TableBorder(
          horizontalInside: pw.BorderSide(color: _rule, width: 0.5),
          bottom: pw.BorderSide(color: _rule, width: 0.5),
        ),
        children: rows,
      );
  pw.Widget sectionTitle(String t) => pw.Padding(
        padding: const pw.EdgeInsets.only(top: 12, bottom: 4),
        child: pw.Text(t, style: pw.TextStyle(fontSize: 10, fontWeight: pw.FontWeight.bold, color: _brand)),
      );
  String actTitle(ParkingMonthActivity a) =>
      '${a.label}${a.vehicle.isNotEmpty ? ' · ${a.vehicle}' : ''}';
  String sub(List<String> parts) => parts.where((p) => p.isNotEmpty).join('  ·  ');

  final doc = pw.Document(title: '${copy.bill} ${copy.monthLabel}');
  doc.addPage(pw.MultiPage(
    pageFormat: PdfPageFormat.letter,
    margin: const pw.EdgeInsets.all(48),
    footer: (_) => _footer(copy.footer),
    build: (_) => [
      head,
      _label(copy.billedTo),
      pw.SizedBox(height: 4),
      pw.Text(c.customerName.isEmpty ? '—' : c.customerName,
          style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold, color: _ink)),
      if ([c.customerPhone, c.customerEmail].any((p) => p.isNotEmpty))
        pw.Text([c.customerPhone, c.customerEmail].where((p) => p.isNotEmpty).join('  |  '),
            style: const pw.TextStyle(fontSize: 9.5, color: _muted)),
      if (c.cars.isNotEmpty) ...[
        sectionTitle(copy.parkingTitle),
        table([
          pw.TableRow(children: [
            headCell(copy.car),
            headCell(copy.period),
            headCell('×', right: true),
            headCell(copy.amount, right: true),
          ]),
          for (var i = 0; i < c.cars.length; i++)
            pw.TableRow(children: [
              itemCell(
                c.cars[i].vehicle.isEmpty ? copy.car : c.cars[i].vehicle,
                sub([
                  if (c.cars[i].vinNumber.isNotEmpty) 'VIN ${c.cars[i].vinNumber}',
                  if (c.registeredTo[i].isNotEmpty) '${copy.registeredTo} ${c.registeredTo[i]}',
                  c.cars[i].stillParked ? copy.stillParked : copy.left,
                  if (c.cars[i].priorUnpaidCents > 0)
                    '+ ${parkingMoney(c.cars[i].priorUnpaidCents)} ${copy.priorUnpaid.toLowerCase()}',
                  standing(c.cars[i].monthPaidCents,
                      c.cars[i].monthUnpaidCents + c.cars[i].priorUnpaidCents),
                ]),
              ),
              text('${displayDay(c.cars[i].periodFrom, copy.locale)} ${copy.to} '
                  '${displayDay(c.cars[i].periodTo, copy.locale)}'),
              text('${c.cars[i].days} × ${parkingMoney(c.cars[i].dayRateCents)}', align: pw.TextAlign.right),
              text(parkingMoney(c.cars[i].monthCents), bold: true, align: pw.TextAlign.right),
            ]),
        ]),
      ],
      if (c.activities.isNotEmpty) ...[
        sectionTitle(copy.activitiesTitle),
        table([
          pw.TableRow(children: [
            headCell(copy.activity),
            headCell(copy.date),
            headCell(''),
            headCell(copy.amount, right: true),
          ]),
          for (var i = 0; i < c.activities.length; i++)
            pw.TableRow(children: [
              itemCell(actTitle(c.activities[i]), sub([
                if (c.activities[i].vinNumber.isNotEmpty) 'VIN ${c.activities[i].vinNumber}',
                if (c.activityRegisteredTo[i].isNotEmpty) '${copy.registeredTo} ${c.activityRegisteredTo[i]}',
                standing(c.activities[i].paidCents, c.activities[i].dueCents),
              ])),
              text(displayDay(c.activities[i].date, copy.locale)),
              text(''),
              text(parkingMoney(c.activities[i].feeCents), bold: true, align: pw.TextAlign.right),
            ]),
        ]),
      ],
      if (c.olderActivities.isNotEmpty) ...[
        sectionTitle(copy.priorUnpaid),
        table([
          pw.TableRow(children: [
            headCell(copy.activity),
            headCell(copy.date),
            headCell(''),
            headCell(copy.amount, right: true),
          ]),
          for (var i = 0; i < c.olderActivities.length; i++)
            pw.TableRow(children: [
              itemCell(actTitle(c.olderActivities[i]), sub([
                if (c.olderActivities[i].vinNumber.isNotEmpty) 'VIN ${c.olderActivities[i].vinNumber}',
                if (c.olderRegisteredTo[i].isNotEmpty) '${copy.registeredTo} ${c.olderRegisteredTo[i]}',
                standing(c.olderActivities[i].paidCents, c.olderActivities[i].dueCents),
              ])),
              text(displayDay(c.olderActivities[i].date, copy.locale)),
              text(''),
              text(parkingMoney(c.olderActivities[i].dueCents), bold: true, align: pw.TextAlign.right),
            ]),
        ]),
      ],
      pw.SizedBox(height: 10),
      _row(copy.monthTotal, parkingMoney(c.monthCents), color: _ink),
      if (c.priorUnpaidCents > 0)
        _row(copy.priorUnpaid, parkingMoney(c.priorUnpaidCents), color: _due),
      // Which item each payment went toward, not just a lump sum.
      for (final b in c.cars)
        if (b.monthPaidCents > 0)
          _row('${copy.paidToward} ${b.vehicle.isEmpty ? copy.car : b.vehicle}',
              '-${parkingMoney(b.monthPaidCents)}', color: _ok),
      for (final a in c.activities)
        if (a.paidCents > 0)
          _row('${copy.paidToward} ${actTitle(a)} (${displayDay(a.date, copy.locale)})', '-${parkingMoney(a.paidCents)}', color: _ok),
      pw.Container(height: 1.2, color: _ink, margin: const pw.EdgeInsets.symmetric(vertical: 6)),
      c.dueCents > 0
          ? _row(copy.balanceDue, parkingMoney(c.dueCents), bold: true, color: _due)
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
      _label('${copy.whoOwes} (${s.customersOwing.length})'),
      pw.Container(height: 1, color: _rule, margin: const pw.EdgeInsets.symmetric(vertical: 6)),
      if (s.customersOwing.isEmpty)
        pw.Text(copy.nobodyOwes, style: const pw.TextStyle(fontSize: 10.5, color: _ink)),
      for (final b in s.customersOwing)
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
                '${b.customerPhone}${b.customerPhone.isNotEmpty ? ' · ' : ''}${[...b.cars.map((car) => car.vehicle), ...b.activities.map((x) => x.label), ...b.olderActivities.map((x) => x.label)].join(', ')}',
                maxLines: 1,
                overflow: pw.TextOverflow.clip,
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

