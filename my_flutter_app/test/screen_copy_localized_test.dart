import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Copy that used to be hardcoded English (or an inline `copy(en, fr)` pair)
/// on these screens now comes from both ARBs. Guards the migration: the old
/// literals stay out of the source, and every key has English and French.
void main() {
  String read(String path) => File(path).readAsStringSync();
  Map<String, dynamic> arb(String path) =>
      jsonDecode(read(path)) as Map<String, dynamic>;

  final retired = <String, List<String>>{
    'lib/screens/open_barrels_screen.dart': [
      'String copy(String en, String fr)',
      "copy('",
      'Post partial barrel',
    ],
    'lib/screens/send_barrel_screen.dart': [
      'String _copy(',
      'Join an open shared barrel or reserve a share.',
    ],
    'lib/screens/my_purchases_screen.dart': [
      "'Extension: ",
      "'Review pending'",
      "'No-show'",
    ],
    'lib/screens/staff_car_management_screen.dart': [
      'Hold max days must be between 1 and 30.',
      'Enter a positive paid hold amount.',
      "'Business default'",
    ],
    'lib/screens/staff_purchase_management_screen.dart': [
      "'Mark car sold?'",
      "'Approve extension?'",
      'Forfeited holds cannot be completed.',
    ],
    'lib/screens/transport_request_details_screen.dart': [
      "Text('Open')",
      "Text('Enclosed')",
    ],
    'lib/screens/barrel_shipment_details_screen.dart': [
      'This shipment can no longer be edited because pickup has arrived',
    ],
    'lib/widgets/transport_journey.dart': [
      "'This transport job was cancelled.'",
    ],
  };

  test('the retired literals stay out of the screens', () {
    for (final entry in retired.entries) {
      final source = read(entry.key);
      for (final literal in entry.value) {
        expect(source, isNot(contains(literal)), reason: entry.key);
      }
    }
  });

  test('the keys that replaced them exist in English and French', () {
    final en = arb('lib/l10n/app_en.arb');
    final fr = arb('lib/l10n/app_fr.arb');
    const keys = [
      'openBarrelsPostPartial',
      'openBarrelsJoinRequestSent',
      'sendBarrelSharedPromoTitle',
      'sendBarrelSharedPromoHint',
      'extensionPaymentSuffix',
      'holdMaxDaysOutOfRange',
      'holdAmountMustBePositive',
      'holdPricingBusinessDefault',
      'purchaseMarkSoldTitle',
      'purchaseForfeitedCannotComplete',
      'shipmentLockedNotice',
      'transportJobCancelledNotice',
      'ctrSendStatus',
      'ctrWhatsAppNotConnectedMessage',
      'pkgResultQueued',
      'pkgResultSending',
      'pkgResultRetrying',
    ];
    for (final key in keys) {
      expect(en[key], isA<String>(), reason: 'en $key');
      expect(fr[key], isA<String>(), reason: 'fr $key');
      expect(fr[key], isNot(en[key]), reason: 'fr $key is still English');
    }
  });
}
