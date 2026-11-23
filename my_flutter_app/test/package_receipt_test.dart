import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/package_receipt.dart';
import 'package:my_flutter_app/widgets/package_receipt_widgets.dart';

const _theLink = 'https://example.test/r/abc?x=1&y=2';

class _FakeService implements PackageReceiptService {
  _FakeService({
    this.answer = const ReceiptLink(
      link: _theLink,
      sender: ReceiptSender(
        name: 'Sender One',
        phone: '+1 555 123 0000',
        email: 'sender@example.test',
      ),
    ),
    this.refuse,
    this.rows = const [],
  });

  final ReceiptLink answer;
  final ReceiptRefusal? refuse;
  final List<ReceiptRow> rows;
  final sends = <ReceiptChannel>[];
  int linkCalls = 0;
  Completer<void>? hold;

  @override
  Future<ReceiptLink> link(String businessId, String lineId) async {
    linkCalls++;
    return answer;
  }

  @override
  Future<ReceiptSent> send(
    String businessId,
    String lineId,
    ReceiptChannel channel,
  ) async {
    sends.add(channel);
    if (hold != null) await hold!.future;
    if (refuse != null) throw ReceiptFailure(refuse!);
    return ReceiptSent(channel: channel);
  }

  @override
  Stream<List<ReceiptRow>> watchRows(String businessId, String lineId) =>
      Stream.value(rows);
}

class _FakeModes implements PackageReceiptModeSource {
  _FakeModes(this.initial, {this.fail = false});

  final String initial;
  final bool fail;
  final saved = <String>[];

  @override
  Stream<String> watch(String businessId) => Stream.value(initial);

  @override
  Future<String> save(String businessId, String sendMode) async {
    saved.add(sendMode);
    if (fail) throw Exception('no');
    return sendMode;
  }
}

Widget _host(Widget child, {String locale = 'en', double? width}) {
  final body = Scaffold(body: child);
  return MaterialApp(
    locale: Locale(locale),
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: width == null
        ? body
        : Center(
            child: SizedBox(width: width, child: body),
          ),
  );
}

Future<void> _openSheet(
  WidgetTester tester,
  _FakeService service, {
  List<Uri>? launched,
  List<String>? shared,
  bool launchOk = true,
  String locale = 'en',
}) async {
  await tester.pumpWidget(
    _host(
      Builder(
        builder: (context) => TextButton(
          onPressed: () => showPackageReceiptSheet(
            context,
            businessId: 'b1',
            lineId: 'l1',
            senderName: 'Sender One',
            senderPhone: '+1 555 123 0000',
            service: service,
            launch: (uri) async {
              launched?.add(uri);
              return launchOk;
            },
            share: (link, subject) async => shared?.add(link),
          ),
          child: const Text('open'),
        ),
      ),
      locale: locale,
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

void main() {
  group('requests and refusals', () {
    test('receipt_link and receipt_send requests', () {
      expect(receiptLinkRequest(' b ', 'l'), {
        'action': 'receipt_link',
        'businessId': 'b',
        'lineId': 'l',
      });
      expect(receiptSendRequest('b', 'l', ReceiptChannel.whatsapp), {
        'action': 'receipt_send',
        'businessId': 'b',
        'lineId': 'l',
        'channel': 'whatsapp',
      });
      expect(
        receiptSendRequest('b', 'l', ReceiptChannel.sms)!['channel'],
        'sms',
      );
      expect(receiptSendRequest('b', '', ReceiptChannel.sms), isNull);
      expect(receiptLinkRequest('', 'l'), isNull);
    });

    test('refusal reasons', () {
      expect(
        receiptRefusalOf('receipt_no_sender_phone'),
        ReceiptRefusal.noSenderPhone,
      );
      expect(
        receiptRefusalOf('receipt_sms_not_set_up'),
        ReceiptRefusal.smsNotSetUp,
      );
      expect(receiptRefusalOf('receipt_too_soon'), ReceiptRefusal.tooSoon);
      expect(receiptRefusalOf('receipt_line_gone'), ReceiptRefusal.lineGone);
      expect(
        receiptRefusalOf('receipt_whatsapp_off'),
        ReceiptRefusal.whatsAppOff,
      );
      expect(receiptRefusalOf('nope'), ReceiptRefusal.other);
      expect(receiptRefusalOf(null), ReceiptRefusal.other);
      expect(
        receiptRefusalOfError(
          FirebaseFunctionsException(
            message: 'x',
            code: 'failed-precondition',
            details: {'reason': 'receipt_too_soon'},
          ),
        ),
        ReceiptRefusal.tooSoon,
      );
      expect(receiptRefusalOfError(Exception('net')), ReceiptRefusal.other);
    });

    test('link answer parses and expires', () {
      final link = ReceiptLink.fromCallable({
        'success': true,
        'link': ' $_theLink ',
        'filename': 'receipt.pdf',
        'expiresAtMs': 1000000,
        'smsReady': true,
        'sender': {'name': 'A', 'phone': '+1', 'email': 'a@b.co'},
      });
      expect(link.link, _theLink);
      expect(link.smsReady, isTrue);
      expect(link.sender.email, 'a@b.co');
      expect(link.freshAt(0), isTrue);
      expect(link.freshAt(900000), isFalse);
      expect(ReceiptLink.fromCallable(null).usable, isFalse);
    });

    test('mode defaults to button', () {
      expect(receiptModeOf(null), 'button');
      expect(receiptModeOf('weird'), 'button');
      expect(receiptModeOf('auto'), 'auto');
    });
  });

  group('links', () {
    test('sms uri encodes the body and cleans the number', () {
      final uri = receiptSmsUri(
        '+1 (555) 123-0000',
        receiptMessageBody(_theLink),
      );
      expect(uri.scheme, 'sms');
      expect(uri.path, '+15551230000');
      expect(uri.query.startsWith('body='), isTrue);
      expect(uri.query.contains(' '), isFalse);
      expect(uri.query.contains('+'), isFalse);
      expect(uri.queryParameters['body'], contains(_theLink));
      expect(uri.queryParameters['body'], contains('Votre reçu'));
    });

    test('mailto keeps the address and encodes the rest', () {
      final uri = receiptMailUri(
        'a.b+c@example.test',
        'Sub & ject',
        'Hi\n$_theLink',
      );
      expect(uri.scheme, 'mailto');
      expect(uri.toString().startsWith('mailto:a.b%2Bc@example.test?'), isTrue);
      expect(uri.queryParameters['subject'], 'Sub & ject');
      expect(uri.queryParameters['body'], 'Hi\n$_theLink');
    });

    test('email check', () {
      expect(receiptEmailValid('a@b.co'), isTrue);
      expect(receiptEmailValid(' a@b.co '), isTrue);
      expect(receiptEmailValid('a@b'), isFalse);
      expect(receiptEmailValid('a b@c.com'), isFalse);
      expect(receiptEmailValid(''), isFalse);
    });
  });

  group('status', () {
    final t1 = DateTime(2026, 11, 23, 2, 10);
    final t2 = DateTime(2026, 11, 23, 3, 10);

    test('none, sent, pending', () {
      expect(lastReceiptStatus(const []), isNull);
      final sent = lastReceiptStatus([
        ReceiptRow(channel: ReceiptChannel.whatsapp, status: 'sent', at: t1),
      ])!;
      expect(sent.kind, ReceiptStatusKind.sent);
      expect(sent.at, t1);
      expect(
        lastReceiptStatus([
          ReceiptRow(
            channel: ReceiptChannel.whatsapp,
            status: 'queued',
            at: t1,
          ),
        ])!.kind,
        ReceiptStatusKind.pending,
      );
    });

    test('the newest row wins', () {
      final s = lastReceiptStatus([
        ReceiptRow(channel: ReceiptChannel.whatsapp, status: 'failed', at: t1),
        ReceiptRow(channel: ReceiptChannel.sms, status: 'sent', at: t2),
      ])!;
      expect(s.channel, ReceiptChannel.sms);
      expect(s.kind, ReceiptStatusKind.sent);
    });

    test('131026 and failed status mean not on WhatsApp', () {
      final a = lastReceiptStatus([
        ReceiptRow(
          channel: ReceiptChannel.whatsapp,
          status: 'sent',
          delivery: 'failed',
          errorCode: 131026,
          at: t1,
        ),
      ])!;
      expect(a.kind, ReceiptStatusKind.notOnWhatsApp);
      final b = lastReceiptStatus([
        ReceiptRow(channel: ReceiptChannel.whatsapp, status: 'failed', at: t1),
      ])!;
      expect(b.kind, ReceiptStatusKind.notOnWhatsApp);
      final c = lastReceiptStatus([
        ReceiptRow(
          channel: ReceiptChannel.whatsapp,
          status: 'failed',
          errorCode: 131047,
          at: t1,
        ),
      ])!;
      expect(c.kind, ReceiptStatusKind.failed);
      final d = lastReceiptStatus([
        ReceiptRow(channel: ReceiptChannel.sms, status: 'failed', at: t1),
      ])!;
      expect(d.kind, ReceiptStatusKind.failed);
    });

    test('rows: only sender receipts', () {
      expect(
        ReceiptRow.fromMap({'update': 'received', 'role': 'sender'}),
        isNull,
      );
      expect(
        ReceiptRow.fromMap({'update': 'receipt', 'role': 'receiver'}),
        isNull,
      );
      final row = ReceiptRow.fromMap({
        'update': 'receipt',
        'role': 'sender',
        'channel': 'sms',
        'status': 'sent',
        'updatedAt': 1700000000000,
      })!;
      expect(row.channel, ReceiptChannel.sms);
      expect(row.at, isNotNull);
      // A row with no channel is a WhatsApp one.
      expect(
        ReceiptRow.fromMap({'update': 'receipt', 'status': 'sent'})!.channel,
        ReceiptChannel.whatsapp,
      );
    });
  });

  group('sheet', () {
    testWidgets('lists the choices, WhatsApp first, in English', (
      tester,
    ) async {
      await _openSheet(tester, _FakeService());
      expect(find.text('Send the receipt'), findsOneWidget);
      final order = [
        'receipt-whatsapp',
        'receipt-text',
        'receipt-email',
        'receipt-qr',
        'receipt-share',
      ].map((k) => tester.getTopLeft(find.byKey(Key(k))).dy).toList();
      expect([...order]..sort(), order);
      expect(find.textContaining('Sender One'), findsWidgets);
    });

    testWidgets('WhatsApp sends once and says so; double tap guarded', (
      tester,
    ) async {
      final service = _FakeService()..hold = Completer<void>();
      await _openSheet(tester, service);
      await tester.tap(find.byKey(const Key('receipt-whatsapp')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('receipt-whatsapp')));
      await tester.tap(find.byKey(const Key('receipt-text')));
      await tester.pump();
      expect(find.text('Working…'), findsOneWidget);
      service.hold!.complete();
      await tester.pumpAndSettle();
      expect(service.sends, [ReceiptChannel.whatsapp]);
      expect(find.text('Receipt sent on WhatsApp.'), findsOneWidget);
      expect(find.text('Working…'), findsNothing);
    });

    testWidgets('refusals are sentences, in French too', (tester) async {
      final service = _FakeService(refuse: ReceiptRefusal.noSenderPhone);
      await _openSheet(tester, service, locale: 'fr');
      await tester.tap(find.byKey(const Key('receipt-whatsapp')));
      await tester.pumpAndSettle();
      expect(find.textContaining('pas de numéro d’expéditeur'), findsOneWidget);
      expect(find.text('Envoyer le reçu'), findsOneWidget);
    });

    testWidgets('text from this phone opens Messages with the link', (
      tester,
    ) async {
      final launched = <Uri>[];
      final service = _FakeService();
      await _openSheet(tester, service, launched: launched);
      await tester.tap(find.byKey(const Key('receipt-text')));
      await tester.pumpAndSettle();
      expect(service.sends, isEmpty);
      expect(launched, hasLength(1));
      expect(launched.single.scheme, 'sms');
      expect(launched.single.path, '+15551230000');
      expect(launched.single.queryParameters['body'], contains(_theLink));
    });

    testWidgets('text goes through the server when it is set up', (
      tester,
    ) async {
      final launched = <Uri>[];
      final service = _FakeService(
        answer: const ReceiptLink(
          link: _theLink,
          smsReady: true,
          sender: ReceiptSender(phone: '+15551230000'),
        ),
      );
      await _openSheet(tester, service, launched: launched);
      await tester.tap(find.byKey(const Key('receipt-text')));
      await tester.pumpAndSettle();
      expect(service.sends, [ReceiptChannel.sms]);
      expect(launched, isEmpty);
      expect(find.text('Receipt sent by text.'), findsOneWidget);
    });

    testWidgets('email uses the known address, else asks for one', (
      tester,
    ) async {
      final launched = <Uri>[];
      await _openSheet(tester, _FakeService(), launched: launched);
      await tester.tap(find.byKey(const Key('receipt-email')));
      await tester.pumpAndSettle();
      expect(launched.single.scheme, 'mailto');
      expect(launched.single.path, 'sender@example.test');

      final asked = <Uri>[];
      // Start clean for the second sheet.
      await tester.pumpWidget(const SizedBox());
      await _openSheet(
        tester,
        _FakeService(answer: const ReceiptLink(link: _theLink)),
        launched: asked,
      );
      await tester.tap(find.byKey(const Key('receipt-email')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('receipt-email-field')),
        'nope',
      );
      await tester.tap(find.byKey(const Key('receipt-email-continue')));
      await tester.pumpAndSettle();
      expect(find.text('Enter a valid email address.'), findsOneWidget);
      await tester.enterText(
        find.byKey(const Key('receipt-email-field')),
        'who@example.test',
      );
      await tester.tap(find.byKey(const Key('receipt-email-continue')));
      await tester.pumpAndSettle();
      expect(asked.single.path, 'who@example.test');
    });

    testWidgets('QR shows the link code; share passes the link', (
      tester,
    ) async {
      final shared = <String>[];
      await _openSheet(tester, _FakeService(), shared: shared);
      await tester.tap(find.byKey(const Key('receipt-qr')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('my-card-qr')), findsOneWidget);
      expect(find.byKey(const Key('receipt-qr-hint')), findsOneWidget);
      await tester.tap(find.text('Close'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('receipt-share')));
      await tester.pumpAndSettle();
      expect(shared, [_theLink]);
    });

    testWidgets('shows the last send, and the not-on-WhatsApp advice', (
      tester,
    ) async {
      await _openSheet(
        tester,
        _FakeService(
          rows: [
            ReceiptRow(
              channel: ReceiptChannel.whatsapp,
              status: 'sent',
              at: DateTime(2026, 11, 23, 2, 10),
            ),
          ],
        ),
      );
      final shown = tester
          .widget<Text>(find.byKey(const Key('receipt-status')))
          .data!
          .replaceAll(RegExp(r'[\u202f\u00a0]'), ' ');
      expect(shown, 'Receipt sent on WhatsApp Nov 23, 2026 2:10 AM');
      await tester.pumpWidget(const SizedBox());
      await _openSheet(
        tester,
        _FakeService(
          rows: [
            ReceiptRow(
              channel: ReceiptChannel.whatsapp,
              status: 'sent',
              delivery: 'failed',
              errorCode: 131026,
              at: DateTime(2026, 11, 23, 2, 10),
            ),
          ],
        ),
      );
      expect(
        find.text(
          'This number is not on WhatsApp. Send the receipt by text or '
          'email, or show the QR.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('fits 320 px wide in French', (tester) async {
      tester.view.physicalSize = const Size(320, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await _openSheet(
        tester,
        _FakeService(
          rows: [
            ReceiptRow(
              channel: ReceiptChannel.whatsapp,
              status: 'failed',
              errorCode: 131026,
              at: DateTime(2026, 11, 23, 2, 10),
            ),
          ],
        ),
        locale: 'fr',
      );
      expect(tester.takeException(), isNull);
      expect(find.text('Message texte'), findsOneWidget);
      expect(find.text('Afficher le code QR'), findsOneWidget);
      expect(
        find.textContaining('Ce numéro n’est pas sur WhatsApp'),
        findsOneWidget,
      );
    });

    testWidgets('the button draws nothing for a line with no id', (
      tester,
    ) async {
      final line = ContainerLine.fromMap('', {'businessId': 'b1'});
      await tester.pumpWidget(_host(ReceiptSendButton(line: line)));
      expect(find.byType(TextButton), findsNothing);
      final real = ContainerLine.fromMap('l1', {
        'businessId': 'b1',
        'customerName': 'Sender One',
        'customerPhone': '+15551230000',
      });
      await tester.pumpWidget(
        _host(ReceiptSendButton(line: real, service: _FakeService())),
      );
      expect(find.text('Send receipt'), findsOneWidget);
      await tester.tap(find.byKey(const Key('receipt-send:l1')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('receipt-sheet')), findsOneWidget);
    });
  });

  group('settings card', () {
    testWidgets('shows the saved mode and saves a change', (tester) async {
      final modes = _FakeModes('button');
      await tester.pumpWidget(
        _host(
          PackageReceiptModeCard(
            businessId: 'b1',
            canEdit: true,
            source: modes,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Staff press Send receipt'), findsOneWidget);
      await tester.tap(find.byKey(const Key('receipt-mode-auto')));
      await tester.pumpAndSettle();
      expect(modes.saved, ['auto']);
      expect(find.byKey(const Key('receipt-mode-error')), findsNothing);
    });

    testWidgets('a failed save goes back and says so', (tester) async {
      final modes = _FakeModes('button', fail: true);
      await tester.pumpWidget(
        _host(
          PackageReceiptModeCard(
            businessId: 'b1',
            canEdit: true,
            source: modes,
          ),
          locale: 'fr',
          width: 320,
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('receipt-mode-auto')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('receipt-mode-error')), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('read only for everyone else', (tester) async {
      final modes = _FakeModes('auto');
      await tester.pumpWidget(
        _host(
          PackageReceiptModeCard(
            businessId: 'b1',
            canEdit: false,
            source: modes,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('receipt-mode-button')));
      await tester.pumpAndSettle();
      expect(modes.saved, isEmpty);
      expect(find.byKey(const Key('receipt-mode-owner-only')), findsOneWidget);
    });

    testWidgets('a read that never answers resolves to a message', (
      tester,
    ) async {
      await tester.pumpWidget(
        _host(
          PackageReceiptModeCard(
            businessId: 'b1',
            canEdit: true,
            source: _NeverModes(),
            timeout: const Duration(seconds: 1),
          ),
        ),
      );
      await tester.pump(const Duration(seconds: 2));
      expect(find.byKey(const Key('receipt-mode-load-failed')), findsOneWidget);
    });
  });
}

class _NeverModes implements PackageReceiptModeSource {
  @override
  Stream<String> watch(String businessId) => const Stream.empty();

  @override
  Future<String> save(String businessId, String sendMode) async => sendMode;
}
