import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/l10n/app_localizations_en.dart';
import 'package:my_flutter_app/l10n/app_localizations_fr.dart';
import 'package:my_flutter_app/screens/containers_screen.dart';
import 'package:my_flutter_app/screens/package_result_screen.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/theme/app_theme.dart';

/// "Send current status on WhatsApp" on a container, and what each person's
/// WhatsApp update is doing on the package view - including the send
/// queue's in-between states.

FirebaseFunctionsException _refusal(String reason) {
  // ignore: invalid_use_of_protected_member
  return FirebaseFunctionsException(
    code: 'failed-precondition',
    message: 'refused',
    details: {'reason': reason},
  );
}

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
}) async {
  tester.view.physicalSize = const Size(400, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: Scaffold(body: SafeArea(child: child)),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _tapAndConfirm(WidgetTester tester, String confirmLabel) async {
  await tester.tap(find.byKey(const Key('container-send-status')));
  await tester.pumpAndSettle();
  await tester.tap(find.widgetWithText(FilledButton, confirmLabel));
  await tester.pumpAndSettle();
}

ContainerLine _line(List<Map<String, Object?>> results) =>
    ContainerLine.fromMap('l1', {
      'businessId': 'b1',
      'containerId': 'c1',
      'containerStatus': containerStatusShipped,
      'kind': containerLineKindBarrels,
      'quantity': 1,
      'ownerKind': containerOwnerCustomer,
      'customerName': 'Fatou Diallo',
      'customerPhone': '+19175551234',
      'receiverName': 'Mariama Bah',
      'receiverPhone': '+224621234567',
      'trackingCode': 'CL-K7M4P2',
      'lastCustomerUpdate': {
        'update': containerUpdateShipped,
        'results': results,
      },
    });

void main() {
  group('the callable answer', () {
    test('reads the tally, never a negative or a fraction', () {
      final r = ContainerCurrentStatusResult.fromCallable({
        'success': true,
        'update': 'at_port',
        'queued': 3,
        'alreadySent': 2.0,
        'inFlight': -1,
        'skipped': 'x',
        'waiting': 1,
      });
      expect(r.update, 'at_port');
      expect(r.queued, 3);
      expect(r.alreadySent, 2);
      expect(r.inFlight, 0);
      expect(r.skipped, 0);
      expect(r.waiting, 1);
      final empty = ContainerCurrentStatusResult.fromCallable(null);
      expect(empty.update, '');
      expect(empty.queued, 0);
    });

    test('a refusal names its reason, or none', () {
      expect(
        containerStatusRefusalReason({'reason': 'whatsapp_not_configured'}),
        containerStatusRefusalNotConfigured,
      );
      expect(
        containerStatusRefusalReason({'reason': 'no_customer_update'}),
        containerStatusRefusalNoUpdate,
      );
      expect(containerStatusRefusalReason(null), '');
      expect(containerStatusRefusalReason('whatsapp_not_configured'), '');
    });

    test('the summary says who was messaged, who had it, who cannot be '
        'reached - in English and French', () {
      const result = ContainerCurrentStatusResult(
        update: containerUpdateArrived,
        queued: 2,
        alreadySent: 1,
        skipped: 1,
      );
      expect(
        containerSendStatusSummary(AppLocalizationsEn(), result),
        'Sending “arrived” to 2 people on WhatsApp. 1 person already had it. '
        '1 person can’t be reached (no phone, updates off, or no country '
        'code).',
      );
      final fr = containerSendStatusSummary(AppLocalizationsFr(), result);
      expect(fr, startsWith('Envoi de « arrivé » à 2 personnes'));
      expect(fr, contains('1 personne l’avait déjà.'));
    });

    test('nothing new to send says so; messages on their way say so', () {
      final en = AppLocalizationsEn();
      expect(
        containerSendStatusSummary(
          en,
          const ContainerCurrentStatusResult(update: 'shipped', alreadySent: 4),
        ),
        'Everyone who can be reached already has the latest update. '
        '4 people already had it.',
      );
      expect(
        containerSendStatusSummary(
          en,
          const ContainerCurrentStatusResult(update: 'shipped', inFlight: 1),
        ),
        '1 message is already on its way.',
      );
    });
  });

  group('send current status', () {
    testWidgets('asks first, sends the container, and says what happened',
        (tester) async {
      final calls = <Map<String, Object?>>[];
      final busy = <bool>[];
      await _pump(
        tester,
        ContainerSendStatusAction(
          businessId: 'b1',
          containerId: 'c1',
          onBusyChanged: busy.add,
          send: (payload) async {
            calls.add(payload);
            return {'update': 'shipped', 'queued': 1};
          },
        ),
      );
      expect(find.text('Send current status on WhatsApp'), findsOneWidget);

      // Cancelling sends nothing.
      await tester.tap(find.byKey(const Key('container-send-status')));
      await tester.pumpAndSettle();
      expect(find.text('Send the current status?'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(calls, isEmpty);

      await _tapAndConfirm(tester, 'Send');
      expect(calls, [
        {'businessId': 'b1', 'containerId': 'c1'},
      ]);
      expect(busy, [true, false]);
      expect(
        find.text('Sending “left port” to 1 person on WhatsApp.'),
        findsOneWidget,
      );
    });

    testWidgets('WhatsApp not connected: a plain explanation, not an error code',
        (tester) async {
      await _pump(
        tester,
        ContainerSendStatusAction(
          businessId: 'b1',
          containerId: 'c1',
          send: (_) async => throw _refusal('whatsapp_not_configured'),
        ),
      );
      await _tapAndConfirm(tester, 'Send');
      expect(find.byKey(const Key('container-whatsapp-not-connected')),
          findsOneWidget);
      expect(find.text('WhatsApp isn’t connected yet'), findsOneWidget);
      expect(find.textContaining('Nothing was sent.'), findsOneWidget);
      await tester.tap(find.text('Close'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('container-whatsapp-not-connected')),
          findsNothing);
      // The button is usable again.
      final button = tester.widget<ContainerActionButton>(
          find.byKey(const Key('container-send-status')));
      expect(button.enabled, isTrue);
      expect(button.busy, isFalse);
    });

    testWidgets('in French too', (tester) async {
      await _pump(
        tester,
        ContainerSendStatusAction(
          businessId: 'b1',
          containerId: 'c1',
          send: (_) async => throw _refusal('whatsapp_not_configured'),
        ),
        locale: const Locale('fr'),
      );
      expect(find.text('Envoyer le statut actuel sur WhatsApp'), findsOneWidget);
      await _tapAndConfirm(tester, 'Envoyer');
      expect(find.text('WhatsApp n’est pas encore connecté'), findsOneWidget);
    });

    testWidgets('no news yet says so', (tester) async {
      await _pump(
        tester,
        ContainerSendStatusAction(
          businessId: 'b1',
          containerId: 'c1',
          send: (_) async => throw _refusal('no_customer_update'),
        ),
      );
      await _tapAndConfirm(tester, 'Send');
      expect(
        find.text('This container has no news for customers yet. '
            'They hear when it ships.'),
        findsOneWidget,
      );
    });

    testWidgets('disabled while another container action runs',
        (tester) async {
      await _pump(
        tester,
        ContainerSendStatusAction(
          businessId: 'b1',
          containerId: 'c1',
          enabled: false,
          send: (_) async => fail('must not send'),
        ),
      );
      final button = tester.widget<ContainerActionButton>(
          find.byKey(const Key('container-send-status')));
      expect(button.enabled, isFalse);
    });
  });

  group('package view: each person\'s WhatsApp update', () {
    testWidgets('queued, sending, retrying, sent, failed and waiting all read '
        'as words', (tester) async {
      await _pump(
        tester,
        packageResultViewForTesting(
          line: _line([
            {'role': 'sender', 'status': 'queued'},
            {'role': 'receiver', 'status': 'sending'},
          ]),
        ),
      );
      expect(find.text('Customer: queued to send'), findsOneWidget);
      expect(find.text('Receiver: sending'), findsOneWidget);
      expect(find.text('Last update: left port'), findsOneWidget);

      await _pump(
        tester,
        packageResultViewForTesting(
          line: _line([
            {'role': 'sender', 'status': 'retrying'},
            {'role': 'receiver', 'status': 'waiting_for_whatsapp'},
          ]),
        ),
      );
      expect(find.text('Customer: retrying after a failed try'), findsOneWidget);
      expect(find.text('Receiver: waiting for WhatsApp to be connected'),
          findsOneWidget);

      await _pump(
        tester,
        packageResultViewForTesting(
          line: _line([
            {'role': 'sender', 'status': 'sent'},
            {'role': 'receiver', 'status': 'failed'},
          ]),
        ),
      );
      expect(find.text('Customer: sent'), findsOneWidget);
      expect(find.text('Receiver: failed to send'), findsOneWidget);
    });

    testWidgets('the queue states read in French', (tester) async {
      await _pump(
        tester,
        packageResultViewForTesting(
          line: _line([
            {'role': 'sender', 'status': 'queued'},
            {'role': 'receiver', 'status': 'retrying'},
          ]),
        ),
        locale: const Locale('fr'),
      );
      expect(find.textContaining('en file d’attente'), findsOneWidget);
      expect(find.textContaining('nouvel essai après un échec'), findsOneWidget);
    });
  });
}
