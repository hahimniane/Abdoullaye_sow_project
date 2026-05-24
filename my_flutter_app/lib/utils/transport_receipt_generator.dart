import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../models/transport_request.dart';

Future<void> generateTransportReceipt({
  required TransportRequest request,
}) async {
  final pdf = pw.Document();
  final dateFormat = DateFormat('MMM dd, yyyy - HH:mm');

  pw.Widget buildRow(String label, String value) {
    return pw.Padding(
      padding: const pw.EdgeInsets.symmetric(vertical: 4),
      child: pw.Row(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.SizedBox(
            width: 150,
            child: pw.Text(
              '$label:',
              style: pw.TextStyle(
                fontWeight: pw.FontWeight.bold,
              ),
            ),
          ),
          pw.Expanded(
            child: pw.Text(value),
          ),
        ],
      ),
    );
  }

  pdf.addPage(
    pw.Page(
      pageFormat: PdfPageFormat.a4,
      build: (context) {
        return pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            pw.Container(
              width: double.infinity,
              padding: const pw.EdgeInsets.all(20),
              decoration: pw.BoxDecoration(
                color: PdfColors.deepOrange,
                borderRadius: const pw.BorderRadius.all(pw.Radius.circular(10)),
              ),
              child: pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                  pw.Text(
                    'CAR TRANSPORT RECEIPT',
                    style: pw.TextStyle(
                      fontSize: 24,
                      fontWeight: pw.FontWeight.bold,
                      color: PdfColors.white,
                    ),
                  ),
                  pw.SizedBox(height: 6),
                  pw.Text(
                    'Business Services',
                    style: pw.TextStyle(
                      fontSize: 16,
                      color: PdfColors.white,
                    ),
                  ),
                ],
              ),
            ),
            pw.SizedBox(height: 20),
            pw.Container(
              padding: const pw.EdgeInsets.all(20),
              decoration: pw.BoxDecoration(
                border: pw.Border.all(color: PdfColors.grey),
                borderRadius: const pw.BorderRadius.all(pw.Radius.circular(10)),
              ),
              child: pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                  pw.Text(
                    'Transport Details',
                    style: pw.TextStyle(
                      fontSize: 18,
                      fontWeight: pw.FontWeight.bold,
                    ),
                  ),
                  pw.SizedBox(height: 12),
                  buildRow('Tracking Number', request.trackingCode),
                  buildRow('Receipt Number', request.id),
                  buildRow('Created On', dateFormat.format(request.createdAt)),
                  buildRow('Generated On', dateFormat.format(DateTime.now())),
                  pw.SizedBox(height: 20),
                  pw.Text(
                    'Vehicle Information',
                    style: pw.TextStyle(
                      fontSize: 18,
                      fontWeight: pw.FontWeight.bold,
                    ),
                  ),
                  pw.SizedBox(height: 12),
                  buildRow('Owner Name', request.ownerName),
                  buildRow('Car Make', request.carMake),
                  buildRow('Car Model', request.carModel),
                  buildRow('Year', request.carYear),
                  buildRow('VIN Number', request.vinNumber),
                  buildRow('Destination', request.destinationCountryName),
                  buildRow('Transport Date',
                      DateFormat('MMM dd, yyyy').format(request.transportDate)),
                  pw.SizedBox(height: 20),
                  pw.Text(
                    'Billing Summary',
                    style: pw.TextStyle(
                      fontSize: 18,
                      fontWeight: pw.FontWeight.bold,
                    ),
                  ),
                  pw.SizedBox(height: 12),
                  buildRow(
                    'Price',
                    NumberFormat.simpleCurrency().format(request.price),
                  ),
                  buildRow('Status', request.status.toUpperCase()),
                ],
              ),
            ),
          ],
        );
      },
    ),
  );

  await Printing.layoutPdf(
    onLayout: (format) async => pdf.save(),
    name: 'Transport_${request.trackingCode}',
  );
}
