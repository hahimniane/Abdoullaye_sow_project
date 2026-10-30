import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/guest_tracking_result.dart';
import 'package:my_flutter_app/providers/language_provider.dart';
import 'package:my_flutter_app/services/lot_ledger.dart' show formatLotCents;
import 'package:my_flutter_app/services/guest_tracking_service.dart';
import 'package:my_flutter_app/services/parking_whatsapp.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/guest_tracking_lookup.dart';
import 'package:my_flutter_app/widgets/parking_messages_section.dart';
import 'package:my_flutter_app/widgets/parking_welcome_sheet.dart';
import 'package:my_flutter_app/widgets/parking_whatsapp_switch.dart';
import 'package:provider/provider.dart';

/// Parking customers on WhatsApp, app side (docs/PARKING_WHATSAPP.md §3):
/// the owner's switch, the one-time welcome, the messages on a car, and the
/// parked car's money on its Track page - in English and French.

class _FakeService implements ParkingWhatsAppService {
  final List<({String businessId, bool enabled})> flips = [];
  final List<List<String>?> sends = [];
  Object? setEnabledError;
  Completer<List<ParkingWelcomeRecipient>>? previewGate;
  List<ParkingWelcomeRecipient> recipients = const [];
  Object? sendError;
  ParkingWelcomeResult sendResult = const ParkingWelcomeResult(sent: 1);
  int previews = 0;

  @override
  Future<void> setEnabled({
    required String businessId,
    required bool enabled,
  }) async {
    flips.add((businessId: businessId, enabled: enabled));
    final error = setEnabledError;
    if (error != null) throw error;
  }

  @override
  Future<List<ParkingWelcomeRecipient>> welcomePreview(String businessId) {
    previews += 1;
    return previewGate?.future ?? Future.value(recipients);
  }

  @override
  Future<ParkingWelcomeResult> welcomeSend({
    required String businessId,
    List<String>? phones,
  }) async {
    sends.add(phones);
    final error = sendError;
    if (error != null) throw error;
    return sendResult;
  }
}

FirebaseFunctionsException _refusal(String reason) =>
    FirebaseFunctionsException(
      message: 'refused',
      code: 'failed-precondition',
      details: <String, Object?>{'reason': reason},
    );

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
  Size size = const Size(360, 800),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final language = LanguageProvider()..setLanguage(locale.languageCode);
  await tester.pumpWidget(
    ChangeNotifierProvider.value(
      value: language,
      child: MaterialApp(
        theme: AppTheme.light,
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: SafeArea(child: SingleChildScrollView(child: child)),
        ),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  group('the switch', () {
    testWidgets('is hidden for staff', (tester) async {
      await _pump(
        tester,
        ParkingWhatsAppSwitch(
          businessId: 'biz1',
          enabled: false,
          canEdit: false,
          service: _FakeService(),
        ),
      );
      expect(find.byKey(const Key('parking-whatsapp-switch')), findsNothing);
      expect(
        find.text('Send WhatsApp messages to parking customers'),
        findsNothing,
      );
    });

    testWidgets('the owner sees it, off by default, and turns it on', (
      tester,
    ) async {
      final service = _FakeService();
      await _pump(
        tester,
        ParkingWhatsAppSwitch(
          businessId: 'biz1',
          enabled: false,
          canEdit: true,
          service: service,
        ),
      );
      expect(
        find.text('Send WhatsApp messages to parking customers'),
        findsOneWidget,
      );
      expect(
        tester
            .widget<SwitchListTile>(
              find.byKey(const Key('parking-whatsapp-switch')),
            )
            .value,
        isFalse,
      );

      await tester.tap(find.byKey(const Key('parking-whatsapp-switch')));
      await tester.pumpAndSettle();

      expect(service.flips, [(businessId: 'biz1', enabled: true)]);
      // Stays on while the business record catches up.
      expect(
        tester
            .widget<SwitchListTile>(
              find.byKey(const Key('parking-whatsapp-switch')),
            )
            .value,
        isTrue,
      );
    });

    testWidgets('a refusal puts it back and says why, in French too', (
      tester,
    ) async {
      final service = _FakeService()
        ..setEnabledError = _refusal('parking_whatsapp_owner_only');
      await _pump(
        tester,
        ParkingWhatsAppSwitch(
          businessId: 'biz1',
          enabled: false,
          canEdit: true,
          service: service,
        ),
        locale: const Locale('fr'),
      );
      expect(
        find.text('Envoyer des messages WhatsApp aux clients du parking'),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const Key('parking-whatsapp-switch')));
      await tester.pumpAndSettle();

      expect(
        find.text('Seul le propriétaire de l\'entreprise peut modifier ceci.'),
        findsOneWidget,
      );
      expect(
        tester
            .widget<SwitchListTile>(
              find.byKey(const Key('parking-whatsapp-switch')),
            )
            .value,
        isFalse,
      );
    });

    testWidgets('a call that never answers resolves by timeout', (
      tester,
    ) async {
      final service = _HangingService();
      await _pump(
        tester,
        ParkingWhatsAppSwitch(
          businessId: 'biz1',
          enabled: false,
          canEdit: true,
          service: service,
          timeout: const Duration(seconds: 2),
        ),
      );
      await tester.tap(find.byKey(const Key('parking-whatsapp-switch')));
      await tester.pump();
      expect(
        tester
            .widget<SwitchListTile>(
              find.byKey(const Key('parking-whatsapp-switch')),
            )
            .onChanged,
        isNull,
      );
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();
      expect(
        find.text('Could not change this setting. Try again.'),
        findsOneWidget,
      );
      expect(
        tester
            .widget<SwitchListTile>(
              find.byKey(const Key('parking-whatsapp-switch')),
            )
            .onChanged,
        isNotNull,
      );
    });
  });

  group('the welcome', () {
    final recipients = [
      const ParkingWelcomeRecipient(
        phone: '+13475550101',
        name: 'Awa Diallo',
        cars: [
          ParkingWelcomeCar(
            id: 'c1',
            label: '2014 Toyota Corolla',
            trackingCode: 'PK-AAA111',
          ),
          ParkingWelcomeCar(
            id: 'c2',
            label: '2016 Toyota RAV4',
            trackingCode: 'PK-AAA222',
          ),
        ],
        alreadyWelcomed: false,
      ),
      const ParkingWelcomeRecipient(
        phone: '+13475550102',
        name: 'Moussa Ba',
        cars: [
          ParkingWelcomeCar(
            id: 'c3',
            label: '2012 Honda Civic',
            trackingCode: 'PK-BBB111',
          ),
        ],
        alreadyWelcomed: true,
      ),
    ];

    testWidgets('the button needs the owner and the switch on', (tester) async {
      Future<void> pumpEntry({
        required bool canSend,
        required Stream<bool> enabled,
      }) async {
        await _pump(
          tester,
          ParkingWelcomeEntry(
            key: UniqueKey(),
            businessId: 'biz1',
            canSend: canSend,
            service: _FakeService(),
            enabledStream: enabled,
          ),
        );
        await tester.pump();
      }

      await pumpEntry(canSend: true, enabled: Stream.value(false));
      expect(find.byKey(const Key('parking-welcome-open')), findsNothing);

      await pumpEntry(canSend: false, enabled: Stream.value(true));
      expect(find.byKey(const Key('parking-welcome-open')), findsNothing);

      await pumpEntry(canSend: true, enabled: Stream.value(true));
      expect(find.text('Send welcome to current customers'), findsOneWidget);

      // A record that cannot be read hides it, never crashes.
      await pumpEntry(
        canSend: true,
        enabled: Stream<bool>.error(StateError('denied')),
      );
      expect(find.byKey(const Key('parking-welcome-open')), findsNothing);
    });

    testWidgets('preview, select, send, result', (tester) async {
      final service = _FakeService()..recipients = recipients;
      await _pump(
        tester,
        ParkingWelcomeEntry(
          businessId: 'biz1',
          canSend: true,
          service: service,
          enabledStream: Stream.value(true),
        ),
      );
      await tester.pump();
      await tester.tap(find.byKey(const Key('parking-welcome-open')));
      await tester.pumpAndSettle();

      // One row per number, with its cars; the welcomed one muted.
      expect(find.text('Awa Diallo · +13475550101'), findsOneWidget);
      expect(
        find.text('2014 Toyota Corolla, 2016 Toyota RAV4'),
        findsOneWidget,
      );
      expect(find.text('Moussa Ba · +13475550102'), findsOneWidget);
      expect(find.text('2012 Honda Civic · Already welcomed'), findsOneWidget);
      CheckboxListTile row(String phone) => tester.widget<CheckboxListTile>(
        find.byKey(Key('parking-welcome-row-$phone')),
      );
      expect(row('+13475550101').value, isTrue);
      expect(row('+13475550102').value, isFalse);
      expect(find.text('Send to 1 customer'), findsOneWidget);

      // Ticking the welcomed one back on is allowed.
      await tester.tap(find.byKey(const Key('parking-welcome-all')));
      await tester.pump();
      expect(find.text('Send to 2 customers'), findsOneWidget);
      await tester.tap(find.byKey(const Key('parking-welcome-none')));
      await tester.pump();
      expect(
        tester
            .widget<FilledButton>(find.byKey(const Key('parking-welcome-send')))
            .onPressed,
        isNull,
      );
      await tester.tap(
        find.byKey(const Key('parking-welcome-row-+13475550101')),
      );
      await tester.pump();

      service.sendResult = const ParkingWelcomeResult(
        sent: 1,
        skipped: 0,
        failed: 0,
      );
      await tester.tap(find.byKey(const Key('parking-welcome-send')));
      await tester.pumpAndSettle();

      expect(service.sends, [
        ['+13475550101'],
      ]);
      expect(find.text('Welcome sent'), findsOneWidget);
      expect(find.text('Sent 1 · Skipped 0 · Failed 0'), findsOneWidget);
      await tester.tap(find.byKey(const Key('parking-welcome-done')));
      await tester.pumpAndSettle();
      expect(find.text('Welcome sent'), findsNothing);
    });

    testWidgets('loading always resolves: a preview that hangs times out', (
      tester,
    ) async {
      final service = _FakeService()
        ..previewGate = Completer<List<ParkingWelcomeRecipient>>();
      await _pump(
        tester,
        Builder(
          builder: (context) => TextButton(
            onPressed: () => showParkingWelcomeSheet(
              context,
              businessId: 'biz1',
              service: service,
              timeout: const Duration(seconds: 2),
            ),
            child: const Text('open'),
          ),
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Finding your customers…'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      await tester.pump(const Duration(seconds: 3));
      await tester.pump();
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(
        find.text('Could not load your customers. Try again.'),
        findsOneWidget,
      );

      // Retry asks again, and the answer lands.
      service
        ..previewGate = null
        ..recipients = recipients;
      await tester.tap(find.byKey(const Key('parking-welcome-retry')));
      await tester.pumpAndSettle();
      expect(service.previews, 2);
      expect(find.text('Awa Diallo · +13475550101'), findsOneWidget);
    });

    testWidgets('an empty lot says so, and a refusal is worded', (
      tester,
    ) async {
      final service = _FakeService();
      await _pump(
        tester,
        Builder(
          builder: (context) => TextButton(
            onPressed: () => showParkingWelcomeSheet(
              context,
              businessId: 'biz1',
              service: service,
            ),
            child: const Text('open'),
          ),
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      expect(
        find.text('No customers have a car in the lot right now.'),
        findsOneWidget,
      );
    });

    testWidgets('a send refused for a switched-off business shows why', (
      tester,
    ) async {
      final service = _FakeService()
        ..recipients = recipients
        ..sendError = _refusal('parking_whatsapp_off');
      await _pump(
        tester,
        Builder(
          builder: (context) => TextButton(
            onPressed: () => showParkingWelcomeSheet(
              context,
              businessId: 'biz1',
              service: service,
            ),
            child: const Text('open'),
          ),
        ),
        locale: const Locale('fr'),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      expect(find.text('Envoyer à 1 client'), findsOneWidget);
      await tester.tap(find.byKey(const Key('parking-welcome-send')));
      await tester.pumpAndSettle();
      expect(
        find.text(
          'Les messages WhatsApp sont désactivés pour cette entreprise.',
        ),
        findsOneWidget,
      );
      // Back to the list: the button works again.
      expect(find.byKey(const Key('parking-welcome-send')), findsOneWidget);
    });
  });

  group('the messages on a car', () {
    final rows = <({String id, Map<String, dynamic> data})>[
      (
        id: 'c1_parked',
        data: {
          'kind': 'parked',
          'status': 'sent',
          'deliveryStatus': 'read',
          'phone': '+13475550101',
          'sentAt': DateTime(2026, 10, 27, 15, 5),
          'createdAt': DateTime(2026, 10, 27, 15, 4),
        },
      ),
      (
        id: 'c1_pay_p1',
        data: {
          'kind': 'receipt',
          'status': 'failed',
          'error': 'Recipient phone number not in allowed list',
          'phone': '+13475550101',
          'createdAt': DateTime(2026, 10, 28, 9, 30),
        },
      ),
      (
        id: 'c1_pay_p2',
        data: {
          'kind': 'receipt',
          'status': 'stopped',
          'createdAt': DateTime(2026, 10, 29, 9, 30),
        },
      ),
      // A kind this app does not know is left out, not a crash.
      (id: 'x', data: {'kind': 'mystery', 'status': 'sent'}),
    ];

    testWidgets('lists kind, US-format date, status and error, newest first', (
      tester,
    ) async {
      await _pump(
        tester,
        ParkingMessagesSection(
          parkedCarId: 'c1',
          messages: Stream.value(parkingMessagesOf(rows)),
        ),
      );
      await tester.pump();

      expect(find.text('WhatsApp messages'), findsOneWidget);
      expect(find.text('Car parked'), findsOneWidget);
      expect(find.text('Payment receipt'), findsNWidgets(2));
      expect(find.byKey(const Key('parking-message-x')), findsNothing);
      // Month-first, 12-hour.
      expect(find.textContaining('Oct 27, 2026'), findsOneWidget);
      expect(find.textContaining('3:05'), findsOneWidget);
      expect(find.textContaining('PM'), findsWidgets);
      // The delivery status refines "sent".
      expect(find.text('Read'), findsOneWidget);
      expect(find.text('Failed'), findsOneWidget);
      expect(
        find.text('Recipient phone number not in allowed list'),
        findsOneWidget,
      );
      expect(find.text('Stopped by the customer'), findsOneWidget);

      // Newest first.
      final tops = [
        for (final id in ['c1_pay_p2', 'c1_pay_p1', 'c1_parked'])
          tester.getTopLeft(find.byKey(Key('parking-message-$id'))).dy,
      ];
      expect(tops, orderedEquals([...tops]..sort()));
    });

    testWidgets('hidden when nothing was sent or the read is refused', (
      tester,
    ) async {
      await _pump(
        tester,
        ParkingMessagesSection(
          parkedCarId: 'c1',
          messages: Stream.value(const <ParkingMessage>[]),
        ),
      );
      await tester.pump();
      expect(find.byKey(const Key('parking-messages')), findsNothing);

      await _pump(
        tester,
        ParkingMessagesSection(
          parkedCarId: 'c1',
          messages: Stream<List<ParkingMessage>>.error(StateError('denied')),
        ),
      );
      await tester.pump();
      expect(find.byKey(const Key('parking-messages')), findsNothing);
    });

    testWidgets('French at 360 px', (tester) async {
      await _pump(
        tester,
        ParkingMessagesSection(
          parkedCarId: 'c1',
          messages: Stream.value(parkingMessagesOf(rows)),
        ),
        locale: const Locale('fr'),
      );
      await tester.pump();
      expect(find.text('Messages WhatsApp'), findsOneWidget);
      expect(find.text('Voiture garée'), findsOneWidget);
      expect(find.text('Reçu de paiement'), findsNWidgets(2));
      expect(find.text('Lu'), findsOneWidget);
      expect(find.text('Échec'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('the Track page money block', () {
    GuestTrackingResult found(Map<String, dynamic> parking) =>
        GuestTrackingResult.fromMap({
          'version': 1,
          'found': true,
          'record': {
            'trackingCode': 'PK-AAA111',
            'service': 'parking',
            'stage': 'arrived',
            'parking': parking,
          },
        });

    Future<void> pumpTrack(
      WidgetTester tester,
      GuestTrackingResult result, {
      Locale locale = const Locale('en'),
    }) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final language = LanguageProvider()..setLanguage(locale.languageCode);
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: language,
          child: MaterialApp(
            theme: AppTheme.light,
            locale: locale,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Scaffold(
              body: SafeArea(
                child: GuestTrackingLookup(
                  service: _TrackService(result),
                  initialCode: 'PK-AAA111',
                  onSignIn: () {},
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    const owing = {
      'dailyRateCents': 1200,
      'sinceDayKey': '2026-10-27',
      'leftDayKey': '',
      'days': 3,
      'accruedCents': 3600,
      'paidCents': 2000,
      'balanceCents': 1600,
      'paidInFull': false,
      'stillParked': true,
    };

    testWidgets('English: rate, since, days, amount, paid, balance owed', (
      tester,
    ) async {
      await pumpTrack(tester, found(owing));
      expect(find.text('Parking balance'), findsOneWidget);
      expect(find.text('Daily rate'), findsOneWidget);
      expect(find.byKey(const Key('guest-parking-rate')), findsOneWidget);
      expect(
        tester.widget<Text>(find.byKey(const Key('guest-parking-rate'))).data,
        r'$12.00',
      );
      expect(find.text('Parked since'), findsOneWidget);
      expect(
        tester.widget<Text>(find.byKey(const Key('guest-parking-since'))).data,
        'Oct 27, 2026',
      );
      expect(find.text('Days so far'), findsOneWidget);
      expect(
        tester.widget<Text>(find.byKey(const Key('guest-parking-days'))).data,
        '3',
      );
      expect(find.text('Amount so far'), findsOneWidget);
      expect(
        tester.widget<Text>(find.byKey(const Key('guest-parking-amount'))).data,
        r'$36.00',
      );
      expect(
        tester.widget<Text>(find.byKey(const Key('guest-parking-paid'))).data,
        r'$20.00',
      );
      expect(find.text('Balance owed now'), findsOneWidget);
      expect(
        tester
            .widget<Text>(find.byKey(const Key('guest-parking-balance')))
            .data,
        r'$16.00',
      );
      expect(find.text('Paid in full'), findsNothing);
      expect(find.byKey(const Key('guest-parking-left')), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('English: paid in full replaces the balance', (tester) async {
      await pumpTrack(
        tester,
        found({
          ...owing,
          'paidCents': 3600,
          'balanceCents': 0,
          'paidInFull': true,
        }),
      );
      expect(find.text('Paid in full'), findsOneWidget);
      expect(find.byKey(const Key('guest-parking-balance')), findsNothing);
      expect(find.text('Balance owed now'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('English: a car that left shows its total and leave day', (
      tester,
    ) async {
      await pumpTrack(
        tester,
        found({...owing, 'leftDayKey': '2026-10-29', 'stillParked': false}),
      );
      expect(find.text('Left on'), findsOneWidget);
      expect(find.text('Days parked'), findsOneWidget);
      expect(find.text('Total amount'), findsOneWidget);
      expect(find.text('Balance owed'), findsOneWidget);
      expect(find.text('Days so far'), findsNothing);
    });

    testWidgets('French at 360 px, French money and dates', (tester) async {
      await pumpTrack(tester, found(owing), locale: const Locale('fr'));
      expect(find.text('Solde du parking'), findsOneWidget);
      expect(find.text('Tarif par jour'), findsOneWidget);
      expect(find.text('Garée depuis le'), findsOneWidget);
      expect(find.text('Jours jusqu\'ici'), findsOneWidget);
      expect(find.text('Montant jusqu\'ici'), findsOneWidget);
      expect(find.text('Payé'), findsOneWidget);
      expect(find.text('Solde dû maintenant'), findsOneWidget);
      expect(
        tester.widget<Text>(find.byKey(const Key('guest-parking-rate'))).data,
        formatLotCents(1200, language: 'fr'),
      );
      expect(
        tester
            .widget<Text>(find.byKey(const Key('guest-parking-balance')))
            .data,
        formatLotCents(1600, language: 'fr'),
      );
      expect(
        tester.widget<Text>(find.byKey(const Key('guest-parking-since'))).data,
        contains('27'),
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('French: paid in full at 360 px', (tester) async {
      await pumpTrack(
        tester,
        found({
          ...owing,
          'paidCents': 3600,
          'balanceCents': 0,
          'paidInFull': true,
        }),
        locale: const Locale('fr'),
      );
      expect(find.text('Payé en totalité'), findsOneWidget);
      expect(find.text('Solde dû maintenant'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    test('the wire is read defensively', () {
      expect(GuestTrackingParking.fromWire(null), isNull);
      expect(GuestTrackingParking.fromWire('x'), isNull);
      final p = GuestTrackingParking.fromWire({
        'dailyRateCents': -5,
        'sinceDayKey': 'garbage',
        'days': 'nope',
        'balanceCents': 700.4,
      })!;
      expect(p.dailyRateCents, 0);
      expect(p.sinceDayKey, '');
      expect(p.days, 0);
      expect(p.balanceCents, 700);
      expect(p.stillParked, isTrue);
      // Another service never carries a parking block.
      final other = GuestTrackingRecord.fromMap({
        'trackingCode': 'BS-1',
        'service': 'barrel',
        'stage': 'booked',
        'parking': {'balanceCents': 100},
      });
      expect(other.parking, isNull);
    });
  });

  group('the callable shapes', () {
    test('welcome preview groups cars by phone, tolerating junk', () {
      final list = parkingWelcomeRecipients({
        'recipients': [
          {
            'phone': '+1',
            'name': 'A',
            'cars': [
              {
                'id': 'c',
                'label': '2014 Toyota Corolla',
                'trackingCode': 'PK-1',
              },
            ],
            'alreadyWelcomed': true,
          },
          {'name': 'no phone'},
          'junk',
        ],
      });
      expect(list, hasLength(1));
      expect(list.single.alreadyWelcomed, isTrue);
      expect(list.single.carsText, '2014 Toyota Corolla');
      expect(parkingWelcomeRecipients(null), isEmpty);
    });

    test('send counts and refusal reasons', () {
      final r = ParkingWelcomeResult.fromWire({
        'sent': 3,
        'skipped': 1,
        'failed': 'x',
      });
      expect((r.sent, r.skipped, r.failed), (3, 1, 0));
      expect(
        parkingWhatsAppRefusal({'reason': 'parking_whatsapp_off'}),
        ParkingWhatsAppRefusal.switchOff,
      );
      expect(
        parkingWhatsAppRefusal({'reason': 'welcome_owner_only'}),
        ParkingWhatsAppRefusal.welcomeOwnerOnly,
      );
      expect(
        parkingWhatsAppRefusal({'reason': 'parking_whatsapp_owner_only'}),
        ParkingWhatsAppRefusal.switchOwnerOnly,
      );
      expect(parkingWhatsAppRefusal({'reason': 'other'}), isNull);
      expect(parkingWhatsAppRefusal(null), isNull);
    });
  });

  test('every new key has English and French with @ metadata in both', () {
    Map<String, dynamic> arb(String path) =>
        jsonDecode(File(path).readAsStringSync()) as Map<String, dynamic>;
    final en = arb('lib/l10n/app_en.arb');
    final fr = arb('lib/l10n/app_fr.arb');
    final mine = RegExp(
      r'^@?(parkingWa(Switch|Welcome|Err|Messages|Kind|Status)|parkingTrack)',
    );
    final keys = en.keys.where(mine.hasMatch);
    expect(keys.length, greaterThan(40));
    for (final key in keys.where((k) => !k.startsWith('@'))) {
      expect(fr[key], isA<String>(), reason: 'fr $key');
      expect((fr[key] as String).trim(), isNotEmpty);
      expect(en['@$key'], isA<Map>(), reason: 'en @$key');
      expect(fr['@$key'], isA<Map>(), reason: 'fr @$key');
    }
  });
}

class _HangingService extends _FakeService {
  @override
  Future<void> setEnabled({
    required String businessId,
    required bool enabled,
  }) => Completer<void>().future;
}

class _TrackService implements GuestTrackingLookupService {
  _TrackService(this.result);

  final GuestTrackingResult result;

  @override
  Future<GuestTrackingResult> lookup(String identifier) async => result;

  @override
  Future<String> claimQuoteRequest({
    required String trackingCode,
    required String email,
  }) async => 'request-id';
}
