import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/transport_opportunity.dart';
import 'package:my_flutter_app/services/business_service_overview.dart';
import 'package:my_flutter_app/services/business_transport_jobs.dart';

/// A transport business could do NOTHING for transport from the phone: nothing
/// subscribed to `transportOpportunities`, so it never saw a request it was
/// invited to price, and the only way to move a won job was the web console -
/// which writes `transportRequests` directly and thereby skips both the
/// server's transition table and its container-number gate.
///
/// Every decision this app makes about that now lives in a pure module, because
/// `AuthProvider` builds Firebase in its field initialisers and cannot be
/// constructed in a widget test. The house pattern is pure-decision tests plus
/// source-contract assertions, and this file is both.

void main() {
  group('the transition table, edge for edge', () {
    // A literal transcription of the `transitions` map inside
    // `updateTransportFulfillmentStatus` (functions/index.js). If the server
    // moves, this fails rather than the carrier finding out by refusal.
    const legal = <String, List<String>>{
      'pending': <String>['scheduled', 'in_transit', 'cancelled'],
      'scheduled': <String>['in_transit', 'cancelled'],
      'in_transit': <String>['delivered'],
      'delivered': <String>[],
      'cancelled': <String>[],
    };

    test('every legal edge is offered, and in the table\'s order', () {
      legal.forEach((current, allowed) {
        expect(
          transportFulfillmentNextStatuses(current),
          allowed,
          reason: '$current should offer exactly $allowed',
        );
      });
    });

    test('every legal edge validates with a container where required', () {
      legal.forEach((current, allowed) {
        for (final next in allowed) {
          expect(
            validateTransportFulfillmentChange(
              currentStatus: current,
              nextStatus: next,
              // Enough to satisfy the in_transit gate; the other moves ignore it.
              existingContainerNumber: 'MSKU1234567',
            ),
            isEmpty,
            reason: '$current -> $next is a legal move',
          );
        }
      });
    });

    test('every ILLEGAL pair of known statuses is refused', () {
      var refusals = 0;
      for (final current in transportFulfillmentStatuses) {
        for (final next in transportFulfillmentStatuses) {
          if (legal[current]!.contains(next)) continue;
          final errors = validateTransportFulfillmentChange(
            currentStatus: current,
            nextStatus: next,
            existingContainerNumber: 'MSKU1234567',
          );
          expect(
            errors,
            isNotEmpty,
            reason: '$current -> $next must not be offered',
          );
          refusals++;
        }
      }
      // 5 statuses squared, minus the 6 legal edges: nothing was skipped.
      expect(refusals, 25 - 6);
    });

    test('pending is a place to be, never a destination', () {
      // The server's allowedStatuses set is scheduled/in_transit/delivered/
      // cancelled - `pending` is not in it, so no status may move back to it.
      for (final current in transportFulfillmentStatuses) {
        expect(
          transportFulfillmentNextStatuses(current),
          isNot(contains('pending')),
        );
        expect(
          validateTransportFulfillmentChange(
            currentStatus: current,
            nextStatus: 'pending',
          ),
          contains(TransportFulfillmentError.nextStatusUnknown),
        );
      }
    });

    test('delivered and cancelled are terminal, not unknown', () {
      // Two different answers: "finished" offers nothing but is still a status
      // the state machine owns, and the screen says so differently.
      for (final terminal in const ['delivered', 'cancelled']) {
        expect(transportFulfillmentStatusIsKnown(terminal), isTrue);
        expect(transportFulfillmentNextStatuses(terminal), isEmpty);
      }
    });

    test('a status the state machine never produced offers nothing', () {
      // updateAdminRecordStatus can write any of ADMIN_OPERATION_STATUSES onto
      // a transportRequests document. None of them is a transport status, and
      // guessing at the nearest one would move a car nobody said had moved.
      for (final status in const [
        'active',
        'in_progress',
        'completed',
        'sold',
        'reserved',
        'inactive',
        'not_started',
        'quote_requested',
        '',
        'something_a_later_server_invents',
      ]) {
        expect(
          transportFulfillmentStatusIsKnown(status),
          isFalse,
          reason: '$status is not a transport status',
        );
        expect(
          transportFulfillmentNextStatuses(status),
          isEmpty,
          reason: 'no transition may be offered from $status',
        );
        for (final next in transportFulfillmentStatuses) {
          expect(
            validateTransportFulfillmentChange(
              currentStatus: status,
              nextStatus: next,
              existingContainerNumber: 'MSKU1234567',
            ),
            contains(TransportFulfillmentError.currentStatusUnknown),
          );
        }
      }
    });

    test('a status is matched literally, exactly as the server matches it', () {
      // The server compares `String(fulfillmentStatus || status)` against its
      // table with no trimming and no case folding, so being more generous here
      // would only ever offer a button the callable refuses.
      for (final status in const ['Pending', ' pending', 'IN_TRANSIT']) {
        expect(transportFulfillmentStatusIsKnown(status), isFalse);
        expect(transportFulfillmentNextStatuses(status), isEmpty);
      }
    });

    test('the live status is read the way the server reads it', () {
      // JS `||`, not Dart `??`: an EMPTY fulfillmentStatus falls through to
      // status. Reading it as `??` made a job look statusless while the server
      // still read it as pending, and offered it nothing at all.
      expect(
        transportJobCurrentStatus(<String, dynamic>{
          'fulfillmentStatus': '',
          'status': 'pending',
        }),
        'pending',
      );
      expect(
        transportJobCurrentStatus(<String, dynamic>{
          'fulfillmentStatus': 'scheduled',
          'status': 'pending',
        }),
        'scheduled',
      );
      expect(transportJobCurrentStatus(<String, dynamic>{}), '');
    });
  });

  group('in transit needs something to track the car by', () {
    test('refused with no container number anywhere', () {
      for (final from in const ['pending', 'scheduled']) {
        expect(
          validateTransportFulfillmentChange(
            currentStatus: from,
            nextStatus: 'in_transit',
          ),
          contains(TransportFulfillmentError.containerNumberRequired),
        );
      }
    });

    test('a number already on the request is enough', () {
      expect(
        validateTransportFulfillmentChange(
          currentStatus: 'scheduled',
          nextStatus: 'in_transit',
          existingContainerNumber: 'MSKU1234567',
        ),
        isEmpty,
      );
    });

    test('a number typed now is enough', () {
      expect(
        validateTransportFulfillmentChange(
          currentStatus: 'pending',
          nextStatus: 'in_transit',
          submittedContainerNumber: 'msku1234567',
        ),
        isEmpty,
      );
    });

    test('too short to be a tracking number is the same as none', () {
      // validateContainerNumber in functions/shipment_tracking.js: under four
      // characters is not a number at all, and the server would refuse.
      for (final scrap in const ['', '   ', 'AB', 'A B']) {
        expect(normalizeTransportContainerNumber(scrap), '');
        expect(
          validateTransportFulfillmentChange(
            currentStatus: 'pending',
            nextStatus: 'in_transit',
            submittedContainerNumber: scrap,
          ),
          contains(TransportFulfillmentError.containerNumberRequired),
        );
      }
    });

    test('the number is normalized the way the server stores it', () {
      expect(normalizeTransportContainerNumber('  msku1234567  '), 'MSKU1234567');
      expect(normalizeTransportContainerNumber('a' * 60).length, 40);
      expect(normalizeTransportContainerNumber(null), '');
    });

    test('no other transition asks for one', () {
      for (final next in const ['scheduled', 'delivered', 'cancelled']) {
        expect(transportFulfillmentRequiresContainer(next), isFalse);
      }
      expect(transportFulfillmentRequiresContainer('in_transit'), isTrue);
      expect(
        validateTransportFulfillmentChange(
          currentStatus: 'in_transit',
          nextStatus: 'delivered',
        ),
        isEmpty,
      );
    });

    test('the payload sends a container only when there is one', () {
      expect(
        transportFulfillmentPayload(
          requestId: 'request-1',
          status: 'in_transit',
          containerNumber: ' msku1234567 ',
          businessId: 'business-1',
        ),
        <String, dynamic>{
          'requestId': 'request-1',
          'status': 'in_transit',
          'businessId': 'business-1',
          'containerNumber': 'MSKU1234567',
        },
      );
      // An empty string would read as an attempt to clear the one on file.
      expect(
        transportFulfillmentPayload(requestId: 'request-1', status: 'delivered'),
        <String, dynamic>{'requestId': 'request-1', 'status': 'delivered'},
      );
    });
  });

  group('what a quote may be', () {
    List<TransportQuoteError> errorsFor(
      String amount, {
      String currency = transportQuoteCurrency,
      String method = 'open',
    }) => validateTransportQuoteDraft(
      TransportQuoteDraft(
        requestId: 'request-1',
        amountText: amount,
        currency: currency,
        transportMethod: method,
      ),
    );

    test('a plain price reads as whole cents', () {
      expect(parseTransportQuoteCents('1250'), 125000);
      expect(parseTransportQuoteCents('1250.50'), 125050);
      expect(parseTransportQuoteCents('1250.5'), 125050);
      expect(parseTransportQuoteCents(' \$1,250.50 '), 125050);
      // Both catalogs are in play: a French carrier types a comma.
      expect(parseTransportQuoteCents('1250,50'), 125050);
      expect(parseTransportQuoteCents('1,250'), 125000);
      expect(errorsFor('1250.50'), isEmpty);
    });

    test('zero is not a quote', () {
      expect(
        errorsFor('0'),
        contains(TransportQuoteError.amountNotPositive),
      );
      expect(
        errorsFor('0.00'),
        contains(TransportQuoteError.amountNotPositive),
      );
    });

    test('a negative amount is refused as a price, not as gibberish', () {
      // "That is not a number" would send a carrier hunting for a typo that is
      // not there; the minus sign is the problem and the message has to say so.
      expect(parseTransportQuoteCents('-5'), -500);
      expect(
        errorsFor('-5'),
        contains(TransportQuoteError.amountNotPositive),
      );
    });

    test('more precision than cents is its own refusal', () {
      // The server takes amountCents as a safe integer, so a third decimal is
      // not a rounding problem - it is a different amount.
      expect(transportQuoteAmountIsFractional('1250.005'), isTrue);
      expect(
        errorsFor('1250.005'),
        contains(TransportQuoteError.amountFractionalCents),
      );
      expect(transportQuoteAmountIsFractional('1250.50'), isFalse);
    });

    test('anything that is not a number at all is refused', () {
      for (final rubbish in const ['abc', '12.34.56', '1e5', '--5', '.']) {
        expect(
          errorsFor(rubbish),
          contains(TransportQuoteError.amountInvalid),
          reason: '"$rubbish" is not a price',
        );
      }
      expect(errorsFor('  '), contains(TransportQuoteError.amountRequired));
    });

    test('the cap is the server\'s, to the cent', () {
      // MAX_TRANSPORT_QUOTE_CENTS in functions/index.js is 100000000.
      expect(maxTransportQuoteCents, 100000000);
      expect(errorsFor('1000000'), isEmpty);
      expect(
        errorsFor('1000000.01'),
        contains(TransportQuoteError.amountAboveCap),
      );
      expect(
        errorsFor('12500000'),
        contains(TransportQuoteError.amountAboveCap),
      );
    });

    test('the currency is asserted, not chosen', () {
      expect(transportQuoteCurrency, 'usd');
      expect(errorsFor('1250', currency: 'USD'), isEmpty);
      for (final wrong in const ['eur', 'gnf', 'cad', '']) {
        expect(
          errorsFor('1250', currency: wrong),
          contains(TransportQuoteError.currencyNotSupported),
        );
      }
      // Whatever the form thinks, the payload only ever sends usd.
      expect(
        transportQuotePayload(
          const TransportQuoteDraft(
            requestId: 'request-1',
            amountText: '1250',
            currency: 'eur',
          ),
        )['currency'],
        'usd',
      );
    });

    test('the method is one of the server\'s two', () {
      for (final method in transportQuoteMethods) {
        expect(errorsFor('1250', method: method), isEmpty);
      }
      expect(
        errorsFor('1250', method: 'flatbed'),
        contains(TransportQuoteError.methodNotSupported),
      );
    });

    test('the dates go together, forward, and in the future', () {
      final now = DateTime(2026, 8, 7);
      List<TransportQuoteError> dated(DateTime? pickup, DateTime? delivery) =>
          validateTransportQuoteDraft(
            TransportQuoteDraft(
              requestId: 'request-1',
              amountText: '1250',
              estimatedPickupDate: pickup,
              estimatedDeliveryDate: delivery,
            ),
            now: now,
          );
      expect(dated(null, null), isEmpty);
      expect(
        dated(DateTime(2026, 8, 10), null),
        contains(TransportQuoteError.datesIncomplete),
      );
      expect(
        dated(DateTime(2026, 8, 1), DateTime(2026, 8, 10)),
        contains(TransportQuoteError.pickupDateNotInFuture),
      );
      expect(
        dated(DateTime(2026, 8, 10), DateTime(2026, 8, 9)),
        contains(TransportQuoteError.deliveryBeforePickup),
      );
      expect(dated(DateTime(2026, 8, 10), DateTime(2026, 8, 20)), isEmpty);
    });

    test('every objection is named at once, not one per tap', () {
      final errors = errorsFor('0', currency: 'eur', method: 'flatbed');
      expect(errors, hasLength(3));
    });

    test('the payload is integer cents and nothing else', () {
      final payload = transportQuotePayload(
        TransportQuoteDraft(
          requestId: 'request-1',
          amountText: '1,250.50',
          transportMethod: 'ENCLOSED',
          terms: '  Door to door  ',
          estimatedPickupDate: DateTime(2026, 9, 1),
          estimatedDeliveryDate: DateTime(2026, 9, 20),
        ),
        businessId: 'business-1',
      );
      expect(payload['amountCents'], 125050);
      expect(payload['amountCents'], isA<int>());
      expect(payload['currency'], 'usd');
      expect(payload['transportMethod'], 'enclosed');
      expect(payload['terms'], 'Door to door');
      expect(payload['businessId'], 'business-1');
      // Midday, so a timezone west of UTC cannot roll the estimate back a day
      // on the server's `new Date(...)`.
      expect(payload['estimatedPickupDate'], '2026-09-01T12:00:00');
      expect(payload['estimatedDeliveryDate'], '2026-09-20T12:00:00');
    });

    test('the total the customer sees is the price plus the pickup leg', () {
      expect(transportQuoteTotalCents(125000, 7500), 132500);
      expect(transportQuoteTotalCents(125000, 0), 125000);
    });
  });

  group('what the Car Transport tile counts', () {
    List<BusinessServiceTile> tiles({
      List<String> opportunities = const [],
      List<String> jobs = const [],
    }) => businessServiceOverviewTiles(
      services: const ['carTransport'],
      hasPermission: (_) => true,
      parkedCarFields: const [],
      barrelStatuses: const [],
      freightStatuses: const [],
      transportStatuses: jobs,
      transportOpportunityStatuses: opportunities,
    );

    test('open requests plus won jobs still moving', () {
      expect(
        tiles(
          opportunities: const ['open', 'open', 'quoted', 'selected', 'closed'],
          jobs: const ['pending', 'in_transit', 'delivered', 'cancelled'],
        ).single.count,
        4, // two to bid on, two still moving
      );
    });

    test('a quoted request is waiting on the customer, not on the carrier', () {
      expect(
        businessTransportNeedsYouCount(
          opportunityStatuses: const ['quoted', 'selected', 'cancelled', 'withdrawn'],
        ),
        0,
      );
    });

    test('a delivered or cancelled job is not still needing anyone', () {
      expect(
        businessTransportNeedsYouCount(
          jobStatuses: const ['delivered', 'cancelled', 'completed'],
        ),
        0,
      );
      // `completed` is what the admin path calls the same thing, and a carrier
      // must not be sent back to a job an admin already closed out.
      expect(transportJobNeedsAction('completed'), isFalse);
      expect(transportJobNeedsAction(' DELIVERED '), isFalse);
    });

    test('a job with no status recorded still counts', () {
      // Under-counting is the direction that strands a car on a dock.
      expect(businessTransportNeedsYouCount(jobStatuses: const ['', '  ']), 2);
    });

    test('nothing to do reads zero, not a missing tile', () {
      final tile = tiles(opportunities: const ['closed'], jobs: const ['delivered']).single;
      expect(tile.count, 0);
      expect(tile.category, ServiceCategory.transport);
    });

    test('the caption says what the number means', () {
      expect(
        tiles().single.meaning,
        BusinessServiceCountMeaning.needsYou,
      );
      expect(tiles().single.countIsUnpaid, isFalse);
      // Parking still counts money, and the other services still count records.
      final grid = businessServiceOverviewTiles(
        services: const ['carParking', 'barrelShipping', 'carTransport'],
        hasPermission: (_) => true,
        parkedCarFields: const [],
        barrelStatuses: const [],
        freightStatuses: const [],
        transportStatuses: const [],
      );
      expect(
        grid.map((tile) => tile.meaning),
        [
          BusinessServiceCountMeaning.unpaid,
          BusinessServiceCountMeaning.open,
          BusinessServiceCountMeaning.needsYou,
        ],
      );
    });
  });

  group('which list a request is in', () {
    test('only an open opportunity is asking for a price', () {
      expect(transportOpportunityIsOpenForBidding('open'), isTrue);
      expect(transportOpportunityIsOpenForBidding(' OPEN '), isTrue);
      for (final other in const [
        'quoted',
        'selected',
        'closed',
        'cancelled',
        'withdrawn',
        '',
      ]) {
        expect(transportOpportunityIsOpenForBidding(other), isFalse);
      }
    });

    test('a selected opportunity is in no list, because the job is', () {
      // The work moved to the transportRequests document. Showing both would
      // have a carrier looking at one car twice.
      expect(transportOpportunitySection('selected'), isNull);
      expect(transportOpportunitySection('closed'), isNull);
      expect(
        transportOpportunitySection('open'),
        BusinessTransportSection.openToBid,
      );
      expect(
        transportOpportunitySection('quoted'),
        BusinessTransportSection.quoted,
      );
    });

    test('an opportunity keeps its request id even from a bare document', () {
      // All three callables key on requestId; an opportunity nobody can quote
      // is worse than one parsed the long way out of its composite id.
      final opportunity = TransportOpportunity.fromMap(
        id: 'request-1__business-1',
        data: const <String, dynamic>{'businessId': 'business-1'},
      );
      expect(opportunity.requestId, 'request-1');
      expect(opportunity.vehicleLabel, '');
      expect(opportunity.requestedTransportMethod, 'open');
    });

    test('an opportunity reads a numeric car year', () {
      final opportunity = TransportOpportunity.fromMap(
        id: 'request-1__business-1',
        data: const <String, dynamic>{
          'requestId': 'request-1',
          'carYear': 2022,
          'carMake': 'Toyota',
          'carModel': 'Camry',
          'status': 'open',
        },
      );
      expect(opportunity.vehicleLabel, '2022 Toyota Camry');
    });
  });

  group('the app spends the decisions it is given', () {
    final module = File(
      'lib/services/business_transport_jobs.dart',
    ).readAsStringSync();
    final feed = File(
      'lib/screens/business_transport_screen.dart',
    ).readAsStringSync();
    final bid = File(
      'lib/screens/business_transport_bid_screen.dart',
    ).readAsStringSync();
    final home = File('lib/screens/home_menu.dart').readAsStringSync();

    test('the three callables are called, and no others invented', () {
      expect(module, contains("httpsCallable('submitTransportQuote')"));
      expect(module, contains("httpsCallable('withdrawTransportQuote')"));
      expect(
        module,
        contains("httpsCallable('updateTransportFulfillmentStatus')"),
      );
    });

    test('the status change goes through the callable, never a direct write', () {
      // The web console writes `transportRequests` directly and so bypasses the
      // transition table AND the container gate. Mobile is the correct
      // implementation of the same action, and nothing here may regress to it.
      for (final source in <String>[module, feed]) {
        expect(source, isNot(contains('.update(')));
        expect(source, isNot(contains('.set(')));
      }
      expect(feed, contains('updateFulfillmentStatus('));
    });

    test('the job control mirrors the table instead of listing statuses', () {
      expect(feed, contains('transportFulfillmentNextStatuses('));
      expect(feed, contains('validateTransportFulfillmentChange('));
      expect(feed, contains('transportFulfillmentStatusIsKnown('));
      // An unrecognised status is shown and offered nothing.
      expect(feed, contains("Key('transport-job-unknown-"));
    });

    test('the container number is asked for before the tap, not after', () {
      expect(feed, contains('transportFulfillmentRequiresContainer'));
      expect(feed, contains("Key('transport-job-container-"));
    });

    test('the bid screen validates in front of the carrier', () {
      expect(bid, contains('validateTransportQuoteDraft('));
      expect(bid, contains('transportQuoteErrorSummary('));
      // And shows the pickup fee and the resulting total.
      expect(bid, contains('transportQuoteTotalCents('));
      expect(bid, contains('pickupFeeCents'));
      expect(bid, contains("Key('transport-bid-total')"));
    });

    test('a re-bid reads as a revision, not a second quote', () {
      expect(bid, contains("Key('transport-bid-revision-notice')"));
      expect(bid, contains('businessTransportReviseNotice'));
      expect(bid, contains('businessTransportRevisionNumber'));
    });

    test('server refusals are surfaced, not replaced', () {
      for (final source in <String>[feed, bid]) {
        expect(source, contains('on FirebaseFunctionsException catch'));
        expect(source, contains('error.message'));
      }
    });

    test('the home screen subscribes to the opportunity collection', () {
      expect(home, contains("collection('transportOpportunities')"));
      expect(home, contains('transportOpportunityStatuses:'));
      expect(home, contains("Key('open-transport-jobs')"));
      // Five feeds now, five before the grid needed them: the count is derived
      // from a subscription the business needs anyway, not bought for a badge.
      expect('FirebaseFirestore.instance.collection('.allMatches(home).length, 5);
      expect('.snapshots().listen('.allMatches(home).length, 5);
    });

    test('money never becomes a double on its way to the server', () {
      // The server checks amountCents with Number.isSafeInteger, so the amount
      // is built from two integers rather than by multiplying a parsed double
      // by 100 - which is how 12.34 becomes 1233.9999999999998 cents.
      expect(module, contains('dollars * 100 + cents'));
      expect(module, isNot(contains('double.parse')));
      expect(module, isNot(contains('double.tryParse')));
      expect(module, isNot(contains('.toDouble()')));
      expect(
        transportQuotePayload(
          const TransportQuoteDraft(
            requestId: 'request-1',
            amountText: '12.34',
          ),
        )['amountCents'],
        1234,
      );
    });
  });

  group('every new string is in both catalogs', () {
    Map<String, dynamic> catalog(String path) =>
        jsonDecode(File(path).readAsStringSync()) as Map<String, dynamic>;

    final en = catalog('lib/l10n/app_en.arb');
    final fr = catalog('lib/l10n/app_fr.arb');

    test('the transport copy is bilingual', () {
      for (final key in const [
        'businessServiceOverviewNeedsYou',
        'businessTransportTitle',
        'businessTransportSubtitle',
        'businessTransportOpenToBid',
        'businessTransportQuoted',
        'businessTransportWonJobs',
        'businessTransportNoOpportunities',
        'businessTransportNoQuotes',
        'businessTransportNoJobs',
        'businessTransportSendQuote',
        'businessTransportReviseQuote',
        'businessTransportReviseNotice',
        'businessTransportWithdrawQuote',
        'businessTransportQuoteWithdrawn',
        'businessTransportQuoteSent',
        'businessTransportQuoteRevised',
        'businessTransportAmountLabel',
        'businessTransportPickupLeg',
        'businessTransportPickupPending',
        'businessTransportCustomerTotal',
        'transportQuoteAmountRequired',
        'transportQuoteAmountInvalid',
        'transportQuoteAmountFractional',
        'transportQuoteAmountNotPositive',
        'transportQuoteAmountAboveCap',
        'transportQuoteCurrencyNotSupported',
        'transportQuoteMethodNotSupported',
        'transportQuoteDatesIncomplete',
        'transportQuotePickupNotInFuture',
        'transportQuoteDeliveryBeforePickup',
        'transportStatusScheduled',
        'transportJobMoveTitle',
        'transportJobStatusUnknown',
        'transportJobNothingLeft',
        'transportJobStatusUpdated',
        'transportJobContainerRequired',
        'transportJobTransitionNotAllowed',
      ]) {
        expect(en[key], isNotNull, reason: 'missing English $key');
        expect(fr[key], isNotNull, reason: 'missing French $key');
        expect(en[key], isNot(fr[key]), reason: '$key is not translated');
      }
    });

    test('the placeholders survive translation', () {
      // A French sentence that dropped {status} would render a status-free
      // refusal, which is no refusal at all.
      for (final entry in const <String, List<String>>{
        'transportJobStatusUnknown': ['{status}'],
        'transportJobStatusAlready': ['{status}'],
        'transportJobTransitionNotAllowed': ['{from}', '{to}'],
        'transportJobContainerOnFile': ['{number}'],
        'businessTransportRevisionNumber': ['{revision}'],
        'businessTransportQuoteRevised': ['{revision}'],
      }.entries) {
        for (final placeholder in entry.value) {
          expect(en[entry.key], contains(placeholder));
          expect(
            fr[entry.key],
            contains(placeholder),
            reason: '${entry.key} lost $placeholder in French',
          );
        }
      }
    });
  });
}
