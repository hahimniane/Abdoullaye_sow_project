import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final screen =
      File('lib/screens/lot_ledger_screen.dart').readAsStringSync();
  final menu = File('lib/screens/home_menu.dart').readAsStringSync();
  final perms = File('lib/utils/business_permissions.dart').readAsStringSync();

  test('yard-side ledger calls the authority callables', () {
    expect(screen, contains("httpsCallable('createLotActivity')"));
    expect(screen, contains("httpsCallable('createLotExpenseEntry')"));
  });

  test('it reads the business own catalogue and expense lines, not a fixed list',
      () {
    expect(screen, contains("collection('lotActivityTypes')"));
    expect(screen, contains("collection('lotExpenseLines')"));
    expect(screen, contains("where('businessId', isEqualTo: businessId)"));
  });

  test('the payment vocabulary matches the server (link vs direct)', () {
    expect(screen, contains("'payment_link'"));
    expect(screen, contains("'direct'"));
    // A direct payment must name who took it; a link must not.
    expect(screen, contains('Say which staff member took the payment.'));
    expect(
      screen,
      contains('A payment link needs a phone number or an email address.'),
    );
  });

  test('dates are frozen at midday so a timezone cannot roll them back', () {
    expect(screen, contains("T12:00:00"));
  });

  test('the home menu gates the tile on the ledger permission', () {
    expect(perms, contains("static const ledger = 'ledger'"));
    expect(menu, contains('BusinessPermission.ledger'));
    expect(menu, contains('LotLedgerScreen(businessId: ledgerBusinessId)'));
    expect(menu, contains("Key('open-lot-ledger')"));
  });
}
