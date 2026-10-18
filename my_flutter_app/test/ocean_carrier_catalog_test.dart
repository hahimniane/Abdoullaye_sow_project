import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/data/ocean_carrier_catalog.dart';

/// The app's shipping-line picker offers exactly the console's catalog
/// (`admin_web/src/lib/ocean-carrier-catalog.ts`, the source of truth), which
/// is also the list the server accepts as a container's `carrierScac`. A line
/// on one and not the other is either unchoosable or refused.
void main() {
  test('the catalog is the console catalog, pair for pair', () {
    final source =
        File('../admin_web/src/lib/ocean-carrier-catalog.ts').readAsStringSync();
    final pairs = RegExp(r'\{scac: "([A-Z0-9]+)", name: "([^"]+)"')
        .allMatches(source)
        .map((m) => '${m.group(1)}=${m.group(2)}')
        .toList();
    expect(pairs, isNotEmpty);
    expect(oceanCarriers.map((c) => '${c.scac}=${c.name}').toList(), pairs);
  });

  test('a line reads as its name and code, an unknown one as its code', () {
    expect(oceanCarrierLabel('MSCU'), 'MSC · MSCU');
    expect(oceanCarrierLabel(' mscu '), 'MSC · MSCU');
    expect(oceanCarrierLabel('SUDU'), 'SUDU');
    expect(oceanCarrierLabel(''), '');
  });
}
