import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/car_purchase.dart';
import 'package:my_flutter_app/services/car_viewing_service.dart';

/// The app half of the car-viewing negotiation.
///
/// These assertions are deliberately the ones `functions/car_viewing.js` makes
/// in `decideViewingAction`: a button the app offers and the server refuses is
/// a bug, and the only way the two stay in step is by testing the same table.

final DateTime now = DateTime(2026, 8, 10, 9);

ViewingSlot slotAt(
  Duration fromNow, {
  String label = 'Tue, Aug 11 - 10:00 AM',
}) => ViewingSlot(startAt: now.add(fromNow), label: label);

ViewingState state({
  String status = viewingRequested,
  List<ViewingSlot>? slots,
  ViewingParty? proposedBy = ViewingParty.customer,
  int round = 1,
  DateTime? respondByAt,
  DateTime? appointmentStart,
}) => ViewingState(
  purchaseStatus: status,
  proposedSlots: slots ?? <ViewingSlot>[slotAt(const Duration(days: 1))],
  proposedBy: proposedBy,
  proposalRound: round,
  respondByAt: respondByAt ?? now.add(const Duration(hours: 24)),
  appointmentStart: appointmentStart,
);

void main() {
  group('viewingAwaitingParty', () {
    test('a request waits on the business, a counter on the customer', () {
      expect(viewingAwaitingParty(viewingRequested), ViewingParty.business);
      expect(viewingAwaitingParty(viewingCountered), ViewingParty.customer);
    });

    test('nobody is waiting once a time is agreed or the record is closed', () {
      expect(viewingAwaitingParty(viewingScheduled), isNull);
      expect(viewingAwaitingParty(viewingDeclined), isNull);
      expect(viewingAwaitingParty(viewingExpired), isNull);
      expect(viewingAwaitingParty(viewingCancelled), isNull);
    });
  });

  group('viewingProposalExpired', () {
    test('the deadline passing expires a pending proposal', () {
      expect(
        viewingProposalExpired(
          state(respondByAt: now.subtract(const Duration(minutes: 1))),
          now: now,
        ),
        isTrue,
      );
    });

    test('every slot having gone by expires it even before the deadline', () {
      // The check that actually bites: without it a business is shown an
      // "Accept" for a time that was yesterday.
      expect(
        viewingProposalExpired(
          state(
            slots: <ViewingSlot>[slotAt(const Duration(minutes: 30))],
            respondByAt: now.add(const Duration(hours: 12)),
          ),
          now: now,
        ),
        isTrue,
      );
    });

    test('one slot still in reach keeps the proposal alive', () {
      expect(
        viewingProposalExpired(
          state(
            slots: <ViewingSlot>[
              slotAt(const Duration(minutes: 30)),
              slotAt(const Duration(days: 2)),
            ],
          ),
          now: now,
        ),
        isFalse,
      );
    });

    test('an agreed viewing cannot expire - nobody owes a reply', () {
      expect(
        viewingProposalExpired(
          state(
            status: viewingScheduled,
            slots: const <ViewingSlot>[],
            respondByAt: now.subtract(const Duration(days: 5)),
          ),
          now: now,
        ),
        isFalse,
      );
    });
  });

  group('availableViewingActions', () {
    test('a request lets the business accept, counter or decline', () {
      expect(
        availableViewingActions(state(), ViewingParty.business, now: now),
        <ViewingAction>{
          ViewingAction.accept,
          ViewingAction.propose,
          ViewingAction.decline,
          ViewingAction.cancel,
        },
      );
    });

    test('the customer waiting on an answer may re-propose or cancel', () {
      expect(
        availableViewingActions(state(), ViewingParty.customer, now: now),
        <ViewingAction>{ViewingAction.propose, ViewingAction.cancel},
      );
    });

    test('a counter lets the customer accept one of the offered times', () {
      expect(
        availableViewingActions(
          state(status: viewingCountered, proposedBy: ViewingParty.business),
          ViewingParty.customer,
          now: now,
        ),
        <ViewingAction>{
          ViewingAction.accept,
          ViewingAction.propose,
          ViewingAction.cancel,
        },
      );
    });

    test('the business cannot accept or decline its own counter', () {
      // Declining a time you offered yourself is a cancellation wearing
      // another word, so both clients keep decline to an unanswered request.
      final actions = availableViewingActions(
        state(status: viewingCountered, proposedBy: ViewingParty.business),
        ViewingParty.business,
        now: now,
      );
      expect(actions, isNot(contains(ViewingAction.accept)));
      expect(actions, isNot(contains(ViewingAction.decline)));
      expect(actions, contains(ViewingAction.cancel));
    });

    test('after three rounds only accept, decline and cancel remain', () {
      final actions = availableViewingActions(
        state(round: maxViewingProposalRounds),
        ViewingParty.business,
        now: now,
      );
      expect(actions, isNot(contains(ViewingAction.propose)));
      expect(actions, contains(ViewingAction.accept));
      expect(actions, contains(ViewingAction.cancel));
    });

    test('an agreed viewing can be rescheduled or cancelled by either', () {
      final scheduled = state(
        status: viewingScheduled,
        slots: const <ViewingSlot>[],
        round: maxViewingProposalRounds,
        appointmentStart: now.add(const Duration(days: 2)),
      );
      for (final party in ViewingParty.values) {
        expect(
          availableViewingActions(scheduled, party, now: now),
          // The cap does not apply to a reschedule: a change of plan weeks
          // later is not the haggling it exists to stop.
          <ViewingAction>{ViewingAction.propose, ViewingAction.cancel},
        );
      }
    });

    test('nothing moves inside the last hour before an appointment', () {
      final scheduled = state(
        status: viewingScheduled,
        slots: const <ViewingSlot>[],
        appointmentStart: now.add(const Duration(minutes: 45)),
      );
      expect(
        availableViewingActions(scheduled, ViewingParty.customer, now: now),
        isEmpty,
      );
    });

    test('a closed viewing offers nothing at all, cancel included', () {
      for (final status in <String>[
        viewingDeclined,
        viewingExpired,
        viewingCancelled,
        'completed',
      ]) {
        expect(
          availableViewingActions(
            state(status: status),
            ViewingParty.customer,
            now: now,
          ),
          isEmpty,
          reason: status,
        );
      }
    });

    test('an expired proposal offers nothing until the server is asked', () {
      expect(
        availableViewingActions(
          state(respondByAt: now.subtract(const Duration(minutes: 1))),
          ViewingParty.business,
          now: now,
        ),
        isEmpty,
      );
    });

    test('a customer is never offered decline', () {
      expect(
        availableViewingActions(
          state(status: viewingCountered, proposedBy: ViewingParty.business),
          ViewingParty.customer,
          now: now,
        ),
        isNot(contains(ViewingAction.decline)),
      );
    });
  });

  group('validateViewingSlots', () {
    test('one workable time from a customer has nothing to object to', () {
      expect(
        validateViewingSlots(
          <ViewingSlot>[slotAt(const Duration(days: 1))],
          actor: ViewingParty.customer,
          now: now,
        ),
        isEmpty,
      );
    });

    test('a business may offer three at once, a customer only one', () {
      expect(maxViewingSlotsFor(ViewingParty.business), maxViewingCounterSlots);
      expect(maxViewingSlotsFor(ViewingParty.customer), 1);
      final three = <ViewingSlot>[
        slotAt(const Duration(days: 1)),
        slotAt(const Duration(days: 2)),
        slotAt(const Duration(days: 3)),
      ];
      expect(
        validateViewingSlots(three, actor: ViewingParty.business, now: now),
        isEmpty,
      );
      expect(
        validateViewingSlots(three, actor: ViewingParty.customer, now: now),
        <ViewingSlotError>[ViewingSlotError.tooManySlots],
      );
    });

    test('choosing nothing is refused before it costs a round trip', () {
      expect(
        validateViewingSlots(
          const <ViewingSlot>[],
          actor: ViewingParty.customer,
          now: now,
        ),
        <ViewingSlotError>[ViewingSlotError.noSlots],
      );
    });

    test('a time inside the one-hour floor could never be agreed to', () {
      expect(
        validateViewingSlots(
          <ViewingSlot>[slotAt(const Duration(minutes: 59))],
          actor: ViewingParty.customer,
          now: now,
        ),
        <ViewingSlotError>[ViewingSlotError.slotTooSoon],
      );
    });

    test('reports every problem at once, not just the first', () {
      expect(
        validateViewingSlots(
          <ViewingSlot>[
            slotAt(const Duration(minutes: 10)),
            slotAt(const Duration(days: 1)),
          ],
          actor: ViewingParty.customer,
          now: now,
        ),
        <ViewingSlotError>[
          ViewingSlotError.tooManySlots,
          ViewingSlotError.slotTooSoon,
        ],
      );
    });
  });

  group('suggestedViewingStarts', () {
    test('offers weekday times, in order, all clear of the floor', () {
      final starts = suggestedViewingStarts(now: now);
      expect(starts, hasLength(8));
      expect(starts.every((start) => start.weekday != DateTime.sunday), isTrue);
      expect(
        starts.every(
          (start) =>
              start.difference(now) >
              const Duration(hours: 2) - const Duration(seconds: 1),
        ),
        isTrue,
      );
      final sorted = List<DateTime>.from(starts)..sort();
      expect(starts, sorted);
    });

    test('never offers today - the earliest is tomorrow', () {
      final starts = suggestedViewingStarts(now: DateTime(2026, 8, 10, 6));
      expect(starts.first.day, greaterThan(10));
    });
  });

  group('reading a stored viewing', () {
    test('slots come back as instants with the words that were offered', () {
      final slots = viewingSlotsFromStored(<Object?>[
        <String, Object?>{
          'startAtMs': now.millisecondsSinceEpoch,
          'label': 'Mon, Aug 10 - 9:00 AM',
        },
        // Unreadable entries are dropped rather than let through as a viewing
        // at the epoch, which the server would refuse as being in the past.
        <String, Object?>{'label': 'no instant'},
        'not a slot',
      ]);
      expect(slots, hasLength(1));
      expect(slots.single.startAt, now);
      expect(slots.single.label, 'Mon, Aug 10 - 9:00 AM');
    });

    test('slots are equal by instant, whatever they were called', () {
      expect(
        ViewingSlot(startAt: now, label: 'Monday morning'),
        ViewingSlot(startAt: now, label: 'lundi matin'),
      );
    });

    test('history reads oldest first, whatever order it was stored in', () {
      final history = viewingHistoryFromStored(<Object?>[
        <String, Object?>{
          'actor': 'business',
          'action': 'propose',
          'atMs': now.millisecondsSinceEpoch,
          'slots': <Object?>[
            <String, Object?>{
              'startAtMs': now
                  .add(const Duration(days: 1))
                  .millisecondsSinceEpoch,
              'label': 'Tue',
            },
          ],
        },
        <String, Object?>{
          'actor': 'customer',
          'action': 'propose',
          'atMs': now.subtract(const Duration(hours: 2)).millisecondsSinceEpoch,
        },
      ]);
      expect(history.map((entry) => entry.actor).toList(), <ViewingParty>[
        ViewingParty.customer,
        ViewingParty.business,
      ]);
      expect(history.last.slots, hasLength(1));
    });

    test('an unrecognised party is nobody, not the customer', () {
      expect(viewingPartyFromWire('platform'), isNull);
      expect(viewingPartyFromWire(''), isNull);
      expect(viewingPartyFromWire(null), isNull);
      expect(viewingPartyFromWire('business'), ViewingParty.business);
    });

    test('a purchase carries the whole negotiation into the panel', () {
      final purchase = CarPurchase.fromMap('p1', <String, dynamic>{
        'carId': 'car-1',
        'paymentType': 'viewing_reservation',
        'purchaseStatus': viewingCountered,
        'depositAmount': 0,
        'proposedBy': 'business',
        'proposalRound': 2,
        'respondByAt': now.add(const Duration(hours: 6)),
        'proposedSlots': <Object?>[
          <String, Object?>{
            'startAtMs': now
                .add(const Duration(days: 1))
                .millisecondsSinceEpoch,
            'label': 'Tue, Aug 11 - 10:00 AM',
          },
        ],
        'viewingHistory': <Object?>[
          <String, Object?>{
            'actor': 'customer',
            'action': 'propose',
            'atMs': now.millisecondsSinceEpoch,
          },
        ],
      });

      final viewing = purchase.viewingState;
      expect(purchase.isViewingReservation, isTrue);
      expect(purchase.hasOpenViewingNegotiation, isTrue);
      expect(viewing.awaiting, ViewingParty.customer);
      expect(viewing.proposedBy, ViewingParty.business);
      expect(viewing.proposalRound, 2);
      expect(viewing.proposedSlots, hasLength(1));
      expect(viewing.history, hasLength(1));
      expect(
        availableViewingActions(viewing, ViewingParty.customer, now: now),
        contains(ViewingAction.accept),
      );
    });

    test('a declined viewing is closed but still blocks a second request', () {
      // Deliberate: the server's "one viewing per listing" guard counts it, so
      // the app must not offer a fresh request the callable would refuse.
      final purchase = CarPurchase.fromMap('p2', <String, dynamic>{
        'paymentType': 'viewing_reservation',
        'purchaseStatus': viewingDeclined,
        'depositAmount': 0,
      });
      expect(purchase.isActiveViewingReservation, isTrue);
      expect(purchase.hasOpenViewingNegotiation, isFalse);
    });
  });

  group('CarViewingActionResult', () {
    test('reads what the callable answers', () {
      final result = CarViewingActionResult.fromCallable(<Object?, Object?>{
        'success': true,
        'purchaseId': 'p1',
        'purchaseStatus': viewingCountered,
        'awaiting': 'customer',
      });
      expect(result.success, isTrue);
      expect(result.purchaseId, 'p1');
      expect(result.purchaseStatus, viewingCountered);
      expect(result.awaiting, ViewingParty.customer);
    });

    test('an empty awaiting means nobody owes a reply', () {
      final result = CarViewingActionResult.fromCallable(<Object?, Object?>{
        'purchaseStatus': viewingScheduled,
        'awaiting': '',
      });
      expect(result.awaiting, isNull);
      expect(result.success, isTrue);
    });

    test('an answer it cannot read is not mistaken for a success story', () {
      final result = CarViewingActionResult.fromCallable('nonsense');
      expect(result.purchaseId, isEmpty);
      expect(result.purchaseStatus, isEmpty);
      expect(result.awaiting, isNull);
    });
  });

  group('the wire payload', () {
    test('sends the instant in UTC and the label as offered', () {
      final slot = ViewingSlot(
        startAt: DateTime.utc(2026, 8, 11, 14),
        label: 'Tue, Aug 11 - 2:00 PM',
      );
      expect(slot.toWire(), <String, dynamic>{
        'startAt': '2026-08-11T14:00:00.000Z',
        'label': 'Tue, Aug 11 - 2:00 PM',
      });
    });

    test('the four actions are named the way the callable expects', () {
      expect(
        ViewingAction.values.map((action) => action.wireValue).toList(),
        <String>['propose', 'accept', 'decline', 'cancel'],
      );
    });
  });
}
