import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart' show Timestamp;
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/screens/business_requests_screen.dart';
import 'package:my_flutter_app/services/business_activity_queries.dart';
import 'package:my_flutter_app/services/notification_routing.dart';
import 'package:my_flutter_app/services/package_request_service.dart';
import 'package:my_flutter_app/services/package_requests.dart';

/// The rules behind every package-request screen (docs/PACKAGE_REQUESTS.md
/// §8): reading both shapes the server answers in, the form checks the
/// server makes, where a request stands, the lock, the payloads and links.

Map<String, dynamic> _doc([Map<String, dynamic> extra = const {}]) => {
  'businessId': 'b1',
  'businessName': 'Conakry Express',
  'code': 'R-K7M4P',
  'token': 'tok_abcdefghijklmnopqrstuvwxyz0123456789ABCDE',
  'handoff': 'bring_in',
  'locationId': 'loc1',
  'location': {'id': 'loc1', 'label': 'Bronx', 'address': '1 Main St'},
  'plannedDate': '2026-10-24',
  'sender': {'name': 'Fatou', 'phoneE164': '+19175551234', 'uid': 'u1'},
  'receiver': {'name': 'Mariama', 'phoneE164': '+224621234567'},
  'destinationCountryId': 'guinea',
  'destinationCountryName': 'Guinea',
  'pieces': [
    {'id': 'p1', 'kind': 'barrel', 'description': '', 'estimateCents': 12000},
    {
      'id': 'p2',
      'kind': 'other',
      'description': 'TV',
      'photoPaths': ['packageRequestPhotos/b1/u1/abcdefgh.jpg'],
      'estimateCents': null,
    },
  ],
  'status': 'new',
  'createdAt': Timestamp.fromMillisecondsSinceEpoch(1760000000000),
  ...extra,
};

RequestOption _option({bool bring = true, bool collect = true}) =>
    RequestOption.fromMap({
      'businessId': 'b1',
      'businessName': 'Conakry Express',
      'country': {'id': 'guinea', 'name': 'Guinea'},
      'barrelPriceCents': 12000,
      'bringIn': {
        'available': bring,
        'locations': [
          {
            'id': 'loc1',
            'label': 'Bronx',
            'address': '1 Main St',
            'hours': RequestWeekHours.standard().toMap(),
          },
        ],
      },
      'collect': {'available': collect, 'areas': 'Bronx'},
    });

RequestDraft _draft({
  String handoff = requestHandoffBringIn,
  String plannedDate = '2026-10-24',
  List<RequestPieceDraft> pieces = const [RequestPieceDraft()],
  String senderPhone = '+19175551234',
  String receiverPhone = '+224621234567',
  String pickupAddress = '',
  String pickupDate = '',
  String pickupWindow = '',
}) => RequestDraft(
  businessId: 'b1',
  destinationCountryId: 'guinea',
  handoff: handoff,
  locationId: 'loc1',
  plannedDate: plannedDate,
  pickupAddress: pickupAddress,
  pickupDate: pickupDate,
  pickupWindow: pickupWindow,
  senderName: 'Fatou',
  senderPhone: senderPhone,
  receiverName: 'Mariama',
  receiverPhone: receiverPhone,
  pieces: pieces,
  idempotencyKey: 'app_ABCDEFGHIJKLMNOPQRSTUVWX',
);

// Thursday, October 22, 2026.
final _today = DateTime(2026, 10, 22);

void main() {
  group('reading a request', () {
    test('the Firestore document', () {
      final r = PackageRequest.fromMap('r1', _doc());
      expect(r.id, 'r1');
      expect(r.businessName, 'Conakry Express');
      expect(r.senderUid, 'u1');
      expect(r.pieces, hasLength(2));
      expect(r.pieces[1].photoCount, 1);
      expect(r.priceOf(r.pieces[0]), 12000);
      expect(r.priceOf(r.pieces[1]), isNull);
      expect(r.isOpen, isTrue);
      expect(r.createdAt, DateTime.fromMillisecondsSinceEpoch(1760000000000));
      expect(r.timeZone, requestDefaultTimeZone);
    });

    test('the public projection, with ISO times and no phones', () {
      final r = PackageRequest.fromMap('', {
        'id': 'r1',
        'code': 'R-K7M4P',
        'status': 'estimate_sent',
        'handoff': 'collect',
        'business': {'id': 'b1', 'name': 'Conakry Express', 'phone': '+1718'},
        'destination': {'id': 'guinea', 'name': 'Guinea'},
        'pickup': {
          'address': '9 Elm',
          'date': '2026-10-25',
          'window': 'evening',
          'note': '',
        },
        'pieces': [
          {'id': 'p1', 'kind': 'box', 'description': 'Clothes', 'photoCount': 2},
        ],
        'estimate': {
          'version': 2,
          'totalCents': 4500,
          'pieces': [
            {'id': 'p1', 'cents': 4000},
          ],
          'pickupFeeCents': 500,
          'pickupSchedule': {'date': '2026-10-26', 'window': 'morning'},
          'note': 'Thanks',
          'sentAt': '2026-10-20T15:00:00.000Z',
        },
        'payment': {'timing': 'at_handoff', 'paidCents': 0},
        'expiresAt': '2026-11-03T15:00:00.000Z',
      });
      expect(r.id, 'r1');
      expect(r.businessId, 'b1');
      expect(r.businessPhone, '+1718');
      expect(r.destinationCountryName, 'Guinea');
      expect(r.isCollect, isTrue);
      expect(r.pieces.single.photoCount, 2);
      expect(r.version, 2);
      expect(r.priceOf(r.pieces.single), 4000);
      // The business's schedule wins over the day the customer asked for.
      expect(r.handoffDay, '2026-10-26');
      expect(r.handoffWindow, 'morning');
      expect(r.estimate!.sentAt!.toUtc(), DateTime.utc(2026, 10, 20, 15));
      expect(r.expiresAt, isNotNull);
      expect(r.isCardOrder, isFalse);
    });

    test('epoch-ms twins stand in for missing Timestamps', () {
      final r = PackageRequest.fromMap('r1', _doc({
        'createdAt': null,
        'createdAtMs': 1760000000000,
        'expiresAtMs': 0,
      }));
      expect(r.createdAt, DateTime.fromMillisecondsSinceEpoch(1760000000000));
      expect(r.expiresAt, isNull);
    });

    test('a card-paid order is recognised by any of its marks', () {
      expect(
        PackageRequest.fromMap('r', _doc({'cardOrder': {'orderId': 'o'}}))
            .isCardOrder,
        isTrue,
      );
      expect(
        PackageRequest.fromMap('r', _doc({'payment': {'timing': 'card'}}))
            .isCardOrder,
        isTrue,
      );
      expect(
        PackageRequest.fromMap('r', _doc({'confirmedVia': 'card'})).isCardOrder,
        isTrue,
      );
    });

    test('garbage does not throw', () {
      final r = PackageRequest.fromMap('r', {
        'pieces': 'nope',
        'estimate': 3,
        'lock': {'uid': ''},
        'history': [null, 'x'],
      });
      expect(r.pieces, isEmpty);
      expect(r.estimate, isNull);
      expect(r.lock, isNull);
      expect(r.history, hasLength(2));
    });

    test('options: countries once, businesses per country, no dead ones', () {
      final options = RequestOptions.fromResponse({
        'business': null,
        'options': [
          {
            'businessId': 'b2',
            'businessName': 'Zed',
            'country': {'id': 'guinea', 'name': 'Guinea'},
            'bringIn': {'available': false, 'locations': []},
            'collect': {'available': true, 'areas': 'Bronx'},
          },
          {
            'businessId': 'b1',
            'businessName': 'Alpha',
            'country': {'id': 'guinea', 'name': 'Guinea'},
            'bringIn': {
              'available': true,
              'locations': [
                {'id': 'l', 'label': 'A', 'address': 'x'},
              ],
            },
            'collect': {'available': false},
          },
          {
            'businessId': 'b3',
            'businessName': 'Senegal',
            'country': {'id': 'senegal', 'name': 'Senegal'},
            'bringIn': {'available': true, 'locations': []},
            'collect': {'available': false},
          },
        ],
      });
      expect(options.countries.map((c) => c.id), ['guinea']);
      expect(options.forCountry('guinea').map((o) => o.businessName), [
        'Alpha',
        'Zed',
      ]);
      expect(options.business, isNull);
    });
  });

  group('the form checks', () {
    test('a complete drop-off passes', () {
      expect(
        validateRequestDraft(_draft(), option: _option(), today: _today),
        isEmpty,
      );
    });

    test('a closed weekday and days out of range', () {
      // 2026-10-25 is a Sunday: closed in the standard hours.
      expect(
        validateRequestDraft(
          _draft(plannedDate: '2026-10-25'),
          option: _option(),
          today: _today,
        ),
        ['planned_day_closed'],
      );
      expect(
        validateRequestDraft(
          _draft(plannedDate: '2026-10-21'),
          option: _option(),
          today: _today,
        ),
        ['planned_date_invalid'],
      );
      // 60 days ahead is the last day allowed; 61 is not.
      expect(
        validateRequestDraft(
          _draft(plannedDate: '2026-12-21'),
          option: _option(),
          today: _today,
        ),
        isEmpty,
      );
      expect(
        validateRequestDraft(
          _draft(plannedDate: '2026-12-22'),
          option: _option(),
          today: _today,
        ),
        ['planned_date_invalid'],
      );
    });

    test('a collection needs its address, day and window', () {
      expect(
        validateRequestDraft(
          _draft(handoff: requestHandoffCollect),
          option: _option(),
          today: _today,
        ),
        ['pickup_address_required', 'pickup_date_invalid', 'pickup_window_invalid'],
      );
      expect(
        validateRequestDraft(
          _draft(
            handoff: requestHandoffCollect,
            pickupAddress: '9 Elm St, Bronx',
            pickupDate: '2026-10-25',
            pickupWindow: 'evening',
          ),
          option: _option(),
          today: _today,
        ),
        isEmpty,
      );
    });

    test('no handoff, bad phones, pieces', () {
      final reasons = validateRequestDraft(
        _draft(
          handoff: '',
          senderPhone: '9175551234',
          receiverPhone: '',
          pieces: [
            const RequestPieceDraft(kind: requestPieceOther),
            RequestPieceDraft(
              kind: requestPieceBox,
              description: 'Clothes',
              photoPaths: List.filled(6, 'p'),
            ),
          ],
        ),
        option: _option(),
        today: _today,
      );
      expect(reasons, [
        'handoff_invalid',
        'sender_phone_invalid',
        'receiver_phone_invalid',
        'piece_description_required',
        'too_many_photos',
      ]);
      expect(
        validateRequestDraft(
          _draft(pieces: const []),
          option: _option(),
          today: _today,
        ),
        ['pieces_required'],
      );
      expect(
        validateRequestDraft(
          _draft(pieces: List.filled(21, const RequestPieceDraft())),
          option: _option(),
          today: _today,
        ),
        ['too_many_pieces'],
      );
    });

    test('a barrel needs no description; text limits hold', () {
      expect(pieceNeedsDescription(const RequestPieceDraft()), isFalse);
      expect(
        pieceNeedsDescription(const RequestPieceDraft(kind: requestPieceBox)),
        isTrue,
      );
      expect(
        validateRequestDraft(
          _draft(
            pieces: [
              RequestPieceDraft(kind: requestPieceOther, description: 'x' * 121),
            ],
          ),
          option: _option(),
          today: _today,
        ),
        ['text_too_long'],
      );
    });

    test('the payload carries only its handoff\'s fields', () {
      final bring = submitRequestPayload(_draft());
      expect(bring['locationId'], 'loc1');
      expect(bring.containsKey('pickup'), isFalse);
      expect((bring['pieces'] as List).single, {'kind': 'barrel'});
      final collect = submitRequestPayload(
        _draft(
          handoff: requestHandoffCollect,
          pickupAddress: ' 9 Elm ',
          pickupDate: '2026-10-25',
          pickupWindow: 'evening',
        ),
      );
      expect(collect.containsKey('locationId'), isFalse);
      expect(collect.containsKey('plannedDate'), isFalse);
      expect(collect['pickup'], {
        'address': '9 Elm',
        'date': '2026-10-25',
        'window': 'evening',
      });
    });

    test('idempotency keys are the server\'s shape and fresh each time', () {
      final key = newRequestIdempotencyKey(Random(1));
      expect(RegExp(r'^[A-Za-z0-9_-]{8,80}$').hasMatch(key), isTrue);
      expect(newRequestIdempotencyKey(), isNot(newRequestIdempotencyKey()));
    });
  });

  group('where a request stands', () {
    test('the customer\'s page state for every status', () {
      CustomerRequestState of(String s) =>
          customerStateOf(PackageRequest.fromMap('r', _doc({'status': s})));
      expect(of('new'), CustomerRequestState.waitingForEstimate);
      expect(of('estimate_sent'), CustomerRequestState.awaitingConfirmation);
      expect(of('confirmed'), CustomerRequestState.confirmed);
      expect(of('received'), CustomerRequestState.received);
      expect(of('declined'), CustomerRequestState.declined);
      expect(of('cancelled'), CustomerRequestState.cancelled);
      expect(of('customer_declined'), CustomerRequestState.customerDeclined);
      expect(of('expired'), CustomerRequestState.expired);
      expect(of('something_new'), CustomerRequestState.waitingForEstimate);
    });

    test('only a sent estimate can be answered', () {
      final sent = PackageRequest.fromMap('r', _doc({
        'status': 'estimate_sent',
        'estimate': {'version': 1, 'totalCents': 1},
      }));
      expect(customerCanAnswer(sent), isTrue);
      expect(
        customerCanAnswer(PackageRequest.fromMap('r', _doc({'status': 'new'}))),
        isFalse,
      );
    });

    test('the business piles, newest first; Expected soonest first', () {
      final list = [
        PackageRequest.fromMap('a', _doc({
          'status': 'new',
          'createdAt': Timestamp.fromMillisecondsSinceEpoch(1),
        })),
        PackageRequest.fromMap('b', _doc({
          'status': 'new',
          'createdAt': Timestamp.fromMillisecondsSinceEpoch(2),
        })),
        PackageRequest.fromMap('c', _doc({'status': 'estimate_sent'})),
        PackageRequest.fromMap('d', _doc({
          'status': 'confirmed',
          'plannedDate': '2026-10-30',
        })),
        PackageRequest.fromMap('e', _doc({
          'status': 'confirmed',
          'plannedDate': '2026-10-24',
        })),
        PackageRequest.fromMap('f', _doc({'status': 'received'})),
      ];
      expect(
        requestsInStage(list, BusinessRequestStage.needsEstimate).map((r) => r.id),
        ['b', 'a'],
      );
      expect(
        requestsInStage(list, BusinessRequestStage.waitingForCustomer)
            .map((r) => r.id),
        ['c'],
      );
      expect(expectedRequests(list).map((r) => r.id), ['e', 'd']);
      expect(businessStageOf(list.last), BusinessRequestStage.closed);
    });

    test('pieces counted by kind', () {
      final counts = countPieceKinds(['barrel', 'barrel', 'box', 'other', 'x']);
      expect(
        [counts.barrels, counts.boxes, counts.others, counts.total],
        [2, 1, 2, 5],
      );
    });
  });

  group('the estimate lock', () {
    const lock = RequestLock(uid: 'u2', name: 'Mariama', untilMs: 1000);
    test('nobody, me, someone else, lapsed', () {
      expect(lockHolderOf(null, myUid: 'u1', nowMs: 0), LockHolder.nobody);
      expect(lockHolderOf(lock, myUid: 'u2', nowMs: 999), LockHolder.me);
      expect(lockHolderOf(lock, myUid: 'u2', nowMs: 1000), LockHolder.nobody);
      expect(lockHolderOf(lock, myUid: 'u1', nowMs: 999), LockHolder.someoneElse);
      // Live while untilMs > now: at the instant itself it has lapsed.
      expect(lockHolderOf(lock, myUid: 'u1', nowMs: 1000), LockHolder.lapsed);
    });
  });

  group('the estimate editor', () {
    final request = PackageRequest.fromMap('r1', _doc());

    test('prefills the barrel price and leaves the rest to staff', () {
      expect(estimatePrefill(request), {'p1': '120', 'p2': ''});
      final sent = PackageRequest.fromMap('r1', _doc({
        'estimate': {
          'version': 1,
          'totalCents': 13050,
          'pieces': [
            {'id': 'p1', 'cents': 12000},
            {'id': 'p2', 'cents': 1050},
          ],
        },
      }));
      expect(estimatePrefill(sent), {'p1': '120', 'p2': '10.50'});
    });

    test('every piece needs a real price', () {
      final missing = checkEstimate(
        request: request,
        inputs: {'p1': '120', 'p2': ''},
      );
      expect(missing.reasons, ['estimate_piece_missing']);
      expect(missing.missing, {'p2'});
      final bad = checkEstimate(
        request: request,
        inputs: {'p1': '12.505', 'p2': '1,2,3'},
      );
      expect(bad.reasons, ['amount_invalid']);
      expect(bad.invalid, {'p1', 'p2'});
      final ok = checkEstimate(
        request: request,
        inputs: {'p1': '120', 'p2': '45,50'},
      );
      expect(ok.ok, isTrue);
      expect(ok.totalCents, 16550);
    });

    test('the payload; a pickup fee only for a collection', () {
      final check = checkEstimate(
        request: request,
        inputs: {'p1': '120', 'p2': '45'},
        pickupFee: '20',
        note: ' See you ',
      );
      final body = sendEstimatePayload(
        businessId: 'b1',
        request: request,
        baseVersion: 0,
        check: check,
        note: ' See you ',
      );
      expect(body, {
        'businessId': 'b1',
        'requestId': 'r1',
        'baseVersion': 0,
        'pieces': [
          {'id': 'p1', 'cents': 12000},
          {'id': 'p2', 'cents': 4500},
        ],
        'note': 'See you',
      });
      final collect = PackageRequest.fromMap('r1', _doc({'handoff': 'collect'}));
      final c = checkEstimate(
        request: collect,
        inputs: {'p1': '120', 'p2': '45'},
        pickupFee: '20',
      );
      expect(c.totalCents, 18500);
      final cBody = sendEstimatePayload(
        businessId: 'b1',
        request: collect,
        baseVersion: 1,
        check: c,
        pickupSchedule: const RequestSchedule(date: '2026-10-26', window: 'morning'),
      );
      expect(cBody['pickupFeeCents'], 2000);
      expect(cBody['pickupSchedule'], {'date': '2026-10-26', 'window': 'morning'});
      expect(
        checkEstimate(request: collect, inputs: {'p1': '1', 'p2': '1'}, pickupFee: 'x')
            .reasons,
        ['pickup_fee_invalid'],
      );
    });
  });

  group('Received', () {
    // The editor's own drafts, as PiecesEditorController.draftPieces gives
    // them.
    Map<String, Object?> draft(
      String id,
      String kind,
      Object? price, {
      String description = '',
    }) => {
      'id': id,
      'kind': kind,
      'description': description,
      'sizeIn': {'l': '', 'w': '', 'h': ''},
      'priceCents': price,
    };

    test('opens on the request pieces in the pieces editor; none or all '
        'priced', () {
      final request = PackageRequest.fromMap('r1', _doc());
      final pieces = receivePrefillPieces(request);
      expect(
        [for (final p in pieces) [p.id, p.kind, p.description, p.priceCents]],
        [
          ['p1', 'barrel', '', 12000],
          ['p2', 'other', 'TV', null],
        ],
      );
      expect(
        checkReceive([draft('p1', 'barrel', 12000), draft('p2', 'other', null,
            description: 'TV')]).reasons,
        ['price_required'],
      );
      expect(
        checkReceive([draft('p1', 'barrel', null), draft('p2', 'other', null,
            description: 'TV')]).ok,
        isTrue,
      );
      final check = checkReceive([
        draft('p1', 'barrel', 12000),
        draft('p2', 'other', 3000, description: 'TV'),
      ]);
      expect(check.totalCents, 15000);
      expect(
        checkReceive([draft('p1', 'barrel', 'unreadable')]).reasons,
        ['piece_price_invalid'],
      );
      expect(
        receivePayload(businessId: 'b1', requestId: 'r1', check: check),
        {
          'businessId': 'b1',
          'requestId': 'r1',
          'pieces': [
            {'id': 'p1', 'kind': 'barrel', 'description': '', 'sizeIn': null,
              'priceCents': 12000},
            {'id': 'p2', 'kind': 'other', 'description': 'TV',
              'sizeIn': null, 'priceCents': 3000},
          ],
        },
      );
    });

    test('a piece brought on top goes without an id; one that did not come '
        'is left out; at most 20', () {
      final check = checkReceive([
        draft('p2', 'other', 3000, description: 'TV'),
        draft('', 'box', 2500, description: 'Shoes'),
      ]);
      expect(check.ok, isTrue);
      expect([for (final p in check.pieces) p['id']], ['p2', '']);
      expect(check.totalCents, 5500);
      expect(
        checkReceive([draft('', 'box', 1)]).reasons,
        ['piece_description_required'],
      );
      expect(
        checkReceive([for (var i = 0; i < 21; i++) draft('', 'barrel', 1)])
            .reasons,
        ['too_many_pieces'],
      );
    });

    test("a collection's pickup fee rides inside the piece prices", () {
      // The same numbers as functions/request_receive.js and the console.
      final request = PackageRequest.fromMap('r1', _doc({
        'handoff': 'collect',
        'pieces': [
          {'id': 'p1', 'kind': 'barrel', 'estimateCents': 15000},
          {'id': 'p2', 'kind': 'box', 'description': 'Clothes',
            'estimateCents': null},
        ],
        'estimate': {
          'version': 1,
          'totalCents': 22001,
          'pieces': [
            {'id': 'p1', 'cents': 15000},
            {'id': 'p2', 'cents': 4500},
          ],
          'pickupFeeCents': 2501,
        },
      }));
      expect(receivePrefillCents(request), {'p1': 16251, 'p2': 5750});
      expect(receivePickupFeeCents(request), 2501);
      final total = checkReceive([
        for (final p in receivePrefillPieces(request)) p.toMap(),
      ]).totalCents;
      expect(total, 22001);
      final bring = PackageRequest.fromMap('r1', _doc({
        'estimate': {'version': 1, 'totalCents': 1, 'pickupFeeCents': 500},
      }));
      expect(receivePickupFeeCents(bring), 0);
      expect(receivePrefillCents(bring), {'p1': 12000, 'p2': null});
    });
  });

  group('refusals', () {
    test('reasons, the lock holder and versions are read', () {
      final r = parseRequestRefusal('failed-precondition', {
        'reason': 'estimate_locked',
        'lockedByName': 'Mariama',
        'untilMs': 99,
      });
      expect(r.reason, 'estimate_locked');
      expect(r.lockedByName, 'Mariama');
      expect(r.untilMs, 99);
      final v = parseRequestRefusal('invalid-argument', {
        'reason': 'sender_name_required',
        'reasons': ['sender_name_required', 'pieces_required'],
      });
      expect(v.reasons, ['sender_name_required', 'pieces_required']);
      expect(
        parseRequestRefusal('failed-precondition', {
          'reason': 'estimate_stale',
          'currentVersion': 3,
        }).currentVersion,
        3,
      );
      expect(parseRequestRefusal('unavailable', null).reasons, isEmpty);
    });

    test('codes with no reason fall into kinds', () {
      expect(requestFailureKind('unavailable'), RequestFailureKind.offline);
      expect(requestFailureKind('deadline-exceeded'), RequestFailureKind.offline);
      expect(requestFailureKind('unauthenticated'), RequestFailureKind.appCheck);
      expect(requestFailureKind('permission-denied'), RequestFailureKind.permission);
      expect(requestFailureKind('not-found'), RequestFailureKind.notFound);
      expect(requestFailureKind('resource-exhausted'), RequestFailureKind.rateLimited);
      expect(requestFailureKind('internal'), RequestFailureKind.generic);
    });

    test('reasons', () {
      expect(reasonProblem(' '), 'reason_required');
      expect(reasonProblem('', required: false), isNull);
      expect(reasonProblem('x' * 301), 'text_too_long');
      expect(reasonProblem('No room'), isNull);
    });
  });

  group('links', () {
    const token = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
    test('the estimate page and the request form', () {
      expect(
        packageRequestLinkFromUri(
          Uri.parse('https://customer.laawoldigital.com/e/$token'),
        ),
        const EstimateRequestLink(token),
      );
      expect(
        packageRequestLinkFromUri(Uri.parse(
          'https://customer.laawoldigital.com/?service=package-estimate&t=$token',
        )),
        const EstimateRequestLink(token),
      );
      expect(
        packageRequestLinkFromUri(
          Uri.parse('https://customer.laawoldigital.com/r/Conakry-Express'),
        ),
        const FormRequestLink('conakry-express'),
      );
      expect(
        packageRequestLinkFromUri(Uri.parse('https://laawoldigital.com/r/conakry')),
        const FormRequestLink('conakry'),
      );
      expect(
        packageRequestLinkFromUri(Uri.parse(
          'https://customer.laawoldigital.com/?service=package-request',
        )),
        const FormRequestLink(''),
      );
    });

    test('anything else is not ours', () {
      for (final link in [
        'https://evil.example/e/$token',
        'https://laawoldigital.com/e/$token',
        'https://customer.laawoldigital.com/e/short',
        'https://customer.laawoldigital.com/r/no',
        'https://customer.laawoldigital.com/t/CL-K7M4P2',
        'mailto:x@y.z',
      ]) {
        expect(packageRequestLinkFromUri(Uri.parse(link)), isNull, reason: link);
      }
      expect(isRequestSlug('conakry-express'), isTrue);
      expect(isRequestSlug('ab'), isFalse);
      expect(requestLinkForSlug('conakry'), 'https://laawoldigital.com/r/conakry');
    });
  });

  group('photos', () {
    test('only real images under the size limit', () {
      final jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 0];
      final png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
      final webp = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
      expect(sniffRequestPhotoType(jpeg), 'image/jpeg');
      expect(sniffRequestPhotoType(png), 'image/png');
      expect(sniffRequestPhotoType(webp), 'image/webp');
      expect(sniffRequestPhotoType([0x47, 0x49, 0x46]), isNull);
      expect(requestPhotoProblem([0x47, 0x49, 0x46]), 'photo_invalid');
      expect(requestPhotoProblem(jpeg), isNull);
      // The boundary: one byte under the limit passes, the limit does not.
      final under = List<int>.filled(requestPhotoMaxBytes - 1, 0)
        ..setRange(0, 3, jpeg);
      final at = List<int>.filled(requestPhotoMaxBytes, 0)..setRange(0, 3, jpeg);
      expect(requestPhotoProblem(under), isNull);
      expect(requestPhotoProblem(at), 'photo_too_large');
    });

    test('paths live in the uploader\'s own folder of the business', () {
      final path = requestPhotoPath(
        businessId: 'b1',
        uploaderUid: 'u1',
        fileId: newRequestPhotoId(Random(2)),
        contentType: 'image/png',
      );
      expect(
        RegExp(r'^packageRequestPhotos/b1/u1/[A-Za-z0-9_-]{8,64}\.png$')
            .hasMatch(path),
        isTrue,
      );
    });

    test('a data URL decodes; anything else is null', () {
      expect(decodePngDataUrl('data:image/png;base64,AAEC'), [0, 1, 2]);
      expect(decodePngDataUrl('https://x'), isNull);
    });
  });

  group('settings', () {
    test('hours, pickup areas and the slug', () {
      final bad = RequestWeekHours.standard().withDay(
        'mon',
        const RequestDayHours(open: true, from: '18:00', to: '09:00'),
      );
      expect(
        validateRequestSettings(
          openingHours: {'default': bad},
          pickupEnabled: true,
          pickupAreas: ' ',
          slug: 'No Spaces',
        ),
        ['hours_invalid', 'pickup_areas_required', 'slug_invalid'],
      );
      expect(
        validateRequestSettings(
          openingHours: {'default': RequestWeekHours.standard()},
          pickupEnabled: false,
          pickupAreas: '',
          slug: 'conakry',
          currentSlug: 'conakry',
        ),
        isEmpty,
      );
    });

    test('the payload sends a slug only when it changed', () {
      final body = requestSettingsPayload(
        businessId: 'b1',
        acceptRequests: true,
        openingHours: {'default': RequestWeekHours.standard()},
        pickupEnabled: true,
        pickupAreas: ' Bronx ',
        cardBarrelBooking: false,
        slug: 'conakry',
        currentSlug: 'conakry',
      );
      expect(body.containsKey('requestSlug'), isFalse);
      expect(body['pickup'], {'enabled': true, 'areas': 'Bronx'});
      expect(
        (body['openingHours'] as Map)['default']['sun'],
        {'open': false, 'from': '09:00', 'to': '18:00'},
      );
      expect(
        requestSettingsPayload(
          businessId: 'b1',
          acceptRequests: true,
          openingHours: const {},
          pickupEnabled: false,
          pickupAreas: '',
          cardBarrelBooking: false,
          slug: 'New-Name',
          currentSlug: 'conakry',
        )['requestSlug'],
        'new-name',
      );
    });

    test('read from the business document; the slug changes once', () {
      final s = PackageRequestSettings.fromBusiness({
        'requestSlug': 'conakry',
        'requestSlugEdits': 1,
        'packageRequestSettings': {
          'acceptRequests': true,
          'openingHours': {'default': RequestWeekHours.standard().toMap()},
          'pickup': {'enabled': true, 'areas': 'Bronx'},
        },
      });
      expect(s.acceptRequests, isTrue);
      expect(s.slugEditable, isFalse);
      expect(s.requestLink, 'https://laawoldigital.com/r/conakry');
      expect(s.openingHours['default']!.day('sun').open, isFalse);
      expect(const PackageRequestSettings().slugEditable, isTrue);
    });

    test('clock helpers', () {
      expect(requestMinutesOf('09:30'), 570);
      expect(requestMinutesOf('24:00'), isNull);
      expect(requestHhmm(570), '09:30');
      expect(requestDayKey(DateTime(2026, 1, 5)), '2026-01-05');
      expect(requestDayFromKey('2026-02-30'), isNull);
      expect(weekdayKey(DateTime(2026, 1, 5)), 'mon');
      expect(formatRequestCents(123450), r'$1,234.50');
      expect(requestCentsToInput(1050), '10.50');
    });
  });

  group('queries and notification taps', () {
    test('both request queries need no composite index', () {
      final open = packageRequestsOpenSpec('b1');
      expect(open.isBusinessScoped, isTrue);
      expect(open.isBounded, isTrue);
      expect(open.compositeIndex, isNull);
      expect(packageRequestsMineSpec('u1').compositeIndex, isNull);
      expect(packageRequestsMineSpec('u1').filters.single.field, 'sender.uid');
    });

    test('a request notification opens Requests on that request', () {
      final route = routeForNotificationData(
        {'type': 'package_request', 'event': 'new', 'requestId': 'r9'},
        audience: NotificationAudience.business,
      );
      expect(route?.name, '/business-requests');
      expect((route?.arguments as BusinessRequestsArguments).requestId, 'r9');
      expect(
        collectionFromNotification({'type': 'package_request'}),
        'packageRequests',
      );
    });
  });
}
