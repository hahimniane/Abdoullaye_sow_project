import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/providers/language_provider.dart';
import 'package:my_flutter_app/screens/parking_month_end_screen.dart';
import 'package:my_flutter_app/services/parking_month_statement.dart';
import 'package:my_flutter_app/services/parking_whatsapp.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/parking_invoices_card.dart';
import 'package:my_flutter_app/widgets/parking_payment_instructions_field.dart';
import 'package:provider/provider.dart';

/// Monthly parking invoices on WhatsApp, app side
/// (docs/PARKING_INVOICES.md §3): the Payment instructions field in business
/// settings, the Send invoices card on Month end with its preview and send,
/// and each customer's invoice status - in English and French on a 360 px
/// phone.

class _Fake implements ParkingWhatsAppService {
  final List<({String businessId, String text})> saves = [];
  final List<({String businessId, String monthKey, List<String>? phones})>
  sends = [];
  final List<String?> previewMonths = [];
  Object? saveError;
  Object? previewError;
  Object? sendError;
  Completer<ParkingInvoicePreview>? previewGate;
  Completer<void>? saveGate;
  ParkingInvoicePreview preview = const ParkingInvoicePreview(
    monthKey: '2026-09',
    run: null,
    recipients: [],
  );
  List<ParkingInvoiceResult> results = [const ParkingInvoiceResult(sent: 2)];

  @override
  Future<void> setPaymentInstructions({
    required String businessId,
    required String text,
  }) async {
    saves.add((businessId: businessId, text: text));
    await saveGate?.future;
    final error = saveError;
    if (error != null) throw error;
  }

  @override
  Future<ParkingInvoicePreview> invoicesPreview({
    required String businessId,
    String? monthKey,
  }) {
    previewMonths.add(monthKey);
    final error = previewError;
    if (error != null) return Future.error(error);
    return previewGate?.future ?? Future.value(preview);
  }

  @override
  Future<ParkingInvoiceResult> invoicesSend({
    required String businessId,
    required String monthKey,
    List<String>? phones,
  }) async {
    sends.add((businessId: businessId, monthKey: monthKey, phones: phones));
    final error = sendError;
    if (error != null) throw error;
    return results.length > 1 ? results.removeAt(0) : results.first;
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
          body: SafeArea(child: SingleChildScrollView(child: child)),
        ),
      ),
    ),
  );
  await tester.pump();
}

const _awa = ParkingInvoiceRecipient(
  phone: '+13475550101',
  name: 'Awa Diallo',
  cars: [
    ParkingWelcomeCar(id: 'c1', label: '2014 Toyota Corolla', trackingCode: ''),
    ParkingWelcomeCar(id: 'c2', label: '2016 Toyota RAV4', trackingCode: ''),
  ],
  totalDueCents: 45000,
  stillParked: true,
  alreadySent: false,
);
const _moussa = ParkingInvoiceRecipient(
  phone: '+13475550102',
  name: 'Moussa Ba',
  cars: [
    ParkingWelcomeCar(id: 'c3', label: '2012 Honda Civic', trackingCode: ''),
  ],
  totalDueCents: 0,
  stillParked: true,
  alreadySent: false,
);
const _fatou = ParkingInvoiceRecipient(
  phone: '+13475550103',
  name: 'Fatou Sow',
  cars: [
    ParkingWelcomeCar(id: 'c4', label: '2010 Nissan Altima', trackingCode: ''),
  ],
  totalDueCents: 12000,
  stillParked: false,
  alreadySent: true,
);

ParkingInvoicePreview _preview(List<ParkingInvoiceRecipient> recipients) =>
    ParkingInvoicePreview(
      monthKey: '2026-09',
      run: ParkingInvoiceRun.fromWire({'status': 'ready'}),
      recipients: recipients,
    );

Widget _card({
  required _Fake service,
  Stream<ParkingInvoiceRun?>? run,
  bool switchOn = true,
  bool canSend = true,
  String monthKey = '2026-09',
  Map<String, String> staffNames = const {},
  Duration timeout = const Duration(seconds: 30),
}) => ParkingInvoicesCard(
  businessId: 'biz1',
  monthKey: monthKey,
  currentMonthKey: '2026-09',
  switchOn: switchOn,
  canSend: canSend,
  staffNames: staffNames,
  service: service,
  runStream: (_) => run ?? const Stream<ParkingInvoiceRun?>.empty(),
  timeout: timeout,
);

void main() {
  group('server shapes', () {
    test('the preview is read as the server sends it', () {
      final preview = ParkingInvoicePreview.fromWire({
        'monthKey': '2026-09',
        'run': {
          'status': 'sent',
          'preparedAtMs': 1790000000000,
          'sentAtMs': 1790100000000,
          'sentBy': 'auto',
          'recipients': 3,
          'totalDueCents': 57000,
          'sent': 2,
          'failed': 1,
          'skipped': 0,
        },
        'recipients': [
          {
            'phone': '+13475550101',
            'name': 'Awa Diallo',
            'cars': [
              {'id': 'c1', 'label': '2014 Toyota Corolla'},
            ],
            'totalDueCents': 45000,
            'stillParked': true,
            'alreadySent': false,
          },
          {'phone': '', 'name': 'No phone'},
          'junk',
        ],
      });
      expect(preview.monthKey, '2026-09');
      expect(preview.run?.status, ParkingInvoiceRunStatus.sent);
      expect(preview.run?.sentAutomatically, isTrue);
      expect(preview.run?.sent, 2);
      expect(preview.run?.failed, 1);
      expect(preview.run?.totalDueCents, 57000);
      expect(preview.run?.sentAt, isNotNull);
      expect(preview.recipients, hasLength(1));
      expect(preview.recipients.single.carsText, '2014 Toyota Corolla');
      expect(preview.recipients.single.totalDueCents, 45000);
      expect(preview.recipients.single.stillParked, isTrue);
    });

    test(
      'a month with no run, or nonsense, reads as nothing - never a crash',
      () {
        final preview = ParkingInvoicePreview.fromWire({
          'monthKey': '2026-09',
          'run': null,
          'recipients': 'x',
        });
        expect(preview.run, isNull);
        expect(preview.recipients, isEmpty);
        expect(ParkingInvoicePreview.fromWire(null).recipients, isEmpty);
        expect(ParkingInvoiceRun.fromWire({'status': 'weird'}), isNull);
        final result = ParkingInvoiceResult.fromWire({
          'sent': 3,
          'failed': -1,
          'skipped': 'x',
          'remaining': 5,
        });
        expect(
          (result.sent, result.failed, result.skipped, result.remaining),
          (3, 0, 0, 5),
        );
      },
    );

    test('the three new refusals are recognised', () {
      ParkingWhatsAppRefusal? of(String reason) =>
          parkingWhatsAppRefusal({'reason': reason});
      expect(
        of('invoices_owner_only'),
        ParkingWhatsAppRefusal.invoicesOwnerOnly,
      );
      expect(
        of('invoice_month_invalid'),
        ParkingWhatsAppRefusal.invoiceMonthInvalid,
      );
      expect(
        of('payment_instructions_invalid'),
        ParkingWhatsAppRefusal.paymentInstructionsInvalid,
      );
      expect(of('parking_whatsapp_off'), ParkingWhatsAppRefusal.switchOff);
    });

    test(
      'the card is offered only to the owner, switch on, month just ended',
      () {
        bool offered({
          bool on = true,
          bool owner = true,
          String month = '2026-09',
        }) => parkingInvoicesOffered(
          switchOn: on,
          canSend: owner,
          monthKey: month,
          currentMonthKey: '2026-09',
        );
        expect(offered(), isTrue);
        expect(offered(on: false), isFalse);
        expect(offered(owner: false), isFalse);
        expect(offered(month: '2026-08'), isFalse);
        expect(offered(month: '2026-10'), isFalse);
      },
    );

    test('invoice rows are matched to customers by the last ten digits', () {
      final rows = [
        for (final r in [
          (
            'invoice_biz1_2026-09_16465550103',
            'invoice',
            '+16465550103',
            'sent',
            'delivered',
            1000,
          ),
          (
            'invoice_biz1_2026-09_older',
            'invoice',
            '+16465550103',
            'failed',
            '',
            500,
          ),
          ('x', 'receipt', '+16465550104', 'sent', '', 2000),
          ('y', 'invoice', '', 'sent', '', 3000),
        ])
          ParkingMessage.fromMap(r.$1, {
            'kind': r.$2,
            'phone': r.$3,
            'status': r.$4,
            'deliveryStatus': r.$5,
            'monthKey': '2026-09',
            'sentAt': r.$6,
          })!,
      ];
      final byCustomer = parkingInvoiceStatusByCustomer(rows);
      expect(byCustomer.keys, ['phone:6465550103']);
      expect(byCustomer['phone:6465550103']!.deliveryStatus, 'delivered');
      expect(byCustomer['phone:6465550103']!.monthKey, '2026-09');
    });
  });

  group('payment instructions field', () {
    testWidgets('is hidden for staff', (tester) async {
      await _pump(
        tester,
        ParkingPaymentInstructionsField(
          businessId: 'biz1',
          saved: 'Pay at the office',
          canEdit: false,
          service: _Fake(),
        ),
      );
      expect(
        find.byKey(const Key('parking-payment-instructions')),
        findsNothing,
      );
    });

    testWidgets('the owner edits and saves; the text goes up trimmed', (
      tester,
    ) async {
      final service = _Fake();
      await _pump(
        tester,
        ParkingPaymentInstructionsField(
          businessId: 'biz1',
          saved: 'Pay at the office',
          canEdit: true,
          service: service,
        ),
      );
      expect(find.text('Pay at the office'), findsOneWidget);
      FilledButton save() => tester.widget<FilledButton>(
        find.byKey(const Key('parking-payment-instructions-save')),
      );
      expect(save().onPressed, isNull, reason: 'nothing to save yet');

      await tester.enterText(
        find.byKey(const Key('parking-payment-instructions')),
        '  Zelle 347-555-0100 (Keren Auto Sales)  ',
      );
      await tester.pump();
      expect(save().onPressed, isNotNull);

      await tester.tap(
        find.byKey(const Key('parking-payment-instructions-save')),
      );
      await tester.pumpAndSettle();

      expect(service.saves, [
        (businessId: 'biz1', text: 'Zelle 347-555-0100 (Keren Auto Sales)'),
      ]);
      expect(find.text('Payment instructions saved.'), findsOneWidget);
      expect(save().onPressed, isNull, reason: 'saved, nothing new to save');
    });

    testWidgets('clearing the text is a save of the empty string', (
      tester,
    ) async {
      final service = _Fake();
      await _pump(
        tester,
        ParkingPaymentInstructionsField(
          businessId: 'biz1',
          saved: 'Pay at the office',
          canEdit: true,
          service: service,
        ),
      );
      await tester.enterText(
        find.byKey(const Key('parking-payment-instructions')),
        '',
      );
      await tester.pump();
      await tester.tap(
        find.byKey(const Key('parking-payment-instructions-save')),
      );
      await tester.pumpAndSettle();
      expect(service.saves.single.text, '');
    });

    testWidgets('the field stops at 300 characters', (tester) async {
      await _pump(
        tester,
        ParkingPaymentInstructionsField(
          businessId: 'biz1',
          saved: '',
          canEdit: true,
          service: _Fake(),
        ),
      );
      await tester.enterText(
        find.byKey(const Key('parking-payment-instructions')),
        'x' * 400,
      );
      await tester.pump();
      final field = tester.widget<TextField>(
        find.byKey(const Key('parking-payment-instructions')),
      );
      expect(
        field.controller!.text.length,
        parkingPaymentInstructionsMaxLength,
      );
    });

    testWidgets('a refusal is explained, in French too, and the draft stays', (
      tester,
    ) async {
      final service = _Fake()
        ..saveError = _refusal('payment_instructions_invalid');
      await _pump(
        tester,
        ParkingPaymentInstructionsField(
          businessId: 'biz1',
          saved: '',
          canEdit: true,
          service: service,
        ),
        locale: const Locale('fr'),
      );
      expect(find.text('Instructions de paiement'), findsOneWidget);
      await tester.enterText(
        find.byKey(const Key('parking-payment-instructions')),
        'Payez au bureau',
      );
      await tester.pump();
      await tester.tap(
        find.byKey(const Key('parking-payment-instructions-save')),
      );
      await tester.pumpAndSettle();
      expect(
        find.text(
          'Les instructions de paiement ne peuvent pas dépasser 300 caractères.',
        ),
        findsOneWidget,
      );
      expect(find.text('Payez au bureau'), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const Key('parking-payment-instructions-save')),
            )
            .onPressed,
        isNotNull,
        reason: 'still unsaved, so it can be retried',
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('a save that never answers resolves by timeout', (
      tester,
    ) async {
      final service = _Fake()..saveGate = Completer<void>();
      await _pump(
        tester,
        ParkingPaymentInstructionsField(
          businessId: 'biz1',
          saved: '',
          canEdit: true,
          service: service,
          timeout: const Duration(seconds: 2),
        ),
      );
      await tester.enterText(
        find.byKey(const Key('parking-payment-instructions')),
        'Zelle',
      );
      await tester.pump();
      await tester.tap(
        find.byKey(const Key('parking-payment-instructions-save')),
      );
      await tester.pump();
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const Key('parking-payment-instructions-save')),
            )
            .onPressed,
        isNull,
        reason: 'no double submit while saving',
      );
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();
      expect(
        find.text('Could not save the payment instructions. Try again.'),
        findsOneWidget,
      );
      expect(service.saves, hasLength(1));
    });

    testWidgets('follows the business record unless the owner is mid-edit', (
      tester,
    ) async {
      final service = _Fake();
      Widget field(String saved) => ParkingPaymentInstructionsField(
        businessId: 'biz1',
        saved: saved,
        canEdit: true,
        service: service,
      );
      await _pump(tester, field('One'));
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: LanguageProvider(),
          child: MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Scaffold(body: SingleChildScrollView(child: field('Two'))),
          ),
        ),
      );
      await tester.pump();
      expect(find.text('Two'), findsOneWidget);

      await tester.enterText(
        find.byKey(const Key('parking-payment-instructions')),
        'My draft',
      );
      await tester.pump();
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: LanguageProvider(),
          child: MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Scaffold(body: SingleChildScrollView(child: field('Three'))),
          ),
        ),
      );
      await tester.pump();
      expect(find.text('My draft'), findsOneWidget);
      expect(find.text('Three'), findsNothing);
    });
  });

  group('the Send invoices card', () {
    testWidgets('shows only with the switch on, for the owner, that month', (
      tester,
    ) async {
      Future<void> check({
        bool switchOn = true,
        bool canSend = true,
        String monthKey = '2026-09',
        required bool shown,
      }) async {
        await _pump(
          tester,
          _card(
            service: _Fake(),
            switchOn: switchOn,
            canSend: canSend,
            monthKey: monthKey,
          ),
        );
        expect(
          find.byKey(const Key('parking-invoices-card')),
          shown ? findsOneWidget : findsNothing,
          reason: 'switchOn=$switchOn canSend=$canSend month=$monthKey',
        );
      }

      await check(shown: true);
      await check(switchOn: false, shown: false);
      await check(canSend: false, shown: false);
      await check(monthKey: '2026-08', shown: false);
      await check(monthKey: '2026-10', shown: false);
    });

    testWidgets('says where the month stands: ready, sending, sent', (
      tester,
    ) async {
      final run = StreamController<ParkingInvoiceRun?>.broadcast(sync: true);
      addTearDown(run.close);
      await _pump(
        tester,
        _card(
          service: _Fake(),
          run: run.stream,
          staffNames: const {'u1': 'Keren Sow'},
        ),
      );
      // Before the server answers, only the explanation shows.
      expect(find.byKey(const Key('parking-invoices-status')), findsNothing);
      expect(find.text('Send invoices'), findsOneWidget);

      run.add(null);
      await tester.pump();
      expect(
        find.text(
          'September 2026: invoices not prepared yet. You can still review '
          'and send them.',
        ),
        findsOneWidget,
      );

      run.add(
        const ParkingInvoiceRun(
          status: ParkingInvoiceRunStatus.ready,
          recipients: 3,
          totalDueCents: 57000,
        ),
      );
      await tester.pump();
      expect(
        find.text('September 2026: ready to send · 3 customers · \$570.00 due'),
        findsOneWidget,
      );

      run.add(const ParkingInvoiceRun(status: ParkingInvoiceRunStatus.sending));
      await tester.pump();
      expect(find.text('September 2026: sending invoices…'), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const Key('parking-invoices-open')),
            )
            .onPressed,
        isNull,
        reason: 'no second send while one is running',
      );

      run.add(
        ParkingInvoiceRun(
          status: ParkingInvoiceRunStatus.sent,
          sentAt: DateTime(2026, 10, 2, 14, 30),
          sentBy: 'u1',
          sent: 2,
          failed: 1,
        ),
      );
      await tester.pump();
      expect(find.textContaining('Sent on Oct 2, 2026'), findsOneWidget);
      expect(find.textContaining('by Keren Sow'), findsOneWidget);
      expect(find.text('Sent 2 · Skipped 0 · Failed 1'), findsOneWidget);

      run.add(
        ParkingInvoiceRun(
          status: ParkingInvoiceRunStatus.sent,
          sentAt: DateTime(2026, 10, 3, 9, 5),
          sentBy: 'auto',
          sent: 3,
        ),
      );
      await tester.pump();
      expect(find.textContaining('Sent on Oct 3, 2026'), findsOneWidget);
      expect(
        find.textContaining(RegExp(r'9:05.AM automatically')),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('a refused read of the run leaves the card usable', (
      tester,
    ) async {
      await _pump(
        tester,
        _card(
          service: _Fake(),
          run: Stream<ParkingInvoiceRun?>.error(_refusal('permission-denied')),
        ),
      );
      await tester.pump();
      expect(find.byKey(const Key('parking-invoices-status')), findsNothing);
      expect(find.byKey(const Key('parking-invoices-open')), findsOneWidget);
    });

    testWidgets('the preview lists customers; already-sent ones are muted '
        'and unticked', (tester) async {
      final service = _Fake()..preview = _preview([_awa, _moussa, _fatou]);
      await _pump(tester, _card(service: service));
      await tester.tap(find.byKey(const Key('parking-invoices-open')));
      await tester.pump();
      await tester.pumpAndSettle();

      expect(service.previewMonths, ['2026-09']);
      expect(find.text('Invoices · September 2026'), findsOneWidget);
      expect(
        find.text(
          '2014 Toyota Corolla, 2016 Toyota RAV4 · \$450.00 due · Still parked',
        ),
        findsOneWidget,
      );
      expect(
        find.text('2012 Honda Civic · \$0.00 due · Still parked'),
        findsOneWidget,
      );
      expect(
        find.text('2010 Nissan Altima · \$120.00 due · Invoice already sent'),
        findsOneWidget,
      );
      bool ticked(String phone) => tester
          .widget<CheckboxListTile>(
            find.byKey(Key('parking-invoices-row-$phone')),
          )
          .value!;
      expect(ticked('+13475550101'), isTrue);
      expect(ticked('+13475550102'), isTrue);
      expect(ticked('+13475550103'), isFalse);
      expect(find.text('Send 2 invoices'), findsOneWidget);
    });

    testWidgets('Send goes to the ticked customers and shows what happened', (
      tester,
    ) async {
      final service = _Fake()
        ..preview = _preview([_awa, _moussa, _fatou])
        ..results = [const ParkingInvoiceResult(sent: 1, failed: 1)];
      await _pump(tester, _card(service: service));
      await tester.tap(find.byKey(const Key('parking-invoices-open')));
      await tester.pumpAndSettle();

      // Untick Moussa, tick Fatou: the send follows the ticks.
      await tester.tap(
        find.byKey(const Key('parking-invoices-row-+13475550102')),
      );
      await tester.tap(
        find.byKey(const Key('parking-invoices-row-+13475550103')),
      );
      await tester.pump();
      expect(find.text('Send 2 invoices'), findsOneWidget);

      await tester.tap(find.byKey(const Key('parking-invoices-send')));
      await tester.pumpAndSettle();

      expect(service.sends, hasLength(1));
      expect(service.sends.single.businessId, 'biz1');
      expect(service.sends.single.monthKey, '2026-09');
      expect(service.sends.single.phones, ['+13475550101', '+13475550103']);
      expect(find.text('Invoices sent'), findsOneWidget);
      expect(find.byKey(const Key('parking-invoices-result')), findsOneWidget);
      expect(find.text('Sent 1 · Skipped 0 · Failed 1'), findsOneWidget);
      expect(find.byKey(const Key('parking-invoices-remaining')), findsNothing);
      await tester.tap(find.byKey(const Key('parking-invoices-done')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('parking-invoices-done')), findsNothing);
    });

    testWidgets('Select none disables Send; Select all brings everyone back', (
      tester,
    ) async {
      final service = _Fake()..preview = _preview([_awa, _fatou]);
      await _pump(tester, _card(service: service));
      await tester.tap(find.byKey(const Key('parking-invoices-open')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('parking-invoices-none')));
      await tester.pump();
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const Key('parking-invoices-send')),
            )
            .onPressed,
        isNull,
      );
      await tester.tap(find.byKey(const Key('parking-invoices-all')));
      await tester.pump();
      expect(find.text('Send 2 invoices'), findsOneWidget);
    });

    testWidgets('a send the server cut short offers the rest', (tester) async {
      final service = _Fake()
        ..preview = _preview([_awa, _moussa])
        ..results = [const ParkingInvoiceResult(sent: 1, remaining: 1)];
      await _pump(tester, _card(service: service));
      await tester.tap(find.byKey(const Key('parking-invoices-open')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('parking-invoices-send')));
      await tester.pumpAndSettle();

      expect(
        find.text('1 invoice is still waiting. Send again to continue.'),
        findsOneWidget,
      );
      // The rest: the list is read again (the server marks who went out).
      service.preview = _preview([
        ParkingInvoiceRecipient(
          phone: _awa.phone,
          name: _awa.name,
          cars: _awa.cars,
          totalDueCents: _awa.totalDueCents,
          stillParked: true,
          alreadySent: true,
        ),
        _moussa,
      ]);
      await tester.tap(find.byKey(const Key('parking-invoices-rest')));
      await tester.pumpAndSettle();
      expect(service.previewMonths, hasLength(2));
      expect(find.text('Send 1 invoice'), findsOneWidget);
    });

    testWidgets('refusals are explained: owner-only, switch off, wrong month', (
      tester,
    ) async {
      for (final (reason, text) in [
        ('invoices_owner_only', 'Only the business owner can send invoices.'),
        (
          'parking_whatsapp_off',
          'WhatsApp messages are switched off for this business.',
        ),
        (
          'invoice_month_invalid',
          'Only the month that just ended can be invoiced.',
        ),
      ]) {
        final service = _Fake()
          ..preview = _preview([_awa])
          ..sendError = _refusal(reason);
        await _pump(tester, _card(service: service));
        await tester.tap(find.byKey(const Key('parking-invoices-open')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('parking-invoices-send')));
        await tester.pumpAndSettle();
        expect(find.text(text), findsOneWidget, reason: reason);
        // Back to ready: the owner can try again.
        expect(
          tester
              .widget<FilledButton>(
                find.byKey(const Key('parking-invoices-send')),
              )
              .onPressed,
          isNotNull,
        );
        await tester.pumpWidget(const SizedBox());
      }
    });

    testWidgets('a failed preview shows the reason and Retry', (tester) async {
      final service = _Fake()..previewError = _refusal('invoices_owner_only');
      await _pump(tester, _card(service: service));
      await tester.tap(find.byKey(const Key('parking-invoices-open')));
      await tester.pumpAndSettle();
      expect(
        find.text('Only the business owner can send invoices.'),
        findsOneWidget,
      );
      service
        ..previewError = null
        ..preview = _preview([_awa]);
      await tester.tap(find.byKey(const Key('parking-invoices-retry')));
      await tester.pumpAndSettle();
      expect(find.text('Send 1 invoice'), findsOneWidget);
    });

    testWidgets('a preview that never answers resolves by timeout', (
      tester,
    ) async {
      final service = _Fake()..previewGate = Completer<ParkingInvoicePreview>();
      await _pump(
        tester,
        _card(service: service, timeout: const Duration(seconds: 2)),
      );
      await tester.tap(find.byKey(const Key('parking-invoices-open')));
      await tester.pump();
      await tester.pump();
      expect(find.text('Preparing the list…'), findsOneWidget);
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();
      expect(find.text('Preparing the list…'), findsNothing);
      expect(
        find.text('Could not load the invoices. Try again.'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('parking-invoices-retry')), findsOneWidget);
    });

    testWidgets('nobody to invoice says so', (tester) async {
      await _pump(tester, _card(service: _Fake()));
      await tester.tap(find.byKey(const Key('parking-invoices-open')));
      await tester.pumpAndSettle();
      expect(
        find.text('Nobody needs an invoice for this month.'),
        findsOneWidget,
      );
    });

    testWidgets('French, on a 360 px phone: card, preview and result fit', (
      tester,
    ) async {
      final service = _Fake()
        ..preview = _preview([_awa, _moussa, _fatou])
        ..results = [const ParkingInvoiceResult(sent: 2, remaining: 4)];
      final run = StreamController<ParkingInvoiceRun?>.broadcast(sync: true);
      addTearDown(run.close);
      await _pump(
        tester,
        _card(service: service, run: run.stream),
        locale: const Locale('fr'),
      );
      run.add(
        const ParkingInvoiceRun(
          status: ParkingInvoiceRunStatus.ready,
          recipients: 3,
          totalDueCents: 57000,
        ),
      );
      await tester.pump();
      expect(find.text('Envoyer les factures'), findsOneWidget);
      expect(
        find.text(
          'septembre 2026 : prêtes à envoyer · 3 clients · \$570.00 à payer',
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);

      await tester.tap(find.byKey(const Key('parking-invoices-open')));
      await tester.pumpAndSettle();
      expect(find.text('Factures · septembre 2026'), findsOneWidget);
      expect(
        find.text(
          '2014 Toyota Corolla, 2016 Toyota RAV4 · \$450.00 à payer · '
          'Toujours garée',
        ),
        findsOneWidget,
      );
      expect(find.textContaining('Facture déjà envoyée'), findsOneWidget);
      expect(find.text('Envoyer 2 factures'), findsOneWidget);
      expect(tester.takeException(), isNull);

      await tester.tap(find.byKey(const Key('parking-invoices-send')));
      await tester.pumpAndSettle();
      expect(find.text('Factures envoyées'), findsOneWidget);
      expect(find.text('Envoyés 2 · Ignorés 0 · Échecs 0'), findsOneWidget);
      expect(
        find.text(
          '4 factures sont encore en attente. Envoyez à nouveau pour continuer.',
        ),
        findsOneWidget,
      );
      expect(find.text('Envoyer le reste'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('invoice status on the customer cards', () {
    final car = {
      'id': 'c1',
      'carYear': '2024',
      'carMake': 'Ford',
      'carModel': 'F150',
      'parkingDate': DateTime.parse('2026-09-01T12:00:00Z'),
      'dailyRate': 15,
      'paymentStatus': 'awaiting_direct_payment',
      'status': 'reserved',
      'customerName': 'Diallo',
      'customerPhone': '(646) 555-0103',
    };
    final summary = parkingMonthSummary(
      [car],
      '2026-09',
      DateTime.parse('2026-10-01T13:00:00Z'),
    );

    Widget list(Map<String, ParkingMessage> invoices, Locale locale) =>
        MaterialApp(
          locale: locale,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: ParkingMonthCustomerList(
              summary: summary,
              view: ParkingMonthView.all,
              onTap: (_) {},
              invoices: invoices,
            ),
          ),
        );

    Map<String, ParkingMessage> rows(
      String status, {
      String delivery = '',
      String error = '',
    }) => parkingInvoiceStatusByCustomer([
      ParkingMessage.fromMap('invoice_biz1_2026-09_16465550103', {
        'kind': 'invoice',
        'phone': '+16465550103',
        'status': status,
        'deliveryStatus': delivery,
        'error': error,
        'monthKey': '2026-09',
      })!,
    ]);

    testWidgets('a customer without an invoice shows no status', (
      tester,
    ) async {
      await tester.pumpWidget(list(const {}, const Locale('en')));
      expect(find.text('Diallo'), findsOneWidget);
      expect(find.textContaining('Invoice:'), findsNothing);
    });

    testWidgets('sent, delivered, read and failed read as the customer sees '
        'them', (tester) async {
      for (final (status, delivery, text) in [
        ('queued', '', 'Invoice: Queued'),
        ('sent', '', 'Invoice: Sent'),
        ('sent', 'delivered', 'Invoice: Delivered'),
        ('sent', 'read', 'Invoice: Read'),
        ('failed', '', 'Invoice: Failed'),
        ('stopped', '', 'Invoice: Stopped by the customer'),
      ]) {
        await tester.pumpWidget(
          list(rows(status, delivery: delivery), const Locale('en')),
        );
        expect(find.text(text), findsOneWidget, reason: '$status/$delivery');
      }
    });

    testWidgets('in French on a 360 px phone', (tester) async {
      tester.view.physicalSize = const Size(360, 720);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        list(rows('sent', delivery: 'delivered'), const Locale('fr')),
      );
      expect(find.text('Facture : Remis'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
