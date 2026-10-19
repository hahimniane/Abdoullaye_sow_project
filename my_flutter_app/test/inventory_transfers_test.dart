import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart' show Timestamp;
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/widgets.dart' show Locale;
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/services/inventory.dart';
import 'package:my_flutter_app/services/inventory_service.dart';
import 'package:my_flutter_app/services/inventory_stores.dart';
import 'package:my_flutter_app/services/inventory_transfers.dart';
import 'package:my_flutter_app/widgets/inventory_transfer_widgets.dart';
import 'package:my_flutter_app/widgets/inventory_widgets.dart';

/// Store transfers (docs/INVENTORY.md, v5), the pure rules: the document as
/// stored, the tabs and their counts, how a card and a line read, who may do
/// what (mirroring the callables), the requests, and the refusals.

const _bronx = InventoryStore(id: 's-bx', name: 'Bronx store', isMain: true);
const _harlem = InventoryStore(id: 's-hl', name: 'Harlem store');
const _queens = InventoryStore(id: 's-qn', name: 'Queens store');
const _stores = [_bronx, _harlem, _queens];

InventoryTransferViewer _viewer(
  InventoryAccess access, {
  String userId = 'me',
}) => InventoryTransferViewer(
  stores: InventoryStoreContext(stores: _stores, access: access),
  userId: userId,
);

final _owner = _viewer(const InventoryAccess.owner(), userId: 'owner');
final _allStaff = _viewer(const InventoryAccess(allStores: true));
final _bronxStaff = _viewer(const InventoryAccess(homeStoreId: 's-bx'));
final _harlemStaff = _viewer(const InventoryAccess(homeStoreId: 's-hl'));
final _queensStaff = _viewer(const InventoryAccess(homeStoreId: 's-qn'));
final _noStore = _viewer(const InventoryAccess());

InventoryTransfer _t(
  String id, {
  String status = 'in_transit',
  String? stage,
  String from = 's-bx',
  String to = 's-hl',
  DateTime? sentAt,
  DateTime? updatedAt,
  String sentBy = 'u-sender',
  String createdBy = 'u-sender',
  List<Map<String, Object?>> lines = const [
    {'itemId': 'i1', 'quantitySent': 6},
  ],
  int openMissing = 0,
  String businessId = 'b1',
}) => InventoryTransfer.fromMap(id, {
  'businessId': businessId,
  'code': 'TR-$id',
  'status': status,
  'stage': ?stage,
  'fromStoreId': from,
  'toStoreId': to,
  'fromStoreName': 'old $from',
  'toStoreName': 'old $to',
  'lines': lines,
  'openMissingCount': openMissing,
  'sentAt': ?sentAt,
  'updatedAt': ?updatedAt,
  'sentByStaffId': sentBy,
  'createdByStaffId': createdBy,
});

void main() {
  final l10n = lookupAppLocalizations(const Locale('en'));
  final fr = lookupAppLocalizations(const Locale('fr'));
  setUpAll(() async {
    await initializeDateFormatting('en');
    await initializeDateFormatting('fr');
  });

  group('a transfer document', () {
    test('reads every field, with Timestamps', () {
      final sent = DateTime(2026, 10, 18, 14, 40);
      final t = InventoryTransfer.fromMap('t1', {
        'businessId': 'b1',
        'clientRequestId': 'transfer-abc-123',
        'code': 'tr-4k8q2a',
        'status': 'received_with_differences',
        'stage': 'review',
        'fromStoreId': 's-bx',
        'fromStoreName': 'Bronx store',
        'toStoreId': 's-hl',
        'toStoreName': 'Harlem store',
        'lines': [
          {
            'itemId': 'i1',
            'name': '11',
            'brand': 'Jordan',
            'code': 'IT-K7M4P2',
            'costCents': 4000,
            'quantitySent': 6,
            'quantityReceived': 4,
            'missing': 2,
            'resolution': '',
          },
          {
            'itemId': 'i2',
            'name': 'Air Force 1',
            'quantitySent': 5,
            'quantityReceived': 5,
            'missing': 0,
            'costCents': null,
          },
        ],
        'itemIds': ['i1', 'i2'],
        'productsCount': 2,
        'itemsCount': 11,
        'receivedCount': 9,
        'missingCount': 2,
        'openMissingCount': 2,
        'valueCents': 24000,
        'sentByName': 'Ibrahima',
        'sentAt': Timestamp.fromDate(sent),
        'receivedAt': Timestamp.fromDate(sent.add(const Duration(hours: 3))),
        'receivedByName': 'Aminata',
        'receiveNote': 'Box arrived opened',
        'timeline': [
          {
            'event': 'sent',
            'byName': 'Ibrahima',
            'at': Timestamp.fromDate(sent),
            'itemsCount': 11,
          },
          {
            'event': 'received',
            'byName': 'Aminata',
            'receivedCount': 9,
            'missingCount': 2,
            'note': 'Box arrived opened',
          },
        ],
      });
      expect(t.code, 'TR-4K8Q2A');
      expect(t.status, InventoryTransferStatus.receivedWithDifferences);
      expect(t.stage, InventoryTransferStage.review);
      expect(t.inReview, isTrue);
      expect(t.isReceived, isTrue);
      expect(t.lines.first.displayName, 'Jordan 11');
      expect(t.lines.first.costCents, 4000);
      expect(t.lines.last.costCents, isNull);
      expect(t.lines.first.open, isTrue);
      expect(t.lines.last.open, isFalse);
      expect(t.arrivedCount, 9);
      expect(t.sentAt, sent);
      expect(t.timeline, hasLength(2));
      expect(t.timeline.first.itemsCount, 11);
      expect(t.timeline.last.note, 'Box arrived opened');
      expect(t.clientRequestId, 'transfer-abc-123');
    });

    test(
      'tolerates missing fields: a bare draft, a stage read from status',
      () {
        final bare = InventoryTransfer.fromMap('t2', const {});
        expect(bare.status, InventoryTransferStatus.draft);
        expect(bare.stage, InventoryTransferStage.draft);
        expect(bare.lines, isEmpty);
        expect(bare.itemsCount, 0);
        expect(bare.receivedCount, isNull);
        expect(bare.sentAt, isNull);
        // No stage: in transit, review while a missing line is open, else done.
        final moving = InventoryTransfer.fromMap('t3', {
          'status': 'in_transit',
          'lines': [
            {'itemId': 'i1', 'quantitySent': '4'},
          ],
        });
        expect(moving.stage, InventoryTransferStage.inTransit);
        expect(moving.itemsCount, 4);
        expect(moving.productsCount, 1);
        final short = InventoryTransfer.fromMap('t4', {
          'status': 'received_with_differences',
          'lines': [
            {
              'itemId': 'i1',
              'quantitySent': 4,
              'quantityReceived': 3,
              'missing': 1,
            },
          ],
        });
        expect(short.openMissingCount, 1);
        expect(short.stage, InventoryTransferStage.review);
        final settled = InventoryTransfer.fromMap('t5', {
          'status': 'received_with_differences',
          'lines': [
            {
              'itemId': 'i1',
              'quantitySent': 4,
              'quantityReceived': 3,
              'missing': 1,
              'resolution': 'returned',
            },
          ],
        });
        expect(settled.stage, InventoryTransferStage.done);
        // Negative and odd numbers never go below zero.
        final odd = InventoryTransfer.fromMap('t6', {
          'itemsCount': -3,
          'lines': [
            {'itemId': 'i1', 'quantitySent': -2},
          ],
        });
        expect(odd.itemsCount, 0);
        expect(odd.lines.single.quantitySent, 0);
      },
    );

    test('shows the store\'s current name, else the snapshot', () {
      final stores = InventoryStoreContext(stores: _stores);
      final t = _t('a', to: 's-gone');
      expect(t.fromName(stores), 'Bronx store');
      expect(t.toName(stores), 'old s-gone');
    });
  });

  group('who may do what (the callables\' rules)', () {
    final moving = _t('m', sentBy: 'me');
    final draft = _t('d', status: 'draft', createdBy: 'u-x');
    final review = _t(
      'r',
      status: 'received_with_differences',
      stage: 'review',
      openMissing: 2,
    );

    test('may send from: owner, all-stores staff, staff of that store', () {
      expect(_owner.maySendFrom('s-hl'), isTrue);
      expect(_allStaff.maySendFrom('s-qn'), isTrue);
      expect(_bronxStaff.maySendFrom('s-bx'), isTrue);
      expect(_bronxStaff.maySendFrom('s-hl'), isFalse);
      expect(_noStore.maySendFrom('s-bx'), isFalse);
      expect(_noStore.blocked, isTrue);
      expect(_bronxStaff.canStartTransfer, isTrue);
      expect(_noStore.canStartTransfer, isFalse);
      // One store: nothing about transfers.
      final single = InventoryTransferViewer(
        stores: InventoryStoreContext(stores: const [_bronx]),
      );
      expect(single.canStartTransfer, isFalse);
    });

    test(
      'cancel: the sender, the owner, all-stores staff; in transit only',
      () {
        expect(canCancelTransfer(moving, _bronxStaff), isTrue); // the sender
        expect(canCancelTransfer(_t('m2'), _bronxStaff), isFalse);
        expect(canCancelTransfer(_t('m2'), _owner), isTrue);
        expect(canCancelTransfer(_t('m2'), _allStaff), isTrue);
        expect(canCancelTransfer(_t('m2'), _harlemStaff), isFalse);
        expect(canCancelTransfer(review, _owner), isFalse);
      },
    );

    test('discard a draft: its creator, a sender of its store, the owner', () {
      expect(canDiscardTransferDraft(draft, _bronxStaff), isTrue);
      expect(canDiscardTransferDraft(draft, _harlemStaff), isFalse);
      expect(
        canDiscardTransferDraft(
          draft,
          _viewer(const InventoryAccess(homeStoreId: 's-qn'), userId: 'u-x'),
        ),
        isTrue,
      );
      expect(canDiscardTransferDraft(draft, _owner), isTrue);
      expect(canDiscardTransferDraft(moving, _owner), isFalse);
      expect(canEditTransferDraft(draft, _bronxStaff), isTrue);
      expect(canEditTransferDraft(draft, _harlemStaff), isFalse);
    });

    test('receive: the destination\'s staff, owner, all-stores staff', () {
      expect(canReceiveTransfer(moving, _harlemStaff), isTrue);
      expect(canReceiveTransfer(moving, _bronxStaff), isFalse);
      expect(canReceiveTransfer(moving, _owner), isTrue);
      expect(canReceiveTransfer(moving, _allStaff), isTrue);
      expect(canReceiveTransfer(draft, _owner), isFalse);
    });

    test('resolve: owner and all-stores staff, in review only', () {
      expect(canResolveTransfer(review, _owner), isTrue);
      expect(canResolveTransfer(review, _allStaff), isTrue);
      expect(canResolveTransfer(review, _harlemStaff), isFalse);
      expect(canResolveTransfer(moving, _owner), isFalse);
    });

    test('a push opens receive, review or the detail', () {
      expect(
        inventoryTransferOpenTarget(moving, _harlemStaff),
        InventoryTransferTarget.receive,
      );
      expect(
        inventoryTransferOpenTarget(review, _owner),
        InventoryTransferTarget.review,
      );
      expect(
        inventoryTransferOpenTarget(review, _harlemStaff),
        InventoryTransferTarget.detail,
      );
      expect(
        inventoryTransferOpenTarget(moving, _bronxStaff),
        InventoryTransferTarget.detail,
      );
    });

    test('who may see one: business, store reach, drafts to senders only', () {
      bool sees(InventoryTransfer t, InventoryTransferViewer v) =>
          inventoryTransferVisible(t, businessId: 'b1', viewer: v);
      expect(sees(moving, _harlemStaff), isTrue);
      expect(sees(moving, _bronxStaff), isTrue);
      expect(sees(moving, _queensStaff), isFalse);
      expect(sees(moving, _noStore), isFalse);
      expect(sees(_t('x', businessId: 'other'), _owner), isFalse);
      // A draft going to Harlem: Harlem's staff never see it.
      expect(sees(draft, _harlemStaff), isFalse);
      expect(sees(draft, _bronxStaff), isTrue);
      expect(sees(draft, _owner), isTrue);
    });
  });

  group('the four tabs', () {
    final now = DateTime(2026, 10, 18, 12);
    final transfers = [
      _t('out-moving', updatedAt: now.subtract(const Duration(hours: 1))),
      _t(
        'out-draft',
        status: 'draft',
        updatedAt: now.subtract(const Duration(days: 3)),
      ),
      _t('out-done', status: 'received', stage: 'done', updatedAt: now),
      _t('in-moving', from: 's-qn', to: 's-bx', updatedAt: now),
      _t(
        'in-review',
        from: 's-qn',
        to: 's-bx',
        status: 'received_with_differences',
        stage: 'review',
        openMissing: 1,
      ),
      _t('queens-harlem', from: 's-qn', to: 's-hl'),
      _t('queens-draft-to-bronx', from: 's-qn', to: 's-bx', status: 'draft'),
    ];

    List<String> ids(List<InventoryTransfer> list) => [
      for (final t in list) t.id,
    ];

    test('one store: from it, to it, either way in transit, either way in '
        'review', () {
      final lists = InventoryTransferLists.of(
        transfers,
        viewer: _bronxStaff,
        businessId: 'b1',
      );
      // Drafts first, then in transit, then the rest.
      expect(ids(lists.of(InventoryTransferTab.outgoing)), [
        'out-draft',
        'out-moving',
        'out-done',
      ]);
      // Not drafts (Queens' draft to Bronx is not Bronx's to see), in
      // transit first.
      expect(ids(lists.of(InventoryTransferTab.incoming)), [
        'in-moving',
        'in-review',
      ]);
      expect(ids(lists.of(InventoryTransferTab.inTransit)), [
        'in-moving',
        'out-moving',
      ]);
      expect(ids(lists.of(InventoryTransferTab.review)), ['in-review']);
      // Counts: what is on its way; Review: what waits for a decision.
      expect(lists.count(InventoryTransferTab.outgoing), 1);
      expect(lists.count(InventoryTransferTab.incoming), 1);
      expect(lists.count(InventoryTransferTab.inTransit), 2);
      expect(lists.count(InventoryTransferTab.review), 1);
    });

    test('all stores: everything, everything moving, everything in review', () {
      final lists = InventoryTransferLists.of(
        transfers,
        viewer: _owner,
        businessId: 'b1',
      );
      expect(lists.of(InventoryTransferTab.outgoing), hasLength(7));
      expect(
        lists.of(InventoryTransferTab.outgoing).take(2).map((t) => t.id),
        containsAll(['out-draft', 'queens-draft-to-bronx']),
      );
      expect(ids(lists.of(InventoryTransferTab.incoming)).toSet(), {
        'out-moving',
        'in-moving',
        'queens-harlem',
      });
      expect(lists.count(InventoryTransferTab.inTransit), 3);
      expect(ids(lists.of(InventoryTransferTab.review)), ['in-review']);
      // An all-stores viewer who picks one store reads like its staff.
      final picked = InventoryTransferLists.of(
        transfers,
        viewer: _owner,
        businessId: 'b1',
        storeId: 's-hl',
      );
      expect(ids(picked.of(InventoryTransferTab.incoming)).toSet(), {
        'out-moving',
        'out-done',
        'queens-harlem',
      });
      expect(picked.of(InventoryTransferTab.outgoing), isEmpty);
    });

    test('the entry tile counts what is coming in and what to review', () {
      expect(
        inventoryTransferEntryCounts(
          transfers,
          viewer: _bronxStaff,
          businessId: 'b1',
        ),
        (incoming: 1, review: 1),
      );
      expect(
        inventoryTransferEntryCounts(
          transfers,
          viewer: _harlemStaff,
          businessId: 'b1',
        ),
        (incoming: 2, review: 0),
      );
      expect(
        inventoryTransferEntryCounts(
          transfers,
          viewer: _noStore,
          businessId: 'b1',
        ),
        (incoming: 0, review: 0),
      );
    });
  });

  group('how a card and a line read', () {
    final sent = DateTime(2026, 10, 15, 14, 40);

    test('"In transit 3 days" from 2 days on, highlighted', () {
      final t = _t('a', sentAt: sent);
      expect(
        inventoryTransferTransitDays(t, sent.add(const Duration(hours: 47))),
        1,
      );
      expect(
        inventoryTransferCardState(t, sent.add(const Duration(hours: 47))),
        InventoryTransferCardState.inTransit,
      );
      expect(
        inventoryTransferCardState(t, sent.add(const Duration(hours: 48))),
        InventoryTransferCardState.late,
      );
      expect(
        inventoryTransferTransitDays(t, sent.add(const Duration(days: 3))),
        3,
      );
      expect(
        inventoryTransferChip(l10n, t, sent.add(const Duration(days: 3))).label,
        'In transit 3 days',
      );
      expect(
        inventoryTransferChip(fr, t, sent.add(const Duration(days: 3))).label,
        'En route depuis 3 jours',
      );
      // Not in transit: no age.
      expect(
        inventoryTransferTransitDays(
          _t('b', status: 'received', sentAt: sent),
          sent,
        ),
        isNull,
      );
    });

    test('every state has its word', () {
      final now = DateTime(2026, 10, 18);
      String label(InventoryTransfer t) =>
          inventoryTransferChip(l10n, t, now).label;
      expect(label(_t('d', status: 'draft')), 'Draft');
      expect(label(_t('m')), 'In transit');
      expect(label(_t('r', status: 'received', stage: 'done')), 'Received');
      expect(
        label(_t('v', status: 'received_with_differences', stage: 'review')),
        'Needs review',
      );
      expect(
        label(_t('s', status: 'received_with_differences', stage: 'done')),
        'Settled',
      );
      expect(label(_t('c', status: 'cancelled', stage: 'done')), 'Cancelled');
      expect(
        inventoryTransferCardDetail(l10n, _t('d', status: 'draft'), now, 'en'),
        '6 items · not sent · nothing reserved yet',
      );
      final received = InventoryTransfer.fromMap('rc', {
        'status': 'received',
        'stage': 'done',
        'itemsCount': 10,
        'receivedCount': 10,
        'receivedByName': 'Aminata',
        'receivedAt': DateTime(2026, 10, 15, 9),
      });
      expect(
        inventoryTransferCardDetail(l10n, received, now, 'en'),
        '10 of 10 received · Oct 15 by Aminata',
      );
    });

    test('a line\'s result: complete, disputed, returned, written off', () {
      InventoryTransferLine line(Map<String, Object?> extra) =>
          InventoryTransferLine.fromMap({
            'itemId': 'i1',
            'quantitySent': 6,
            ...extra,
          });
      String text(Map<String, Object?> extra) =>
          inventoryTransferResultText(l10n, line(extra), 'Bronx store');
      expect(text({}), '');
      expect(
        inventoryTransferLineResult(line({})).kind,
        InventoryTransferLineResultKind.pending,
      );
      expect(text({'quantityReceived': 6}), 'Complete');
      expect(
        text({'quantityReceived': 4, 'missing': 2}),
        '2 missing · disputed',
      );
      expect(
        text({'quantityReceived': 4, 'missing': 2, 'resolution': 'returned'}),
        '2 returned to Bronx store',
      );
      expect(
        text({
          'quantityReceived': 4,
          'missing': 2,
          'resolution': 'written_off',
          'writeOffReason': 'lost',
        }),
        '2 written off · Lost in transit',
      );
      expect(
        inventoryTransferResultText(
          fr,
          line({'quantityReceived': 5, 'missing': 1}),
          'Bronx',
        ),
        '1 manquant · en litige',
      );
    });

    test('the track record in words', () {
      final stores = InventoryStoreContext(stores: _stores);
      final t = _t('a');
      String say(Map<String, Object?> e) => inventoryTransferEventText(
        l10n,
        InventoryTransferEvent.fromMap(e),
        t,
        stores,
      );
      expect(
        say({'event': 'sent', 'byName': 'Ibrahima', 'itemsCount': 14}),
        'Sent by Ibrahima (14 items)',
      );
      expect(
        say({
          'event': 'received',
          'byName': 'Aminata',
          'receivedCount': 12,
          'missingCount': 2,
        }),
        'Aminata confirmed 12 received, 2 missing',
      );
      expect(
        say({
          'event': 'written_off',
          'byName': 'Awa',
          'quantity': 2,
          'itemName': 'Jordan 11',
          'reason': 'damaged',
        }),
        'Awa wrote off 2 of Jordan 11: Damaged',
      );
      // Nobody is shown by uid: no name reads "Team member".
      expect(
        say({'event': 'draft_created', 'byStaffId': 'uid-1'}),
        'Draft started by Team member',
      );
      expect(say({'event': 'something_new'}), '');
    });

    test('movement labels: the instant transfer and each transfer step', () {
      InventoryMovement move(String type, {String code = ''}) =>
          InventoryMovement.fromMap('m', {
            'type': type,
            'transferId': 't1',
            'transferCode': code,
          });
      expect(
        inventoryMovementTitle(l10n, move('transfer_out')),
        'Instant transfer',
      );
      expect(
        inventoryMovementTitle(l10n, move('transfer_in')),
        'Instant transfer',
      );
      expect(move('transfer_in').isInstantTransfer, isTrue);
      expect(
        inventoryMovementTitle(l10n, move('transfer_sent', code: 'TR-ABC123')),
        'Sent in a transfer',
      );
      expect(
        move('transfer_sent', code: 'TR-ABC123').isInstantTransfer,
        isFalse,
      );
      expect(
        inventoryMovementLabel(l10n, 'transfer_received'),
        'Received from a transfer',
      );
      expect(
        inventoryMovementLabel(l10n, 'transfer_cancelled'),
        'Transfer cancelled',
      );
      expect(
        inventoryMovementLabel(l10n, 'transfer_returned'),
        'Returned from a transfer',
      );
      expect(
        inventoryMovementLabel(l10n, 'transfer_written_off'),
        'Written off in a transfer',
      );
      expect(inventoryMovementLabel(fr, 'transfer_out'), 'Transfert immédiat');
      final read = InventoryMovement.fromMap('m', {
        'type': 'transfer_received',
        'transferCode': 'tr-abc123',
        'counterpartStoreId': 's-bx',
      });
      expect(read.transferCode, 'TR-ABC123');
      expect(read.counterpartStoreId, 's-bx');
    });
  });

  group('composing a transfer', () {
    final soap = InventoryItem(
      id: 'i1',
      businessId: 'b1',
      name: '11',
      brand: 'Jordan',
      code: 'IT-K7M4P2',
      priceCents: 100,
    );
    final oil = InventoryItem(
      id: 'i2',
      businessId: 'b1',
      name: 'Oil',
      code: 'IT-CCCCCC',
      priceCents: 100,
    );

    test('adds, merges, caps at what the source holds, removes', () {
      var c = const InventoryTransferComposer(
        clientRequestId: 'transfer-1',
        fromStoreId: 's-bx',
        toStoreId: 's-hl',
      );
      c = c.add(soap, max: 3);
      expect(c.lines.single.name, 'Jordan 11');
      expect(c.lines.single.quantity, 1);
      c = c.add(soap, max: 3); // the same product again: one more on its line
      expect(c.lines, hasLength(1));
      expect(c.quantityOf('i1'), 2);
      c = c.setQuantity('i1', 9, max: 3);
      expect(c.quantityOf('i1'), 3);
      c = c.add(soap, max: 3); // already all of them
      expect(c.quantityOf('i1'), 3);
      c = c.setQuantity('i1', 0, max: 3);
      expect(c.quantityOf('i1'), 1);
      c = c.add(oil, max: 0); // the store holds none: not listed
      expect(c.lines, hasLength(1));
      c = c.add(oil, max: 12).setQuantity('i2', 5, max: 12);
      expect(c.productsCount, 2);
      expect(c.itemsCount, 6);
      expect(c.request('b1'), {
        'businessId': 'b1',
        'clientRequestId': 'transfer-1',
        'fromStoreId': 's-bx',
        'toStoreId': 's-hl',
        'lines': [
          {'itemId': 'i1', 'quantity': 1},
          {'itemId': 'i2', 'quantity': 5},
        ],
      });
      expect(c.remove('i1').lines.single.itemId, 'i2');
    });

    test('stores: a new source clears the same destination', () {
      const c = InventoryTransferComposer(
        clientRequestId: 'k',
        fromStoreId: 's-bx',
        toStoreId: 's-hl',
      );
      expect(c.withFrom('s-hl').toStoreId, '');
      expect(c.withFrom('s-qn').toStoreId, 's-hl');
      expect(c.withTo('s-bx').toStoreId, '');
    });

    test('what stops a save or a send', () {
      const empty = InventoryTransferComposer(clientRequestId: 'k');
      expect(empty.problems(sending: false), [
        'store_required',
        'transfer_lines_required',
      ]);
      final ready = const InventoryTransferComposer(
        clientRequestId: 'k',
        fromStoreId: 's-bx',
        toStoreId: 's-hl',
      ).add(soap, max: 5).setQuantity('i1', 4, max: 5);
      expect(ready.problems(sending: true, maxOf: (_) => 5), isEmpty);
      // The source holds fewer now: Send refuses, a draft does not care.
      expect(ready.problems(sending: true, maxOf: (_) => 3), [
        'insufficient_stock',
      ]);
      expect(ready.problems(sending: false, maxOf: (_) => 3), isEmpty);
    });

    test('a draft reopens with its key, stores and merged lines', () {
      final draft = InventoryTransfer.fromMap('t', {
        'clientRequestId': 'transfer-draft-1',
        'status': 'draft',
        'fromStoreId': 's-bx',
        'toStoreId': 's-qn',
        'lines': [
          {'itemId': 'i1', 'name': '11', 'brand': 'Jordan', 'quantitySent': 2},
          {'itemId': 'i1', 'name': '11', 'brand': 'Jordan', 'quantitySent': 3},
        ],
      });
      final c = InventoryTransferComposer.fromDraft(draft);
      expect(c.clientRequestId, 'transfer-draft-1');
      expect(c.toStoreId, 's-qn');
      expect(c.lines.single.quantity, 5);
      expect(c.lines.single.name, 'Jordan 11');
    });

    test('the most a line may send is the source store\'s count', () {
      final stock = InventoryStockIndex(const [
        InventoryStockRow(itemId: 'i2', storeId: 's-hl', quantity: 4),
      ]);
      final stores = InventoryStoreContext(stores: _stores);
      final counted = InventoryItem(
        id: 'i2',
        businessId: 'b1',
        name: 'Oil',
        code: 'IT-CCCCCC',
        priceCents: 1,
        quantity: 9,
        storeStock: true,
      );
      expect(inventoryTransferMaxFor(counted, stores, stock, 's-hl'), 4);
      expect(inventoryTransferMaxFor(counted, stores, stock, 's-bx'), 0);
      // Not yet counted per store: Main holds the whole count.
      final legacy = InventoryItem(
        id: 'i3',
        businessId: 'b1',
        name: 'Tin',
        code: 'IT-DDDDDD',
        priceCents: 1,
        quantity: 7,
      );
      expect(inventoryTransferMaxFor(legacy, stores, stock, 's-bx'), 7);
      expect(inventoryTransferMaxFor(legacy, stores, stock, 's-hl'), 0);
      expect(inventoryTransferMaxFor(legacy, stores, stock, ''), 0);
    });

    test('a fresh retry key fits the server\'s rule', () {
      final id = newInventoryTransferRequestId(Random(1), DateTime(2026));
      expect(RegExp(r'^[A-Za-z0-9_.:-]{8,100}$').hasMatch(id), isTrue);
      expect(id, startsWith('transfer-'));
      expect(
        newInventoryTransferRequestId(),
        isNot(newInventoryTransferRequestId()),
      );
    });
  });

  group('receiving', () {
    final t = InventoryTransfer.fromMap('t1', {
      'status': 'in_transit',
      'lines': [
        {'itemId': 'i1', 'name': 'Jordan 11', 'quantitySent': 6},
        {'itemId': 'i2', 'name': 'Air Force 1', 'quantitySent': 5},
        {'itemId': 'i3', 'name': 'Hoodie', 'quantitySent': 3},
      ],
    });

    test(
      'starts at what was sent; counts what arrived and what is missing',
      () {
        final counted = inventoryTransferReceivePrefill(t);
        expect(counted, {'i1': 6, 'i2': 5, 'i3': 3});
        expect(inventoryTransferMissing(t, counted), 0);
        counted['i1'] = 4;
        expect(inventoryTransferCounted(t, counted), 12);
        expect(inventoryTransferMissing(t, counted), 2);
        final short = inventoryTransferShortLines(t, counted);
        expect(short.single.line.itemId, 'i1');
        expect(short.single.counted, 4);
        // Never above what was sent, never below 0.
        expect(inventoryTransferCounted(t, {'i1': 99, 'i2': -1}), 9);
      },
    );

    test('the request carries every line, the note and the retry key', () {
      expect(
        receiveInventoryTransferRequest(
          businessId: 'b1',
          transfer: t,
          counted: {'i1': 4, 'i2': 5, 'i3': 3},
          requestId: 'rq-1',
          note: '  Box arrived opened ',
        ),
        {
          'businessId': 'b1',
          'transferId': 't1',
          'lines': [
            {'itemId': 'i1', 'quantityReceived': 4},
            {'itemId': 'i2', 'quantityReceived': 5},
            {'itemId': 'i3', 'quantityReceived': 3},
          ],
          'note': 'Box arrived opened',
          'requestId': 'rq-1',
        },
      );
      final noNote = receiveInventoryTransferRequest(
        businessId: 'b1',
        transfer: t,
        counted: const {},
        requestId: 'rq-2',
      );
      expect(noNote.containsKey('note'), isFalse);
      expect((noNote['lines'] as List).first, {
        'itemId': 'i1',
        'quantityReceived': 6,
      });
    });

    test('cancel and resolve requests', () {
      expect(
        cancelInventoryTransferRequest(
          businessId: 'b1',
          transferId: 't1',
          requestId: 'c1',
        ),
        {'businessId': 'b1', 'transferId': 't1', 'requestId': 'c1'},
      );
      expect(
        resolveInventoryTransferLineRequest(
          businessId: 'b1',
          transferId: 't1',
          itemId: 'i1',
          writeOff: false,
          requestId: 'r1',
          reason: 'lost',
        ),
        {
          'businessId': 'b1',
          'transferId': 't1',
          'itemId': 'i1',
          'action': 'return',
          'requestId': 'r1',
        },
      );
      expect(
        resolveInventoryTransferLineRequest(
          businessId: 'b1',
          transferId: 't1',
          itemId: 'i1',
          writeOff: true,
          requestId: 'r2',
          reason: 'stolen',
          note: ' gone ',
        ),
        {
          'businessId': 'b1',
          'transferId': 't1',
          'itemId': 'i1',
          'action': 'write_off',
          'reason': 'stolen',
          'note': 'gone',
          'requestId': 'r2',
        },
      );
    });
  });

  group('refusals', () {
    test('every new code is its own failure, with words in both languages', () {
      for (final entry in {
        'transfer_not_found': InventoryFailure.transferNotFound,
        'transfer_not_draft': InventoryFailure.transferNotDraft,
        'transfer_not_in_transit': InventoryFailure.transferNotInTransit,
        'line_not_disputed': InventoryFailure.lineNotDisputed,
        'line_already_resolved': InventoryFailure.lineAlreadyResolved,
        'store_has_transfers': InventoryFailure.storeHasTransfers,
        'item_in_transfer': InventoryFailure.itemInTransfer,
        'item_not_in_transfer': InventoryFailure.itemNotInTransfer,
        'received_too_many': InventoryFailure.receivedTooMany,
        'write_off_reason_invalid': InventoryFailure.writeOffReasonInvalid,
        'resolution_invalid': InventoryFailure.resolutionInvalid,
        'note_too_long': InventoryFailure.noteTooLong,
        'transfer_lines_required': InventoryFailure.transferLinesRequired,
        'transfer_lines_too_many': InventoryFailure.transferLinesTooMany,
      }.entries) {
        final failure = inventoryFailureOf(
          code: 'failed-precondition',
          details: {'reason': entry.key},
        );
        expect(failure, entry.value, reason: entry.key);
        expect(inventoryFailureText(l10n, failure), isNotEmpty);
        expect(
          inventoryFailureText(fr, failure),
          isNot(inventoryFailureText(l10n, failure)),
          reason: '${entry.key} is translated',
        );
      }
    });

    test('not in transit says what it became', () {
      FirebaseFunctionsException gone(String status) =>
          FirebaseFunctionsException(
            message: 'no',
            code: 'failed-precondition',
            details: {'reason': 'transfer_not_in_transit', 'status': status},
          );
      expect(
        inventoryTransferFailureText(l10n, gone('received')),
        'Someone already confirmed this transfer.',
      );
      expect(
        inventoryTransferFailureText(l10n, gone('received_with_differences')),
        'Someone already confirmed this transfer.',
      );
      expect(
        inventoryTransferFailureText(l10n, gone('cancelled')),
        'This transfer was cancelled.',
      );
      expect(
        inventoryTransferFailureText(l10n, gone('draft')),
        'This transfer is no longer in transit.',
      );
      expect(inventoryTransferGoneOf({'reason': 'same_store'}), isNull);
      // Anything else reads like every inventory refusal.
      expect(
        inventoryTransferFailureText(
          l10n,
          FirebaseFunctionsException(message: 'x', code: 'unavailable'),
        ),
        inventoryFailureText(l10n, InventoryFailure.network),
      );
    });

    test('insufficient stock says what the store really holds', () {
      expect(
        inventoryTransferAvailableOf({
          'reason': 'insufficient_stock',
          'available': {'i1': 2, 'i2': '0'},
        }),
        {'i1': 2, 'i2': 0},
      );
      expect(inventoryTransferAvailableOf(null), isEmpty);
    });
  });

  group('answers and the summary', () {
    test('send and receive answers', () {
      final sent = InventoryTransferSendResult.fromCallable({
        'success': true,
        'transferId': 't1',
        'code': 'tr-abc',
        'status': 'in_transit',
        'itemsCount': 14,
        'productsCount': 3,
        'replayed': true,
      });
      expect(sent.code, 'TR-ABC');
      expect(sent.itemsCount, 14);
      expect(sent.replayed, isTrue);
      final got = InventoryTransferReceiveResult.fromCallable({
        'status': 'received_with_differences',
        'receivedCount': 12,
        'missingCount': 2,
      });
      expect(got.missingCount, 2);
      expect(InventoryTransferSendResult.fromCallable(null).transferId, '');
    });

    test('"In transit \$X · Disputed \$Y" only when there are any', () {
      final none = InventorySummary.fromCallable({'salesCount': 1});
      expect(none.transfers, isNull);
      expect(inventoryTransferSummaryLine(l10n, none.transfers), '');
      final zero = InventorySummary.fromCallable({
        'transfers': <String, Object?>{},
      });
      expect(zero.transfers!.any, isFalse);
      expect(inventoryTransferSummaryLine(l10n, zero.transfers), '');
      final some = InventorySummary.fromCallable({
        'transfers': {
          'inTransitCount': 2,
          'inTransitItems': 14,
          'inTransitValueCents': 56000,
          'disputedCount': 1,
          'disputedItems': 2,
          'disputedValueCents': 8000,
          'receivedCount': 3,
        },
      });
      expect(some.transfers!.inTransitItems, 14);
      expect(some.transfers!.receivedCount, 3);
      expect(
        inventoryTransferSummaryLine(l10n, some.transfers),
        'In transit \$560.00 · Disputed \$80.00',
      );
      // No known cost: pieces instead of a money figure.
      final noCost = InventorySummary.fromCallable({
        'transfers': {'inTransitCount': 1, 'inTransitItems': 3},
      });
      expect(
        inventoryTransferSummaryLine(l10n, noCost.transfers),
        'In transit 3 items',
      );
    });
  });

  test('the reads: open by stage, recent pages, two per store for staff', () {
    final all = inventoryTransfersOpenSpecs('b1');
    expect(all.single.filters.map((f) => '$f'), [
      'businessId equal b1',
      'stage whereIn [draft, in_transit, review]',
    ]);
    final staff = inventoryTransfersOpenSpecs('b1', storeId: 's-bx');
    expect(staff.map((s) => s.filters[1].field), ['fromStoreId', 'toStoreId']);
    final recent = inventoryTransfersRecentSpecs('b1');
    expect(recent.single.limit, 100);
    expect(recent.single.orderBy, 'createdAt');
    expect(recent.single.descending, isTrue);
    expect(
      inventoryTransfersRecentSpecs('b1', storeId: 's-bx').map((s) => s.limit),
      [50, 50],
    );
  });
}
