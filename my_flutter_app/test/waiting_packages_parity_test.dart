import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/invoice_ledger.dart';

/// Waiting packages shipped to the console and the app against one contract
/// (docs/WAITING_PACKAGES.md). This reads source, the way
/// `container_manifest_parity_test.dart` does: the sheets sit behind a
/// signed-in business with live Firestore streams, and a callable the app
/// never calls - or a rule the phone mirrors with a different number - is
/// exactly what a widget test cannot see.
void main() {
  String read(String path) => File(path).readAsStringSync();

  final backend = read('functions/container_manifest.js');
  final payments = read('functions/container_payments.js');
  final index = read('functions/index.js');
  final doc = read('../docs/WAITING_PACKAGES.md');
  final model = read('lib/services/container_manifest.dart');
  final pure = read('lib/services/waiting_packages.dart');
  final containers = read('lib/screens/containers_screen.dart');
  final assign = read('lib/screens/add_waiting_packages_sheet.dart');
  final money = read('lib/screens/package_payment_sheet.dart');
  final waiting = read('lib/screens/waiting_packages_screen.dart');
  final result = read('lib/screens/package_result_screen.dart');
  final service = read('lib/services/waiting_package_service.dart');
  final packages = read('lib/services/container_packages.dart');

  test('the app calls every waiting-package callable the console calls', () {
    final calls = {
      'addWaitingPackage': containers,
      'assignContainerLines': assign,
      'unassignContainerLine': containers,
      'setContainerLinePrice': money,
      'recordContainerLinePayment': money,
      'revertContainerLinePayment': money,
      'removeContainerLine': waiting,
      'updateContainerLine': containers,
    };
    for (final entry in calls.entries) {
      expect(index, contains('exports.${entry.key} = onCall('),
          reason: '${entry.key} is not a callable the server exports');
      expect(entry.value, contains("'${entry.key}'"),
          reason: '${entry.key} is never called by the app');
    }
    // Every callable goes through the one caller the tests replace.
    expect(service, contains('typedef ContainerCallableCaller'));
    expect(service, contains('FirebaseFunctions.instance.httpsCallable(name)'));
    // The main destination is the console's; the app never writes it.
    expect(containers, isNot(contains('isMain:')));
    expect(read('lib/models/destination_country.dart'),
        isNot(contains("'isMain':")),
        reason: 'toFirestore must never write the flag');
  });

  test('the payments and waiting packages are read the way the rules allow', () {
    // Both equalities: the rule authorises the read by business.
    expect(service, contains("collection('containerLinePayments')"));
    expect(service, contains(".where('businessId', isEqualTo: businessId)"));
    expect(service, contains(".where('lineId', isEqualTo: lineId)"));
    expect(service, isNot(contains('.orderBy(')));
    // Waiting lines come from the lines the screen already listens to.
    expect(waiting, isNot(contains("collection('containerLines')")));
    expect(containers, contains('_lines.where((l) => l.isWaiting)'));
  });

  test('the pure module mirrors the server rule for rule', () {
    const mirrored = {
      'destinationMismatch': 'destinationMismatch(',
      'lineIsWaiting': 'bool get isWaiting',
      'dimensionOf': 'double? containerDimension(',
      'sizeErrors': 'packageSizeErrors(',
      'priceErrors': 'packagePriceErrors(',
      'validateWaitingPackage': 'validateWaitingPackage(',
      'linePaymentStanding': 'packageStanding(',
      'validateLinePayment': 'validatePackagePayment(',
      'lineVolumeCubicFeet': 'volumeCubicFeet(',
    };
    final dart = '$model\n$pure';
    for (final entry in mirrored.entries) {
      expect('$backend\n$payments', contains('function ${entry.key}('),
          reason: '${entry.key} is the server rule');
      expect(dart, contains(entry.value), reason: '${entry.key} is mirrored');
    }
    // The same numbers, not merely the same names.
    expect(backend, contains('const MAX_DIMENSION_IN = ${containerMaxDimensionIn.round()};'));
    expect(backend, contains('const MAX_LINE_IDS = $containerMaxAssignLines;'));
    expect(backend, contains('const WAITING_HOLDER = "$containerWaitingHolder";'));
    expect(backend, contains('const LINE_STATUS_WAITING = "$containerLineStatusWaiting";'));
    expect(read('functions/invoice_ledger.js'),
        contains('const MAX_CENTS = $containerMaxCents;'));
    expect(pure, contains('1728'));
    expect(backend, contains('/ 1728'));
  });

  test('the payment vocabulary is the server\'s', () {
    // The same methods as invoices and the ledger, in the same words.
    final server = read('functions/invoice_ledger.js');
    for (final method in invoicePaymentMethods) {
      expect(server, contains('"$method"'), reason: method);
    }
    expect(payments, contains('CONTAINER_PAYMENT_METHODS = INVOICE_PAYMENT_METHODS'));
    for (final status in ['no_price', 'unpaid', 'partial', 'paid', 'pay_on_arrival']) {
      expect(payments, contains('"$status"'), reason: status);
    }
  });

  test('every refusal code in the contract has an app copy', () {
    final listed = RegExp(r'`([a-z_]+)`')
        .allMatches(
          doc.substring(doc.indexOf('New codes:'), doc.indexOf('## Callables')),
        )
        .map((m) => m.group(1)!)
        .where((code) => code.contains('_'))
        .toSet();
    expect(listed, contains('destination_mismatch'));
    expect(listed.length, greaterThan(15));
    for (final code in listed) {
      expect(containerRefusalCodes, contains(code), reason: '$code is unknown');
      expect(containers, contains("'$code' =>"), reason: '$code has no copy');
    }
  });

  test('labels before a container ask by line id', () {
    expect(doc, contains('lineIds'));
    expect(read('lib/services/package_codes.dart'), contains("'lineIds': ids"));
    expect(packages, contains('lineIds: lineIds'));
    // The print sheet takes a package that has no container.
    expect(containers, contains('ShippingContainer? container,'));
    expect(waiting, contains('showContainerLabelSheet('));
    expect(result, contains('(container == null && !line.isWaiting)'));
  });

  test('a package with no container is handled by the package view', () {
    expect(result, contains('line.isWaiting'));
    expect(result, contains("Key('pkg-waiting')"));
    expect(result, contains("Key('pkg-price-payments')"));
    expect(result, contains('showPackagePaymentSheet('));
    expect(result, contains('showWaitingPackageSheet('));
  });

  test('dates people read go through the US-style helpers', () {
    for (final source in [waiting, money, result]) {
      expect(source, isNot(contains('DateFormat(')));
    }
    expect(waiting, contains('displayDate('));
    expect(money, contains('displayDateTime('));
  });

  test('every string on the waiting-package screens is in both catalogs', () {
    final en = jsonDecode(read('lib/l10n/app_en.arb')) as Map<String, dynamic>;
    final fr = jsonDecode(read('lib/l10n/app_fr.arb')) as Map<String, dynamic>;
    final sources = [
      containers,
      assign,
      money,
      waiting,
      result,
      read('lib/screens/package_scan_screen.dart'),
      read('lib/widgets/waiting_package_fields.dart'),
      read('lib/widgets/package_money.dart'),
    ].join('\n');
    final used = RegExp(r'l10n\.((?:wpk|ctrErrVinAlreadyWaiting|ctrStatusWaiting)[A-Za-z0-9]*)')
        .allMatches(sources)
        .map((m) => m.group(1)!)
        .toSet();
    expect(used.length, greaterThan(60));
    for (final key in used) {
      expect(en.containsKey(key), isTrue, reason: '$key missing from English');
      expect(fr.containsKey(key), isTrue, reason: '$key missing from French');
    }
  });

  test('French is translated, not copied, and keeps its placeholders', () {
    final en = jsonDecode(read('lib/l10n/app_en.arb')) as Map<String, dynamic>;
    final fr = jsonDecode(read('lib/l10n/app_fr.arb')) as Map<String, dynamic>;
    final keys = [
      for (final key in en.keys)
        if (key.startsWith('wpk') ||
            key == 'ctrStatusWaiting' ||
            key == 'ctrErrVinAlreadyWaiting')
          key,
    ];
    expect(keys.length, greaterThan(80));
    for (final key in keys) {
      expect(fr[key], isA<String>(), reason: 'fr $key');
      expect(fr[key], isNot(en[key]), reason: 'fr $key is still English');
      final holes = RegExp(r'\{(\w+)[,}]').allMatches(en[key] as String);
      for (final hole in holes) {
        expect(fr[key], contains('{${hole.group(1)}'),
            reason: 'fr $key lost its {${hole.group(1)}}');
      }
    }
  });
}
