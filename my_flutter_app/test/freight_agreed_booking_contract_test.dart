import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// An accepted quote is the price - whole, flat, never weighed. The booking
/// screen used to keep the catalogue funnel on top of it: per-kg mode cards
/// defaulting to sea for an air-quoted parcel, a weight demand that blocked
/// the submit with "enter parcel weight", and estimate copy promising a
/// weight confirmation the server never performs. Mirrors the web collapse.
void main() {
  final source = File(
    'lib/screens/send_freight_screen.dart',
  ).readAsStringSync();

  test('an agreed price books without a weight', () {
    expect(
      source,
      contains('!_setPrice && !_hasAgreedPrice && _weightKg <= 0'),
    );
  });

  test('the agreed deal card replaces the catalogue funnel', () {
    // Mode cards, category table and coverage section all quote the
    // catalogue - the deal card restates the accepted answer instead.
    expect(source, contains('if (_itemPriced && !_hasAgreedPrice) ...['));
    expect(source, contains('_agreedDealSection(theme, l10n, o)'));
    expect(source, contains('!_hasAgreedPrice && _categories.isNotEmpty'));
    expect(
      source,
      contains('!_hasAgreedPrice && o.freightCoverage != null'),
    );
    expect(source, contains('l10n.freightAgreedPriceFinal'));
    // The button says what happens: the whole price is booked and paid,
    // not an estimate.
    expect(source, contains('_setPrice || _hasAgreedPrice'));
  });

  test('the booking opens on the mode the price was quoted for', () {
    expect(source, contains('modes.contains(widget.agreedMode)'));
    final details = File(
      'lib/screens/freight_quote_details_screen.dart',
    ).readAsStringSync();
    expect(details, contains('agreedMode: request?.mode'));
    expect(details, contains('agreedCoversLoss:'));
    final model = File('lib/models/freight_quote.dart').readAsStringSync();
    expect(model, contains("mode: (data['mode'] ?? '') as String"));
    expect(model, contains("selectedCoversLoss: data['selectedCoversLoss']"));
  });
}
