import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/line_pieces.dart';
import 'package:my_flutter_app/services/waiting_packages.dart';

/// Owner decision 2026-10-18: a collected request's pickup fee is the line's
/// own amount, never spread into the piece prices. Barrel $90 · Box $40 ·
/// Pickup fee $20 · Total $150 - the same numbers as the server's
/// (`functions/test/line-pieces.test.js`) and the console's
/// (`admin_web/src/lib/pickup-fee.test.ts`) suites.
void main() {
  final pieces = <Map<String, Object?>>[
    {'id': 'p1', 'kind': 'barrel', 'priceCents': 9000},
    {'id': 'p2', 'kind': 'box', 'description': 'Clothes', 'priceCents': 4000},
  ];
  final stored = <String, dynamic>{
    'kind': 'other',
    'quantity': 2,
    'ownerKind': 'customer',
    'customerName': 'Fatou Diallo',
    'source': 'request',
    'pieces': pieces,
    'pickupFeeCents': 2000,
    'priceCents': 15000,
    'paidCents': 0,
    'pieceCount': 2,
  };

  test('a stored line reads its fee apart from its pieces', () {
    final line = ContainerLine.fromMap('l1', stored);
    expect(line.pickupFeeCents, 2000);
    expect(line.hasPickupFee, isTrue);
    expect([for (final p in line.allPieces) p.priceCents], [9000, 4000]);
    expect(line.counts.pieceCount, 2, reason: 'a fee is no piece');
    expect(line.groupFields['pickupFeeCents'], 2000);
  });

  test('a legacy or counter line has no fee and keeps its price', () {
    final legacy = ContainerLine.fromMap('l2', {
      'kind': 'barrels',
      'quantity': 2,
      'priceCents': 20000,
    });
    expect(legacy.pickupFeeCents, 0);
    expect(legacy.hasPickupFee, isFalse);
    expect(legacy.groupFields.containsKey('pickupFeeCents'), isFalse);
    final counter = ContainerLine.fromMap('l3', {
      ...stored,
      'pickupFeeCents': null,
      'priceCents': 13000,
    });
    expect(counter.hasPickupFee, isFalse);
  });

  test('the draft totals pieces plus fee and sends the fee on its own', () {
    final draft = ContainerLineDraft(
      kind: 'other',
      ownerKind: 'customer',
      customerName: 'Fatou Diallo',
      pieces: pieces,
      pickupFeeCents: 2000,
    );
    expect(draft.totalCents, 15000);
    final record = containerLineRecord(draft);
    expect(record['pickupFeeCents'], 2000);
    expect(
      [for (final p in record['pieces'] as List) (p as Map)['priceCents']],
      [9000, 4000],
    );
    expect(validateContainerLine(draft), isEmpty);
    final bad = ContainerLineDraft(
      kind: 'other',
      ownerKind: 'customer',
      customerName: 'Fatou Diallo',
      pieces: pieces,
      pickupFeeCents: 0,
      pickupFeeInvalid: true,
    );
    expect(validateContainerLine(bad), contains('pickup_fee_invalid'));
    final none = ContainerLineDraft(
      kind: 'other',
      ownerKind: 'customer',
      customerName: 'Fatou Diallo',
      pieces: pieces,
    );
    expect(none.totalCents, 13000);
    expect(containerLineRecord(none).containsKey('pickupFeeCents'), isFalse);
  });

  test('a total below the fee is refused before the round trip', () {
    expect(packagePriceBelowPickupFee(1500, 2000), isTrue);
    expect(packagePriceBelowPickupFee(2000, 2000), isFalse);
    expect(packagePriceBelowPickupFee(null, 2000), isFalse);
    expect(packagePriceBelowPickupFee(100, 0), isFalse);
  });

  test('a split keeps the fee on the root; the group owes it once', () {
    final root = {
      ...stored,
      'pieces': [pieces[0]],
      'priceCents': 11000,
      'rootLineId': 'l1',
      'partIndex': 1,
      'paidCents': 5000,
    };
    final part = {
      ...stored,
      'pieces': [pieces[1]],
      'pickupFeeCents': null,
      'priceCents': 4000,
      'rootLineId': 'l1',
      'partIndex': 2,
    };
    final group = lineGroupSummary([
      {'id': 'l1', 'line': root},
      {'id': 'l2', 'line': part},
    ], 'l1');
    expect(group.priceCents, 15000);
    expect(group.pickupFeeCents, 2000);
    expect(group.balanceCents, 10000);
  });
}
