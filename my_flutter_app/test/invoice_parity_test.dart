import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Invoices shipped to the console and the app in the same change, and this
/// keeps them there. It reads source rather than rendering, the way
/// `container_manifest_parity_test.dart` does: a callable the app never
/// calls is exactly the failure a screen that never renders in a test cannot
/// report.
void main() {
  String read(String path) => File(path).readAsStringSync();
  final screen = read('lib/screens/invoices_screen.dart');
  final model = read('lib/services/invoice_ledger.dart');
  final backend = read('functions/invoice_ledger.js');
  final menu = read('lib/screens/home_menu.dart');

  test('the screen is offered behind the ledger permission', () {
    expect(menu, contains("import 'invoices_screen.dart';"));
    expect(menu, contains("Key('open-invoices')"));
    expect(menu, contains('InvoicesScreen(businessId: ledgerBusinessId)'));
    // Gated on the same flag as the ledger tile, never a new permission.
    final tile = menu.indexOf("Key('open-invoices')");
    final gate = menu.lastIndexOf('if (canUseLotLedger)', tile);
    expect(gate, greaterThan(0));
    expect('_Destination('.allMatches(menu.substring(gate, tile)).length, 1,
        reason: 'the ledger gate must be the one right above the tile');
  });

  test('the app calls every invoice callable the console calls', () {
    for (final callable in [
      'createInvoice',
      'updateInvoice',
      'deleteInvoice',
      'addInvoiceLine',
      'updateInvoiceLine',
      'removeInvoiceLine',
      'recordInvoicePayment',
      'revertInvoicePayment',
    ]) {
      expect(screen, contains("'$callable'"), reason: callable);
    }
    expect(screen, isNot(contains('.set(')), reason: 'no client-side writes');
    expect(screen, isNot(contains('.update(')), reason: 'no client-side writes');
  });

  test('it reads the business own collections, scoped and unordered', () {
    for (final collection in ['invoices', 'invoiceLines', 'invoicePayments']) {
      expect(screen, contains("'$collection'"));
    }
    expect(screen, contains("where('businessId', isEqualTo: id)"));
    expect(screen, isNot(contains("scoped('invoices').orderBy")));
    expect(model, contains('List<Invoice> sortInvoices('));
  });

  test('the phone refuses in the same words as the server', () {
    // Every refusal the server can send is recognised by the phone, so it is
    // said in the reader's language rather than repeated in English.
    final messages = RegExp(r'^\s+[a-z_]+: "([^"]+)",$', multiLine: true)
        .allMatches(backend)
        .map((m) => m.group(1)!)
        .where((m) => !m.contains('no longer exists') || m.contains('invoice'))
        .toList();
    expect(messages.length, greaterThan(10));
    for (final message in messages) {
      if (message.contains('line no longer') || message.contains('payment')) {
        // Line and payment "gone" refusals surface through the live streams
        // (the row disappears); the sheet closes rather than translating.
        if (message.contains('no longer exists') ||
            message.contains('already reverted')) {
          continue;
        }
      }
      expect(screen, contains("'$message'"), reason: message);
    }
  });

  test('the paper is a PDF handed to the share sheet, and the text a share', () {
    expect(screen, contains('buildInvoicePdf('));
    expect(screen, contains('shareInvoicePdf('));
    expect(screen, contains('invoiceTextSummary('));
    expect(screen, contains('SharePlus.instance.share(ShareParams(text: text))'));
    expect(read('lib/utils/invoice_pdf.dart'), contains('Printing.sharePdf('));
  });
}
