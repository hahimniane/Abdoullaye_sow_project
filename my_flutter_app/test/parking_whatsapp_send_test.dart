import 'dart:async';
import 'dart:io';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/services/parking_whatsapp.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/parking_whatsapp_send_card.dart';

/// "Send on WhatsApp" on a parked car (docs/PARKING_LEFT_WHATSAPP.md §2-§4):
/// who is offered it, how the server's answers and refusals read, the
/// last-message line, and the phone-fix notice - in English and French.

class _FakeService implements ParkingWhatsAppService {
  final List<({String businessId, String carId})> sends = [];
  int statusReads = 0;
  ParkingWhatsAppLastStatus? last;
  Object? statusError;
  Object? sendError;
  ParkingWhatsAppSendResult sendResult = const ParkingWhatsAppSendResult(
    kind: ParkingMessageKind.parked,
    status: ParkingMessageStatus.sent,
  );
  Completer<ParkingWhatsAppSendResult>? sendGate;

  @override
  Future<ParkingWhatsAppSendResult> sendOnWhatsApp({
    required String businessId,
    required String carId,
  }) {
    sends.add((businessId: businessId, carId: carId));
    final error = sendError;
    if (error != null) return Future.error(error);
    return sendGate?.future ?? Future.value(sendResult);
  }

  @override
  Future<ParkingWhatsAppLastStatus?> lastStatus({
    required String businessId,
    required String carId,
  }) {
    statusReads += 1;
    final error = statusError;
    if (error != null) return Future.error(error);
    return Future.value(last);
  }

  @override
  Future<void> setEnabled({
    required String businessId,
    required bool enabled,
  }) => throw UnimplementedError();

  @override
  Future<List<ParkingWelcomeRecipient>> welcomePreview(String businessId) =>
      throw UnimplementedError();

  @override
  Future<ParkingWelcomeResult> welcomeSend({
    required String businessId,
    List<String>? phones,
  }) => throw UnimplementedError();

  @override
  Future<void> setPaymentInstructions({
    required String businessId,
    required String text,
  }) => throw UnimplementedError();

  @override
  Future<ParkingInvoicePreview> invoicesPreview({
    required String businessId,
    String? monthKey,
  }) => throw UnimplementedError();

  @override
  Future<ParkingInvoiceResult> invoicesSend({
    required String businessId,
    required String monthKey,
    List<String>? phones,
  }) => throw UnimplementedError();
}

FirebaseFunctionsException _refusal(String reason) =>
    FirebaseFunctionsException(
      message: 'refused',
      code: 'failed-precondition',
      details: <String, Object?>{'reason': reason},
    );

ParkingWhatsAppLastStatus _sentAt(DateTime at) => ParkingWhatsAppLastStatus(
  kind: ParkingMessageKind.parked,
  status: ParkingMessageStatus.sent,
  at: at,
);

Widget _card(
  _FakeService service, {
  bool switchOn = true,
  bool canSend = true,
  bool isBusinessEntry = true,
  bool isTeamCar = false,
  bool isVoided = false,
  int refresh = 0,
}) => ParkingWhatsAppSendCard(
  businessId: 'biz1',
  carId: 'car1',
  switchOn: switchOn,
  canSend: canSend,
  isBusinessEntry: isBusinessEntry,
  isTeamCar: isTeamCar,
  isVoided: isVoided,
  refresh: refresh,
  service: service,
);

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
  Size size = const Size(360, 800),
  double textScale = 1,
  bool fresh = true,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      builder: (context, app) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: app!,
      ),
      home: Scaffold(
        body: SafeArea(
          child: SingleChildScrollView(
            child: fresh ? KeyedSubtree(key: UniqueKey(), child: child) : child,
          ),
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
}

void main() {
  group('the refusals and answers', () {
    test('the four new refusals are named', () {
      ParkingWhatsAppRefusal? of(String reason) =>
          parkingWhatsAppRefusal(<String, Object?>{'reason': reason});
      expect(
        of('car_not_messageable'),
        ParkingWhatsAppRefusal.carNotMessageable,
      );
      expect(of('no_phone'), ParkingWhatsAppRefusal.noPhone);
      expect(of('needs_country_code'), ParkingWhatsAppRefusal.needsCountryCode);
      expect(of('send_limit'), ParkingWhatsAppRefusal.sendLimit);
      expect(of('parking_whatsapp_off'), ParkingWhatsAppRefusal.switchOff);
      expect(of('something_else'), isNull);
    });

    test('send_whatsapp is read defensively', () {
      final sent = ParkingWhatsAppSendResult.fromWire(<Object?, Object?>{
        'success': true,
        'kind': 'left',
        'status': 'sent',
        'error': '',
      });
      expect(sent.kind, ParkingMessageKind.left);
      expect(sent.sent, isTrue);

      final failed = ParkingWhatsAppSendResult.fromWire(<String, Object?>{
        'kind': 'parked',
        'status': 'failed',
        'error': ' Recipient not on WhatsApp ',
      });
      expect(failed.status, ParkingMessageStatus.failed);
      expect(failed.error, 'Recipient not on WhatsApp');
      expect(failed.sent, isFalse);

      // Garbage is never a success.
      final garbled = ParkingWhatsAppSendResult.fromWire('nonsense');
      expect(garbled.status, isNull);
      expect(garbled.sent, isFalse);
    });

    test('whatsapp_status reads the time and drops what it cannot read', () {
      final at = DateTime(2026, 11, 9, 14, 5);
      final last = ParkingWhatsAppLastStatus.fromWire(<String, Object?>{
        'kind': 'parked',
        'status': 'sent',
        'atMs': at.millisecondsSinceEpoch,
      });
      expect(last?.status, ParkingMessageStatus.sent);
      expect(last?.kind, ParkingMessageKind.parked);
      expect(last?.at, at);

      expect(ParkingWhatsAppLastStatus.fromWire(null), isNull);
      expect(ParkingWhatsAppLastStatus.fromWire(const {}), isNull);
      expect(
        ParkingWhatsAppLastStatus.fromWire(<String, Object?>{
          'status': 'mystery',
        }),
        isNull,
      );
    });

    test('a left message is a kind the list reads', () {
      final message = ParkingMessage.fromMap('c1_left_2026-11-09', {
        'kind': 'left',
        'status': 'sent',
      });
      expect(message?.kind, ParkingMessageKind.left);
    });
  });

  group('the last-message line', () {
    ParkingWhatsAppLine line(ParkingMessageStatus? status) =>
        parkingWhatsAppLineOf(
          status == null
              ? null
              : ParkingWhatsAppLastStatus(
                  kind: ParkingMessageKind.parked,
                  status: status,
                ),
        );

    test('every status has one reading', () {
      expect(line(null), ParkingWhatsAppLine.none);
      expect(line(ParkingMessageStatus.skipped), ParkingWhatsAppLine.none);
      expect(line(ParkingMessageStatus.queued), ParkingWhatsAppLine.queued);
      expect(line(ParkingMessageStatus.sent), ParkingWhatsAppLine.sent);
      expect(line(ParkingMessageStatus.failed), ParkingWhatsAppLine.failed);
      expect(line(ParkingMessageStatus.stopped), ParkingWhatsAppLine.stopped);
    });
  });

  group('who is offered the button', () {
    bool offered({
      bool switchOn = true,
      bool canSend = true,
      bool isBusinessEntry = true,
      bool isTeamCar = false,
      bool isVoided = false,
    }) => parkingWhatsAppSendOffered(
      switchOn: switchOn,
      canSend: canSend,
      isBusinessEntry: isBusinessEntry,
      isTeamCar: isTeamCar,
      isVoided: isVoided,
    );

    test('only a messageable car, with the switch on, for parking staff', () {
      expect(offered(), isTrue);
      expect(offered(switchOn: false), isFalse);
      expect(offered(canSend: false), isFalse);
      expect(offered(isBusinessEntry: false), isFalse);
      expect(offered(isTeamCar: true), isFalse);
      expect(offered(isVoided: true), isFalse);
    });

    test('a changed phone resends only where the server will', () {
      bool resends(
        Map<String, dynamic> changes, {
        bool switchOn = true,
        bool isTeamCar = false,
        bool isVoided = false,
      }) => parkingPhoneEditResends(
        changes: changes,
        switchOn: switchOn,
        isTeamCar: isTeamCar,
        isVoided: isVoided,
      );
      expect(resends({'customerPhone': '+13475550101'}), isTrue);
      expect(resends({'carMake': 'Toyota'}), isFalse);
      // Clearing the number sends nothing.
      expect(resends({'customerPhone': '  '}), isFalse);
      expect(resends({'customerPhone': '+1347'}, switchOn: false), isFalse);
      expect(resends({'customerPhone': '+1347'}, isTeamCar: true), isFalse);
      expect(resends({'customerPhone': '+1347'}, isVoided: true), isFalse);
    });
  });

  group('the card', () {
    testWidgets('is hidden, and silent, when it is not offered', (
      tester,
    ) async {
      for (final card in [
        (service) => _card(service, switchOn: false),
        (service) => _card(service, canSend: false),
        (service) => _card(service, isBusinessEntry: false),
        (service) => _card(service, isTeamCar: true),
        (service) => _card(service, isVoided: true),
      ]) {
        final service = _FakeService();
        await _pump(tester, card(service));
        expect(find.byKey(const Key('parking-whatsapp-send')), findsNothing);
        expect(find.text('Send on WhatsApp'), findsNothing);
        expect(service.statusReads, 0);
        expect(service.sends, isEmpty);
      }
    });

    testWidgets('shows the last message with a US date and sends', (
      tester,
    ) async {
      final service = _FakeService()
        ..last = _sentAt(DateTime(2026, 11, 9, 14, 5));
      await _pump(tester, _card(service));

      expect(find.text('Send on WhatsApp'), findsOneWidget);
      expect(find.textContaining('WhatsApp: sent Nov 9, 2026'), findsOneWidget);
      expect(find.textContaining('2:05'), findsOneWidget);
      expect(find.textContaining('PM'), findsOneWidget);
      expect(service.statusReads, 1);

      // The loading state holds the button until the server answers.
      service.sendGate = Completer<ParkingWhatsAppSendResult>();
      await tester.tap(find.byKey(const Key('parking-whatsapp-send-button')));
      await tester.pump();
      expect(find.text('Sending…'), findsOneWidget);
      expect(service.sends, hasLength(1));
      await tester.tap(
        find.byKey(const Key('parking-whatsapp-send-button')),
        warnIfMissed: false,
      );
      await tester.pump();
      expect(service.sends, hasLength(1));

      service.sendGate!.complete(
        const ParkingWhatsAppSendResult(
          kind: ParkingMessageKind.parked,
          status: ParkingMessageStatus.sent,
        ),
      );
      await tester.pump();
      await tester.pump();
      expect(find.text('Sent on WhatsApp.'), findsOneWidget);
      expect(find.text('Send on WhatsApp'), findsOneWidget);
      expect(service.sends.single, (businessId: 'biz1', carId: 'car1'));
      // The line is read again, since a row was written.
      expect(service.statusReads, 2);
    });

    testWidgets('says what Meta said when the message failed', (tester) async {
      final service = _FakeService()
        ..sendResult = const ParkingWhatsAppSendResult(
          kind: ParkingMessageKind.left,
          status: ParkingMessageStatus.failed,
          error: 'Recipient phone number not in allowed list',
        );
      await _pump(tester, _card(service));
      await tester.tap(find.byKey(const Key('parking-whatsapp-send-button')));
      await tester.pump();
      await tester.pump();

      expect(
        find.text('WhatsApp could not deliver the message. Check the number.'),
        findsOneWidget,
      );
      expect(
        find.text('Recipient phone number not in allowed list'),
        findsOneWidget,
      );
      expect(find.text('Sent on WhatsApp.'), findsNothing);
      expect(service.statusReads, 2);
    });

    testWidgets('a customer who said STOP is told so', (tester) async {
      final service = _FakeService()
        ..sendResult = const ParkingWhatsAppSendResult(
          kind: ParkingMessageKind.parked,
          status: ParkingMessageStatus.stopped,
        );
      await _pump(tester, _card(service));
      await tester.tap(find.byKey(const Key('parking-whatsapp-send-button')));
      await tester.pump();
      await tester.pump();
      expect(
        find.text('This customer has stopped WhatsApp messages.'),
        findsOneWidget,
      );
    });

    testWidgets('each refusal reads in words and writes nothing', (
      tester,
    ) async {
      final cases = {
        'parking_whatsapp_off':
            'WhatsApp messages are switched off for this business.',
        'car_not_messageable':
            "This car's customer can't be messaged (a team member's car, a "
            'voided car, or an online booking).',
        'no_phone': "Add the customer's WhatsApp number first.",
        'needs_country_code': 'Add the country code to the number.',
        'send_limit':
            "This car's message was sent 5 times today. Try again tomorrow.",
      };
      for (final entry in cases.entries) {
        final service = _FakeService()..sendError = _refusal(entry.key);
        await _pump(tester, _card(service));
        await tester.tap(find.byKey(const Key('parking-whatsapp-send-button')));
        await tester.pump();
        await tester.pump();
        expect(find.text(entry.value), findsOneWidget, reason: entry.key);
        // Nothing was written, so the line is not read again.
        expect(service.statusReads, 1, reason: entry.key);
      }
    });

    testWidgets('an unknown failure is generic, never a success', (
      tester,
    ) async {
      final service = _FakeService()..sendError = StateError('boom');
      await _pump(tester, _card(service));
      await tester.tap(find.byKey(const Key('parking-whatsapp-send-button')));
      await tester.pump();
      await tester.pump();
      expect(
        find.text('Could not send the message. Try again.'),
        findsOneWidget,
      );
      expect(find.text('Sent on WhatsApp.'), findsNothing);

      // An answer the app cannot read is the same.
      final garbled = _FakeService()
        ..sendResult = const ParkingWhatsAppSendResult(
          kind: null,
          status: null,
        );
      await _pump(tester, _card(garbled));
      await tester.tap(find.byKey(const Key('parking-whatsapp-send-button')));
      await tester.pump();
      await tester.pump();
      expect(
        find.text('Could not send the message. Try again.'),
        findsOneWidget,
      );
    });

    testWidgets('lines for failed, stopped, queued and nothing yet', (
      tester,
    ) async {
      final lines = <ParkingWhatsAppLastStatus?, String>{
        const ParkingWhatsAppLastStatus(
          kind: ParkingMessageKind.parked,
          status: ParkingMessageStatus.failed,
        ): 'WhatsApp: not delivered. Check the number.',
        const ParkingWhatsAppLastStatus(
          kind: ParkingMessageKind.parked,
          status: ParkingMessageStatus.stopped,
        ): 'WhatsApp: the customer stopped messages.',
        const ParkingWhatsAppLastStatus(
          kind: ParkingMessageKind.parked,
          status: ParkingMessageStatus.queued,
        ): 'WhatsApp: sending…',
        null: 'WhatsApp: nothing sent yet.',
      };
      for (final entry in lines.entries) {
        final service = _FakeService()..last = entry.key;
        await _pump(tester, _card(service));
        expect(find.text(entry.value), findsOneWidget);
      }
    });

    testWidgets('a failed status read leaves the line out, not the button', (
      tester,
    ) async {
      final service = _FakeService()..statusError = StateError('denied');
      await _pump(tester, _card(service));
      expect(find.byKey(const Key('parking-whatsapp-last')), findsNothing);
      expect(find.text('Send on WhatsApp'), findsOneWidget);
    });

    testWidgets('reads the line again when asked, and when the switch flips', (
      tester,
    ) async {
      final service = _FakeService();
      await _pump(tester, _card(service, switchOn: false), fresh: false);
      expect(service.statusReads, 0);

      await _pump(tester, _card(service), fresh: false);
      expect(service.statusReads, 1);

      await _pump(tester, _card(service, refresh: 1), fresh: false);
      expect(service.statusReads, 2);
    });

    testWidgets('French, at a narrow phone and large text, fits', (
      tester,
    ) async {
      final service = _FakeService()
        ..last = _sentAt(DateTime(2026, 11, 9, 14, 5))
        ..sendError = _refusal('car_not_messageable');
      await _pump(
        tester,
        _card(service),
        locale: const Locale('fr'),
        size: const Size(320, 640),
        textScale: 1.5,
      );
      expect(find.text('Envoyer sur WhatsApp'), findsOneWidget);
      expect(
        find.textContaining('WhatsApp : envoyé le 9 nov. 2026'),
        findsOneWidget,
      );
      expect(find.textContaining('PM'), findsNothing);

      await tester.tap(find.byKey(const Key('parking-whatsapp-send-button')));
      await tester.pump();
      await tester.pump();
      expect(
        find.text(
          "Le client de cette voiture ne peut pas être contacté (voiture d'un "
          'membre de l\'équipe, voiture annulée ou réservation en ligne).',
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('French results and lines', (tester) async {
      final cases = {
        'no_phone': "Ajoutez d'abord le numéro WhatsApp du client.",
        'needs_country_code': "Ajoutez l'indicatif du pays au numéro.",
        'send_limit':
            "Le message de cette voiture a été envoyé 5 fois aujourd'hui. "
            'Réessayez demain.',
      };
      for (final entry in cases.entries) {
        final service = _FakeService()..sendError = _refusal(entry.key);
        await _pump(tester, _card(service), locale: const Locale('fr'));
        await tester.tap(find.byKey(const Key('parking-whatsapp-send-button')));
        await tester.pump();
        await tester.pump();
        expect(find.text(entry.value), findsOneWidget, reason: entry.key);
      }

      final sent = _FakeService();
      await _pump(tester, _card(sent), locale: const Locale('fr'));
      await tester.tap(find.byKey(const Key('parking-whatsapp-send-button')));
      await tester.pump();
      await tester.pump();
      expect(find.text('Envoyé sur WhatsApp.'), findsOneWidget);

      final failed = _FakeService()
        ..last = const ParkingWhatsAppLastStatus(
          kind: ParkingMessageKind.parked,
          status: ParkingMessageStatus.failed,
        );
      await _pump(tester, _card(failed), locale: const Locale('fr'));
      expect(
        find.text('WhatsApp : non distribué. Vérifiez le numéro.'),
        findsOneWidget,
      );
    });
  });

  group('the details screen', () {
    final source = File(
      'lib/screens/parked_car_details_screen.dart',
    ).readAsStringSync();

    test('mounts the card behind the parking permission and the switch', () {
      expect(source, contains('ParkingWhatsAppSendCard('));
      expect(source, contains('canSend: canRecordPayment'));
      expect(source, contains('switchOn: _whatsAppOn'));
      expect(source, contains('isVoided: isVoided'));
      expect(source, contains('parkingWhatsAppEnabledStream('));
    });

    test('a saved phone change says the last message will be resent', () {
      expect(source, contains('parkingPhoneEditResends('));
      expect(source, contains('l10n.parkingWaPhoneResent'));
    });

    test('the notice is in both languages', () {
      final en = File('lib/l10n/app_en.arb').readAsStringSync();
      final fr = File('lib/l10n/app_fr.arb').readAsStringSync();
      for (final text in [
        'Saved. The last message will be resent to the new number.',
        'Send on WhatsApp',
      ]) {
        expect(en, contains(text));
      }
      for (final text in [
        'Enregistré. Le dernier message sera renvoyé au nouveau numéro.',
        'Envoyer sur WhatsApp',
      ]) {
        expect(fr, contains(text));
      }
    });
  });
}
