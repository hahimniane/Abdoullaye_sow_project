import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:printing/printing.dart';

import '../theme/app_colors.dart';

/// Every paper the app makes - an invoice, a month's bill, a month's
/// summary - opens here first: read it, then print it or share it (WhatsApp,
/// email, save to Files). Going straight to the share sheet meant nobody
/// could check a bill before it reached a customer.
class PdfPreviewScreen extends StatelessWidget {
  const PdfPreviewScreen({
    super.key,
    required this.bytes,
    required this.fileName,
    required this.title,
  });

  final Uint8List bytes;
  final String fileName;
  final String title;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.cream,
      appBar: AppBar(title: Text(title, overflow: TextOverflow.ellipsis)),
      body: PdfPreview(
        key: const Key('pdf-preview'),
        build: (_) async => bytes,
        pdfFileName: fileName.endsWith('.pdf') ? fileName : '$fileName.pdf',
        allowPrinting: true,
        allowSharing: true,
        canChangePageFormat: false,
        canChangeOrientation: false,
        canDebug: false,
      ),
    );
  }
}

/// Open a built PDF in the preview, where it can be printed or shared.
Future<void> openPdfPreview(
  BuildContext context, {
  required Uint8List bytes,
  required String fileName,
  required String title,
}) {
  return Navigator.of(context).push(MaterialPageRoute<void>(
    builder: (_) =>
        PdfPreviewScreen(bytes: bytes, fileName: fileName, title: title),
  ));
}
