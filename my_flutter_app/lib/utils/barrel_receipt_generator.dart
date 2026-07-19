import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../models/barrel_shipment.dart';

Future<void> generateBarrelShipmentReceipt({
  required BarrelShipment shipment,
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
            width: 140,
            child: pw.Text(
              '$label:',
              style: pw.TextStyle(fontWeight: pw.FontWeight.bold),
            ),
          ),
          pw.Expanded(child: pw.Text(value)),
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
                color: PdfColors.blue,
                borderRadius: const pw.BorderRadius.all(pw.Radius.circular(10)),
              ),
              child: pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                  pw.Text(
                    'BARREL SHIPMENT RECEIPT',
                    style: pw.TextStyle(
                      fontSize: 24,
                      fontWeight: pw.FontWeight.bold,
                      color: PdfColors.white,
                    ),
                  ),
                  pw.SizedBox(height: 6),
                  pw.Text(
                    'Business Services',
                    style: pw.TextStyle(fontSize: 16, color: PdfColors.white),
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
                    'Shipment Details',
                    style: pw.TextStyle(
                      fontSize: 18,
                      fontWeight: pw.FontWeight.bold,
                    ),
                  ),
                  pw.SizedBox(height: 12),
                  buildRow('Tracking Number', shipment.trackingCode),
                  buildRow('Created At', dateFormat.format(shipment.createdAt)),
                  buildRow('Generated On', dateFormat.format(DateTime.now())),
                  pw.SizedBox(height: 20),
                  pw.Text(
                    'Sender Information',
                    style: pw.TextStyle(
                      fontSize: 18,
                      fontWeight: pw.FontWeight.bold,
                    ),
                  ),
                  pw.SizedBox(height: 10),
                  buildRow('Sender Name', shipment.senderName),
                  buildRow(
                    shipment.pickupRequested
                        ? 'Pickup Address'
                        : 'Drop-off Office',
                    shipment.senderAddress,
                  ),
                  buildRow(
                    'Pickup Service',
                    shipment.pickupRequested
                        ? '${shipment.pickupBorough} pickup'
                        : 'Customer drop-off',
                  ),
                  if (shipment.pickupDateTime != null)
                    buildRow(
                      'Pickup Time',
                      dateFormat.format(shipment.pickupDateTime!),
                    ),
                  pw.SizedBox(height: 20),
                  pw.Text(
                    'Receiver Information',
                    style: pw.TextStyle(
                      fontSize: 18,
                      fontWeight: pw.FontWeight.bold,
                    ),
                  ),
                  pw.SizedBox(height: 10),
                  buildRow('Receiver Name', shipment.receiverName),
                  buildRow('Receiver Phone', shipment.receiverPhone),
                  buildRow('Destination', shipment.destinationCountryName),
                  if (shipment.deliveryEstimateLabel != null)
                    buildRow(
                      'Delivery Estimate',
                      shipment.deliveryEstimateLabel!,
                    ),
                  pw.SizedBox(height: 20),
                  pw.Text(
                    'Billing Summary',
                    style: pw.TextStyle(
                      fontSize: 18,
                      fontWeight: pw.FontWeight.bold,
                    ),
                  ),
                  pw.SizedBox(height: 10),
                  buildRow('Quantity', shipment.quantity.toString()),
                  if (shipment.unitShippingFee != null)
                    buildRow(
                      'Unit Shipping',
                      NumberFormat.simpleCurrency().format(
                        shipment.unitShippingFee,
                      ),
                    ),
                  buildRow(
                    'Shipping Fee',
                    NumberFormat.simpleCurrency().format(shipment.shippingFee),
                  ),
                  buildRow(
                    'Pickup Fee',
                    NumberFormat.simpleCurrency().format(shipment.pickupFee),
                  ),
                  buildRow(
                    shipment.pricingPendingReview
                        ? 'Estimated Total'
                        : 'Total Price',
                    NumberFormat.simpleCurrency().format(shipment.price),
                  ),
                  buildRow('Status', shipment.status.toUpperCase()),
                  buildRow('Payment', shipment.paymentStatus.toUpperCase()),
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
    name: 'Barrel_Shipment_${shipment.trackingCode}',
  );
}

Future<void> generateBarrelOrderReceipt({
  required String orderId,
  required List<BarrelShipment> shipments,
}) async {
  if (shipments.length == 1) {
    await generateBarrelShipmentReceipt(shipment: shipments.first);
    return;
  }

  final pdf = pw.Document();
  final currency = NumberFormat.simpleCurrency();
  final dateFormat = DateFormat('MMM dd, yyyy - HH:mm');
  final total = shipments.fold<double>(0, (sum, item) => sum + item.price);

  pw.Widget buildLine(BarrelShipment shipment) {
    return pw.Container(
      margin: const pw.EdgeInsets.only(bottom: 10),
      padding: const pw.EdgeInsets.all(12),
      decoration: pw.BoxDecoration(
        border: pw.Border.all(color: PdfColors.grey300),
        borderRadius: const pw.BorderRadius.all(pw.Radius.circular(6)),
      ),
      child: pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.Text(
            '${shipment.destinationCountryName} - ${shipment.businessName}',
            style: pw.TextStyle(fontWeight: pw.FontWeight.bold),
          ),
          pw.SizedBox(height: 4),
          pw.Text('Tracking: ${shipment.trackingCode}'),
          pw.Text('Receiver: ${shipment.receiverName}'),
          pw.Text('Quantity: ${shipment.quantity}'),
          pw.Text('Shipping: ${currency.format(shipment.shippingFee)}'),
          pw.Text('Pickup: ${currency.format(shipment.pickupFee)}'),
          pw.Text('Line total: ${currency.format(shipment.price)}'),
        ],
      ),
    );
  }

  pdf.addPage(
    pw.MultiPage(
      pageFormat: PdfPageFormat.a4,
      build: (context) => [
        pw.Container(
          width: double.infinity,
          padding: const pw.EdgeInsets.all(20),
          color: PdfColors.blue,
          child: pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              pw.Text(
                'BARREL ORDER RECEIPT',
                style: pw.TextStyle(
                  fontSize: 24,
                  fontWeight: pw.FontWeight.bold,
                  color: PdfColors.white,
                ),
              ),
              pw.SizedBox(height: 6),
              pw.Text(
                'Order $orderId',
                style: pw.TextStyle(color: PdfColors.white),
              ),
            ],
          ),
        ),
        pw.SizedBox(height: 18),
        pw.Text('Generated: ${dateFormat.format(DateTime.now())}'),
        pw.SizedBox(height: 12),
        ...shipments.map(buildLine),
        pw.Divider(),
        pw.Align(
          alignment: pw.Alignment.centerRight,
          child: pw.Text(
            'Order total: ${currency.format(total)}',
            style: pw.TextStyle(fontSize: 16, fontWeight: pw.FontWeight.bold),
          ),
        ),
      ],
    ),
  );

  await Printing.layoutPdf(
    onLayout: (format) async => pdf.save(),
    name: 'Barrel_Order_$orderId',
  );
}
