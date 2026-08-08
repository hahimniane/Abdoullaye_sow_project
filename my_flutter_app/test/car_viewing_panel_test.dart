import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/car_purchase.dart';
import 'package:my_flutter_app/services/car_viewing_service.dart';
import 'package:my_flutter_app/widgets/car_viewing_negotiation.dart';

/// The panel both sides of a viewing read.
///
/// The rules themselves are pinned in `car_viewing_negotiation_test.dart`;
/// these tests pin what the rules actually put in front of a person, because an
/// "Accept" the server would refuse is exactly the bug the shared gates exist
/// to prevent - and because the buyer's card and the seller's card are the same
/// widget, one of them showing the wrong buttons would otherwise go unnoticed.

final DateTime now = DateTime.now();

CarPurchase viewing({
  required String status,
  String proposedBy = 'customer',
  int round = 1,
  List<Duration> slots = const <Duration>[Duration(days: 2)],
  Duration? appointmentIn,
}) => CarPurchase.fromMap('p1', <String, dynamic>{
  'carId': 'car-1',
  'carTitle': 'Toyota Camry 2019',
  'paymentType': 'viewing_reservation',
  'purchaseStatus': status,
  'depositAmount': 0,
  'proposedBy': proposedBy,
  'proposalRound': round,
  'respondByAt': now.add(const Duration(hours: 12)),
  'appointmentStart': appointmentIn == null ? null : now.add(appointmentIn),
  'proposedSlots': slots
      .map(
        (offset) => <String, Object?>{
          'startAtMs': now.add(offset).millisecondsSinceEpoch,
          'label': 'in ${offset.inHours}h',
        },
      )
      .toList(),
  'viewingHistory': <Object?>[
    <String, Object?>{
      'actor': 'customer',
      'action': 'propose',
      'atMs': now.millisecondsSinceEpoch,
    },
  ],
});

Future<void> pumpPanel(
  WidgetTester tester, {
  required CarPurchase purchase,
  required ViewingParty party,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: SingleChildScrollView(
          child: CarViewingNegotiationPanel(purchase: purchase, party: party),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('the seller answering a request can accept, counter or decline', (
    tester,
  ) async {
    await pumpPanel(
      tester,
      purchase: viewing(status: viewingRequested),
      party: ViewingParty.business,
    );

    expect(find.byKey(const Key('viewing-accept')), findsOneWidget);
    expect(find.byKey(const Key('viewing-propose')), findsOneWidget);
    expect(find.byKey(const Key('viewing-decline')), findsOneWidget);
    expect(find.byKey(const Key('viewing-cancel')), findsOneWidget);
  });

  testWidgets('the buyer waiting on an answer is offered no accept', (
    tester,
  ) async {
    await pumpPanel(
      tester,
      purchase: viewing(status: viewingRequested),
      party: ViewingParty.customer,
    );

    // Accepting your own proposal is not a thing, and neither is declining
    // your own viewing - the buyer cancels instead.
    expect(find.byKey(const Key('viewing-accept')), findsNothing);
    expect(find.byKey(const Key('viewing-decline')), findsNothing);
    expect(find.byKey(const Key('viewing-propose')), findsOneWidget);
    expect(find.byKey(const Key('viewing-cancel')), findsOneWidget);
  });

  testWidgets('a counter puts every offered time in front of the buyer', (
    tester,
  ) async {
    await pumpPanel(
      tester,
      purchase: viewing(
        status: viewingCountered,
        proposedBy: 'business',
        round: 2,
        slots: const <Duration>[
          Duration(days: 1),
          Duration(days: 2),
          Duration(days: 3),
        ],
      ),
      party: ViewingParty.customer,
    );

    expect(find.byType(ChoiceChip), findsNWidgets(3));
    expect(find.byKey(const Key('viewing-accept')), findsOneWidget);
  });

  testWidgets('a confirmed viewing offers a reschedule, not an accept', (
    tester,
  ) async {
    await pumpPanel(
      tester,
      purchase: viewing(
        status: viewingScheduled,
        slots: const <Duration>[],
        appointmentIn: const Duration(days: 3),
      ),
      party: ViewingParty.customer,
    );

    expect(find.byKey(const Key('viewing-accept')), findsNothing);
    expect(find.byKey(const Key('viewing-propose')), findsOneWidget);
    expect(find.byKey(const Key('viewing-cancel')), findsOneWidget);
  });

  testWidgets('nothing is offered inside the last hour of an appointment', (
    tester,
  ) async {
    await pumpPanel(
      tester,
      purchase: viewing(
        status: viewingScheduled,
        slots: const <Duration>[],
        appointmentIn: const Duration(minutes: 30),
      ),
      party: ViewingParty.business,
    );

    expect(find.byKey(const Key('viewing-propose')), findsNothing);
    expect(find.byKey(const Key('viewing-cancel')), findsNothing);
  });

  testWidgets('a declined viewing shows the trail and no way to act on it', (
    tester,
  ) async {
    final l10n = await AppLocalizations.delegate.load(const Locale('en'));
    await pumpPanel(
      tester,
      purchase: viewing(status: viewingDeclined),
      party: ViewingParty.customer,
    );

    expect(find.byKey(const Key('viewing-cancel')), findsNothing);
    expect(find.byKey(const Key('viewing-propose')), findsNothing);
    expect(find.text(l10n.viewingClosedNotice), findsOneWidget);
    expect(find.byKey(const Key('viewing-history')), findsOneWidget);
  });

  testWidgets('the round cap is said out loud rather than left unexplained', (
    tester,
  ) async {
    final l10n = await AppLocalizations.delegate.load(const Locale('en'));
    await pumpPanel(
      tester,
      purchase: viewing(
        status: viewingCountered,
        proposedBy: 'business',
        round: maxViewingProposalRounds,
      ),
      party: ViewingParty.customer,
    );

    expect(find.byKey(const Key('viewing-propose')), findsNothing);
    expect(find.text(l10n.viewingNoMoreCounters), findsOneWidget);
    expect(find.byKey(const Key('viewing-accept')), findsOneWidget);
  });
}
