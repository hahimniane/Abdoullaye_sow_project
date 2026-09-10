import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final screen = File('lib/screens/lot_ledger_screen.dart').readAsStringSync();
  final service = File('lib/services/lot_ledger.dart').readAsStringSync();
  final motion = File('lib/theme/app_motion.dart').readAsStringSync();
  final menu = File('lib/screens/home_menu.dart').readAsStringSync();
  final perms = File('lib/utils/business_permissions.dart').readAsStringSync();

  test('the yard-side ledger writes through the authority callables', () {
    for (final callable in [
      'createLotActivity',
      'updateLotActivity',
      'createLotExpenseEntry',
      'upsertLotExpenseLine',
      'resendLotActivityLink',
      'recordLotActivityDirectPayment',
      'voidLotActivity',
      'voidLotExpenseEntry',
      'getLotActivityDocumentUrl',
    ]) {
      expect(screen, contains("'$callable'"),
          reason: '\$callable is the server-side authority for this action');
    }
  });

  test('it reads the business own catalogue, never a fixed list', () {
    for (final collection in [
      'lotActivityTypes',
      'lotExpenseLines',
      'lotActivities',
      'lotExpenseEntries',
      'parkedCars',
    ]) {
      expect(screen, contains("'$collection'"),
          reason: '$collection is the business own data');
    }
    // Every query is scoped to the business, which is also what the security
    // rules authorize on.
    expect(screen, contains("where('businessId', isEqualTo:"));
  });

  test('the payment vocabulary is the server\'s, kept in one place', () {
    expect(service, contains("const lotPaymentMethodLink = 'payment_link'"));
    expect(service, contains("const lotPaymentMethodDirect = 'direct'"));
    expect(service, contains("const lotStatusAwaitingLink = 'awaiting_payment_link'"));
    // The screen spells none of these itself.
    expect(screen.contains("'payment_link'"), isFalse);
    expect(screen.contains("'awaiting_payment_link'"), isFalse);
  });

  test('dates are frozen at midday so a timezone cannot roll them back', () {
    expect(service, contains("T12:00:00"));
    expect(screen, contains('lotMiddayIso('));
  });

  test('a purchase over the threshold cannot be saved without a receipt', () {
    expect(service, contains('expense_proof_required'));
    expect(screen, contains('validateLotExpenseDraft('));
    expect(screen, contains('proofUrl'));
  });

  test('a VIN fills the vehicle in rather than asking for it again', () {
    // Make, model and year are the business's own data or the VIN's; they are
    // not three things to re-type next to a car you are standing in front of.
    expect(service, contains('LotKnownCar'));
    expect(service, contains('lotFindKnownCar('));
    expect(screen, contains('lotFindKnownCar('));
    expect(screen, contains('NhtsaVinDecoderService()'));
    expect(screen, contains('VinScannerScreen()'));
    expect(screen, contains("'parkedCars'"),
        reason: 'a parked car is the first place a VIN should be found');
  });

  test('the home menu gates the tile on the ledger permission', () {
    expect(perms, contains("static const ledger = 'ledger'"));
    expect(menu, contains('BusinessPermission.ledger'));
    expect(menu, contains('LotLedgerScreen(businessId: ledgerBusinessId)'));
    expect(menu, contains("Key('open-lot-ledger')"));
  });

  group('the motion is the house style, not ad-hoc', () {
    test('springs are described by damping and response', () {
      expect(motion, contains('dampingRatio'));
      expect(motion, contains('required double response'));
      expect(motion, contains('SpringDescription.withDampingRatio'));
    });

    test('a press is acknowledged on touch-down, not on release', () {
      expect(motion, contains('onTapDown'));
      expect(screen, contains('PressableScale('));
    });

    test('a re-target carries the velocity it already had', () {
      expect(screen, contains('SpringSimulation('));
      expect(screen, contains('_thumb.velocity'));
    });

    test('reduced motion is honoured rather than ignored', () {
      expect(motion, contains('maybeDisableAnimationsOf'));
      expect(screen, contains('AppMotion.reduced(context)'));
    });
  });

  test('every string on the screen is in both catalogs', () {
    final en = jsonDecode(File('lib/l10n/app_en.arb').readAsStringSync())
        as Map<String, dynamic>;
    final fr = jsonDecode(File('lib/l10n/app_fr.arb').readAsStringSync())
        as Map<String, dynamic>;
    final used = RegExp(r'l10n\.(lot[A-Za-z0-9]*)')
        .allMatches(screen)
        .map((m) => m.group(1)!)
        .toSet();
    expect(used.length, greaterThan(40),
        reason: 'the screen should be reading its copy from the catalog');
    for (final key in used) {
      expect(en.containsKey(key), isTrue, reason: '$key missing from English');
      expect(fr.containsKey(key), isTrue, reason: '$key missing from French');
    }
  });
}
