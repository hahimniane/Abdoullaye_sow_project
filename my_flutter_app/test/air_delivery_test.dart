import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/l10n/app_localizations_en.dart';
import 'package:my_flutter_app/l10n/app_localizations_fr.dart';
import 'package:my_flutter_app/screens/deliveries_home_screen.dart';
import 'package:my_flutter_app/screens/package_request_settings_screen.dart';
import 'package:my_flutter_app/screens/waiting_packages_screen.dart';
import 'package:my_flutter_app/services/container_delivery.dart';
import 'package:my_flutter_app/services/container_delivery_service.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/deliveries_home.dart';
import 'package:my_flutter_app/services/package_requests.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/package_delivery_widgets.dart';
import 'package:my_flutter_app/widgets/proof_refusal_text.dart';
import 'package:my_flutter_app/widgets/request_code_lookup_sheet.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fixtures/fake_package_requests.dart';

/// Air packages, app side (docs/AIR_PACKAGES.md): the pickup code and the
/// "deliver without a code" override on the Mark delivered sheet, the USD
/// collected at handover, the Deliveries home for the agent, the owner's
/// three proof switches, the counter's look-up by request code, and the
/// refusal mirror. The callables are fakes.

// A 1x1 transparent PNG: enough for Image.memory to decode in a test.
final Uint8List _png = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
);

ShippingContainer _container(
  String id, {
  String status = containerStatusArrived,
  String label = 'Sailing 3 Oct, box 2',
  String number = 'MSKU1234567',
  int lineCount = 2,
  int delivered = 0,
}) => ShippingContainer.fromMap(id, {
  'businessId': 'b1',
  'label': label,
  'containerNumber': number,
  'status': status,
  'destinationCountryId': 'guinea',
  'destinationCountryName': 'Guinea',
  'arrivedAt': DateTime(2026, 10, 19, 9),
  'lineCount': lineCount,
  'deliveredCount': delivered,
});

ContainerLine _line(
  String id, {
  String containerId = 'c1',
  String code = 'CL-K7M4P2',
  Map<String, dynamic> extra = const {},
}) => ContainerLine.fromMap(id, {
  'businessId': 'b1',
  'containerId': containerId,
  'containerStatus': containerStatusArrived,
  'kind': containerLineKindBarrels,
  'quantity': 3,
  'ownerKind': containerOwnerCustomer,
  'customerName': 'Fatou Diallo',
  'customerPhone': '+19175551234',
  'receiverName': 'Mariama Bah',
  'receiverPhone': '+224621234567',
  'trackingCode': code,
  'createdAt': DateTime(2026, 10, 1, 10),
  ...extra,
});

/// The callable, answered in place of Firebase.
class _Calls {
  final payloads = <Map<String, Object?>>[];
  Object? Function(Map<String, Object?> payload)? respond;

  Future<Object?> call(String name, Map<String, Object?> payload) async {
    expect(name, 'updateContainerLine');
    payloads.add(payload);
    final answer = respond;
    if (answer != null) return answer(payload);
    return {
      'success': true,
      'lineId': payload['lineId'],
      'delivered': true,
      'alreadyDelivered': false,
      'collectedBy': payload['collectedBy'],
      'hasBalance': false,
      'balanceCents': 0,
      'deliveredWithoutCode': payload['override'] != null,
      'collectedCents': payload['collectedCents'] ?? 0,
      'paymentId': payload['collectedCents'] == null ? '' : 'pay1',
    };
  }

  ContainerDeliveryService get service =>
      ContainerDeliveryService(caller: call);
}

FirebaseFunctionsException _refuse(String reason) => FirebaseFunctionsException(
  message: 'SERVER ENGLISH',
  code: 'failed-precondition',
  details: {'reason': reason},
);

class _Source implements DeliveriesHomeSource {
  final containers = StreamController<List<ArrivedContainer>>.broadcast();
  final lines = StreamController<List<HandoverLine>>.broadcast();
  final proof = StreamController<PackageProofSettings>.broadcast();

  @override
  Stream<List<ArrivedContainer>> watchArrivedContainers(String businessId) =>
      containers.stream;

  @override
  Stream<List<HandoverLine>> watchArrivedLines(String businessId) =>
      lines.stream;

  @override
  Stream<PackageProofSettings> watchProofSettings(String businessId) =>
      proof.stream;
}

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
  double width = 400,
  bool scaffold = true,
}) async {
  tester.view.physicalSize = Size(width, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: scaffold ? Scaffold(body: SafeArea(child: child)) : child,
    ),
  );
  await tester.pumpAndSettle();
}

Widget _sheet(
  _Calls calls, {
  bool askPickupCode = true,
  PackageAccess access = PackageAccess.deliveriesOnly,
  ContainerLine? line,
  Future<Uint8List?> Function()? photo,
  List<String>? uploads,
}) => MarkDeliveredSheet(
  businessId: 'b1',
  line: line ?? _line('l1'),
  access: access,
  service: calls.service,
  askPickupCode: askPickupCode,
  photoCapture: photo ?? () async => _png,
  photoUploader: ({required businessId, required bytes}) async {
    uploads?.add('$businessId:${bytes.length}');
    return 'packagePhotos/b1/u-agent/ABCDEFGHIJKLMNOPQRST.png';
  },
);

Future<void> _tap(WidgetTester tester, String key) async {
  final finder = find.byKey(Key(key));
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

String _allText(WidgetTester tester) => [
  for (final w in tester.widgetList<Text>(find.byType(Text)))
    w.data ?? w.textSpan?.toPlainText() ?? '',
  for (final w in tester.widgetList<EditableText>(find.byType(EditableText)))
    w.controller.text,
].join('\n');

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('the refusal mirror', () {
    test('every new server code has a sentence in both languages', () {
      final en = AppLocalizationsEn();
      final fr = AppLocalizationsFr();
      for (final code in proofRefusalCodes) {
        final english = proofRefusalText(en, code);
        final french = proofRefusalText(fr, code);
        expect(english, isNotNull, reason: code);
        expect(french, isNotNull, reason: code);
        expect(english, isNot(french), reason: code);
      }
      expect(proofRefusalText(en, 'something_else'), isNull);
    });

    test('the codes are the ones docs/AIR_PACKAGES.md names', () {
      final doc = File('../docs/AIR_PACKAGES.md').readAsStringSync();
      for (final code in proofRefusalCodes) {
        // `collected_cents_invalid` is the server's own addition
        // (container_delivery.DELIVERY_MESSAGES), not in the design doc.
        if (code == 'collected_cents_invalid') continue;
        expect(doc, contains(code), reason: code);
      }
      // And package_proof.REFUSAL's keys are all mirrored.
      final proof = File('functions/package_proof.js').readAsStringSync();
      final block = proof.split('const REFUSAL = Object.freeze({').last;
      final keys = RegExp(r'^  ([a-z_]+):', multiLine: true)
          .allMatches(block.substring(0, block.indexOf('});')))
          .map((m) => m.group(1)!);
      expect(keys, isNotEmpty);
      for (final key in keys) {
        expect(proofRefusalCodes, contains(key));
        expect(DeliveryReason.all, contains(key));
      }
    });

    test('a delivery refusal reads from the mirror', () {
      final l10n = AppLocalizationsEn();
      expect(
        deliveryRefusalText(
          l10n,
          const DeliveryFailure(
            code: 'failed-precondition',
            reason: 'pickup_code_invalid',
          ),
        ),
        startsWith('The pickup code does not match.'),
      );
      expect(
        deliveryRefusalText(
          l10n,
          const DeliveryFailure(
            code: 'invalid-argument',
            reason: 'collected_cents_invalid',
          ),
        ),
        'Enter the amount collected in dollars, zero or more.',
      );
    });
  });

  group('the deliver request', () {
    test('asks for the code only when the switch is on and a code exists', () {
      expect(
        deliveryAsksPickupCode(businessPickupCode: true, linePickupCode: '4821'),
        isTrue,
      );
      expect(
        deliveryAsksPickupCode(businessPickupCode: false, linePickupCode: '4821'),
        isFalse,
      );
      expect(
        deliveryAsksPickupCode(businessPickupCode: true, linePickupCode: ' '),
        isFalse,
      );
    });

    test('the code, the override and the money ride the same payload', () {
      expect(deliverLineRequest('b1', 'l1'), {
        'businessId': 'b1',
        'lineId': 'l1',
        'action': 'deliver',
        'collectedBy': '',
        'acknowledgeBalance': false,
      });
      expect(
        deliverLineRequest(
          'b1',
          'l1',
          pickupCode: '48 21',
          collectedCents: 4000,
        ),
        containsPair('pickupCode', '4821'),
      );
      expect(
        deliverLineRequest('b1', 'l1', collectedCents: 4000),
        containsPair('collectedCents', 4000),
      );
      final override = deliverLineRequest(
        'b1',
        'l1',
        overrideCollectedBy: 'Mamadou  Bah\n',
        overridePhotoPath: 'packagePhotos/b1/u1/ABCDEFGHIJ.jpg',
      );
      expect(override['override'], {
        'collectedBy': 'Mamadou Bah',
        'photoPath': 'packagePhotos/b1/u1/ABCDEFGHIJ.jpg',
      });
      expect(override.containsKey('pickupCode'), isFalse);
      expect(override.containsKey('collectedCents'), isFalse);
    });

    test('whole dollars become cents; anything else is refused', () {
      expect(collectedCentsFromInput(''), 0);
      expect(collectedCentsFromInput(' 40 '), 4000);
      expect(collectedCentsFromInput(r'$1,250'), 125000);
      expect(collectedCentsFromInput('12.5'), 1250);
      expect(collectedCentsFromInput('-3'), isNull);
      expect(collectedCentsFromInput('abc'), isNull);
      expect(collectedCentsFromInput('0.001'), isNull);
    });

    test('four digits make a code; a name and a photo make an override', () {
      expect(pickupCodeComplete('4821'), isTrue);
      expect(pickupCodeComplete('48-21'), isTrue);
      expect(pickupCodeComplete('482'), isFalse);
      expect(
        deliveryOverrideErrors(collectedBy: 'M', photoPath: 'p'),
        ['override_incomplete'],
      );
      expect(
        deliveryOverrideErrors(collectedBy: 'Mamadou', photoPath: ''),
        ['override_incomplete'],
      );
      expect(
        deliveryOverrideErrors(collectedBy: 'Mamadou', photoPath: 'p'),
        isEmpty,
      );
    });

    test('the answer carries the override, the money and the payment', () {
      final result = DeliveryResult.fromCallable({
        'lineId': 'l1',
        'alreadyDelivered': false,
        'collectedBy': 'Mamadou Bah',
        'hasBalance': false,
        'deliveredWithoutCode': true,
        'collectedCents': 4000,
        'paymentId': 'pay1',
      });
      expect(result.deliveredWithoutCode, isTrue);
      expect(result.collectedCents, 4000);
      expect(result.paymentId, 'pay1');
      expect(
        deliveryDoneText(AppLocalizationsEn(), result),
        r'Delivered · $40.00 collected',
      );
      expect(
        deliveryDoneText(AppLocalizationsFr(), result),
        r'Livré · $40.00 encaissés',
      );
    });
  });

  group('the proof settings', () {
    test('are read from the business, all off when missing', () {
      expect(
        PackageRequestSettings.fromBusiness(const {}).proof,
        const PackageProofSettings(),
      );
      final settings = PackageRequestSettings.fromBusiness({
        'packageProofSettings': {'pickupCode': true, 'senderConfirm': 'yes'},
      });
      expect(settings.proof.pickupCode, isTrue);
      expect(settings.proof.photosRequired, isFalse);
      // Anything but true is off, as the server reads it.
      expect(settings.proof.senderConfirm, isFalse);
      expect(settings.proof.anyOn, isTrue);
    });

    test('ride the settings payload as `proof`, or not at all', () {
      Map<String, Object?> payload([PackageProofSettings? proof]) =>
          requestSettingsPayload(
            businessId: 'b1',
            acceptRequests: true,
            openingHours: const {},
            pickupEnabled: false,
            pickupAreas: '',
            cardBarrelBooking: false,
            proof: proof,
          );
      expect(payload().containsKey('proof'), isFalse);
      expect(
        payload(const PackageProofSettings(photosRequired: true))['proof'],
        {'photosRequired': true, 'senderConfirm': false, 'pickupCode': true}
          ..['pickupCode'] = false,
      );
    });

    test('the server names the same three keys', () {
      final proof = File('functions/package_proof.js').readAsStringSync();
      expect(
        proof,
        contains('["photosRequired", "senderConfirm", "pickupCode"]'),
      );
      expect(
        const PackageProofSettings().toMap().keys,
        ['photosRequired', 'senderConfirm', 'pickupCode'],
      );
    });
  });

  group('the request code', () {
    test('is normalised the way the server does it', () {
      for (final typed in ['R-K7M4P', 'r k7m4p', 'RK7M4P', ' k7m4p ', 'K7-M4P']) {
        expect(normalizeRequestCode(typed), 'R-K7M4P', reason: typed);
      }
      expect(normalizeRequestCode('K7M4'), '');
      // R is a code letter too: a code starting with R typed without its
      // prefix stays itself.
      for (final typed in ['RK7M4', 'rk7m4', 'R-RK7M4', 'rrk7m4']) {
        expect(normalizeRequestCode(typed), 'R-RK7M4', reason: typed);
      }
      expect(normalizeRequestCode('R-K7M4P2'), '');
      expect(normalizeRequestCode(''), '');
      expect(
        lookupRequestCodePayload(businessId: 'b1', code: 'r k7m4p'),
        {'businessId': 'b1', 'action': 'lookup_code', 'code': 'R-K7M4P'},
      );
      final source = File('functions/package_requests.js').readAsStringSync();
      expect(source, contains('function normalizeRequestCode(raw)'));
      expect(source, contains(r'/^[A-Z0-9]{5}$/'));
    });

    test('the look-up answer is read like the stored document', () {
      final request = requestFromLookup({
        'success': true,
        'request': {
          'id': 'r1',
          'businessId': 'b1',
          'code': 'R-K7M4P',
          'status': 'confirmed',
          'sender': {'name': 'Fatou Diallo', 'phoneE164': '+19175551234'},
          'receiver': {'name': 'Mariama Bah', 'phoneE164': '+224621234567'},
          'createdAt': {'_seconds': 1760000000, '_nanoseconds': 0},
        },
      });
      expect(request.id, 'r1');
      expect(request.code, 'R-K7M4P');
      expect(request.senderName, 'Fatou Diallo');
      expect(request.createdAt, isNotNull);
    });
  });

  group('the Deliveries home rows', () {
    test('arrived containers, each with its undelivered lines, in order', () {
      final sections = handoverSections(
        [
          ArrivedContainer(container: _container('sea')),
          ArrivedContainer(
            container: _container('air', number: '', label: 'Flight 12'),
            isAir: true,
          ),
          ArrivedContainer(
            container: _container('open', status: containerStatusShipped),
          ),
        ],
        [
          HandoverLine(line: _line('l1', containerId: 'sea')),
          HandoverLine(
            line: _line('l2', containerId: 'sea', extra: {
              'deliveredAt': DateTime(2026, 10, 20),
            }),
          ),
          HandoverLine(
            line: _line('l3', containerId: 'air', code: 'CL-Q7F3W9'),
            hasPickupCode: true,
          ),
          HandoverLine(line: _line('l4', containerId: 'open')),
          HandoverLine(line: _line('l5', containerId: '')),
        ],
      );
      expect(sections.map((s) => s.container.id).toSet(), {'sea', 'air'});
      final bySection = {
        for (final s in sections)
          s.container.id: s.lines.map((r) => r.line.id).toList(),
      };
      expect(bySection, {
        'sea': ['l1'],
        'air': ['l3'],
      });
      expect(sections.firstWhere((s) => s.isAir).lines.single.hasPickupCode,
          isTrue);
      expect(handoverCount(sections), 2);
      expect(containerIsAir({'shipMode': 'AIR'}), isTrue);
      expect(containerIsAir({'shipMode': 'sea'}), isFalse);
      expect(containerIsAir(const {}), isFalse);
    });
  });

  group('the Mark delivered sheet', () {
    testWidgets('with the right code, the package is delivered', (
      tester,
    ) async {
      final calls = _Calls();
      await _pump(tester, _sheet(calls));
      // The code field leads, with the keyboard on it; no amount owed is
      // named to a deliveries-only person.
      final code = find.byKey(const Key('delivery-pickup-code'));
      expect(code, findsOneWidget);
      expect(tester.widget<TextField>(code).autofocus, isTrue);
      expect(find.byKey(const Key('delivery-override')), findsNothing);
      expect(_allText(tester), isNot(contains(r'$')));

      // Three digits are not a code.
      await tester.enterText(code, '482');
      await _tap(tester, 'delivery-confirm');
      expect(find.text('Enter the 4-digit code.'), findsOneWidget);
      expect(calls.payloads, isEmpty);

      await tester.enterText(code, '4821');
      await tester.enterText(
        find.byKey(const Key('delivery-collected-now')),
        '40',
      );
      await _tap(tester, 'delivery-confirm');
      expect(calls.payloads.single, {
        'businessId': 'b1',
        'lineId': 'l1',
        'action': 'deliver',
        'collectedBy': 'Mariama Bah',
        'acknowledgeBalance': false,
        'pickupCode': '4821',
        'collectedCents': 4000,
      });
    });

    testWidgets('money collected can be received by the Business account', (
      tester,
    ) async {
      final calls = _Calls();
      await _pump(tester, _sheet(calls));
      // Nothing collected: no question about who received it.
      expect(find.byKey(const Key('delivery-received-by')), findsNothing);
      await tester.enterText(
        find.byKey(const Key('delivery-pickup-code')),
        '4821',
      );
      await tester.enterText(
        find.byKey(const Key('delivery-collected-now')),
        '40',
      );
      await tester.pump();
      expect(find.byKey(const Key('delivery-received-by')), findsOneWidget);
      await _tap(tester, 'delivery-received-by');
      await tester.tap(find.text('Business account'));
      await tester.pumpAndSettle();
      await _tap(tester, 'delivery-confirm');
      expect(calls.payloads.single['collectedCents'], 4000);
      expect(calls.payloads.single['receivedByStaffId'], 'business_account');
    });

    testWidgets('a wrong code opens "Deliver without a code"', (tester) async {
      final uploads = <String>[];
      final calls = _Calls()
        ..respond = (payload) {
          if (payload['override'] == null) throw _refuse('pickup_code_invalid');
          return null;
        };
      await _pump(tester, _sheet(calls, uploads: uploads));
      await tester.enterText(
        find.byKey(const Key('delivery-pickup-code')),
        '0000',
      );
      await _tap(tester, 'delivery-confirm');

      // The refusal in the app's words, and the way without a code.
      expect(
        find.textContaining('The pickup code does not match.'),
        findsOneWidget,
      );
      expect(find.textContaining('SERVER ENGLISH'), findsNothing);
      expect(find.byKey(const Key('delivery-override')), findsOneWidget);
      expect(find.byKey(const Key('delivery-pickup-code')), findsNothing);
      expect(find.text('Who collected it'), findsOneWidget);
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('delivery-collected-by')))
            .controller!
            .text,
        'Mariama Bah',
      );

      // Without a photo it is refused on the phone.
      await _tap(tester, 'delivery-confirm');
      expect(
        find.text(
          'Delivering without a code needs the name of the person '
          'collecting and a photo.',
        ),
        findsOneWidget,
      );
      expect(calls.payloads, hasLength(1));

      await tester.enterText(
        find.byKey(const Key('delivery-collected-by')),
        'Mamadou Bah',
      );
      await _tap(tester, 'delivery-take-photo');
      expect(uploads, ['b1:${_png.length}']);
      expect(find.byKey(const Key('delivery-photo-thumb')), findsOneWidget);
      expect(find.text('Photo added'), findsOneWidget);
      expect(find.text('Retake'), findsOneWidget);

      await _tap(tester, 'delivery-confirm');
      // Now the override does not carry the wrong code.
      final sent = calls.payloads.last;
      expect(sent.containsKey('pickupCode'), isFalse);
      expect(sent['override'], {
        'collectedBy': 'Mamadou Bah',
        'photoPath': 'packagePhotos/b1/u-agent/ABCDEFGHIJKLMNOPQRST.png',
      });
      expect(sent['collectedBy'], 'Mamadou Bah');
    });

    testWidgets('the agent may go without a code before trying one', (
      tester,
    ) async {
      final calls = _Calls();
      await _pump(tester, _sheet(calls));
      await _tap(tester, 'delivery-without-code');
      expect(find.byKey(const Key('delivery-override')), findsOneWidget);
      expect(find.byKey(const Key('delivery-code-error')), findsNothing);
      expect(find.text('Take a photo'), findsOneWidget);
    });

    testWidgets('a photo that fails to upload says so and can be retaken', (
      tester,
    ) async {
      final calls = _Calls();
      var attempt = 0;
      await _pump(
        tester,
        MarkDeliveredSheet(
          businessId: 'b1',
          line: _line('l1'),
          access: PackageAccess.deliveriesOnly,
          service: calls.service,
          askPickupCode: true,
          photoCapture: () async => _png,
          photoUploader: ({required businessId, required bytes}) async {
            attempt++;
            if (attempt == 1) throw Exception('socket');
            return 'packagePhotos/b1/u-agent/ABCDEFGHIJKLMNOPQRST.png';
          },
        ),
      );
      await _tap(tester, 'delivery-without-code');
      await _tap(tester, 'delivery-take-photo');
      expect(find.byKey(const Key('delivery-photo-error')), findsOneWidget);
      expect(find.byKey(const Key('delivery-photo-thumb')), findsNothing);
      await _tap(tester, 'delivery-take-photo');
      expect(find.byKey(const Key('delivery-photo-error')), findsNothing);
      expect(find.text('Photo added'), findsOneWidget);
    });

    testWidgets('no switch, no code: the sheet is as before, plus the money', (
      tester,
    ) async {
      final calls = _Calls();
      await _pump(
        tester,
        _sheet(
          calls,
          askPickupCode: false,
          access: PackageAccess.full,
          line: _line('l1', extra: {'priceCents': 10000, 'paidCents': 6000}),
        ),
      );
      expect(find.byKey(const Key('delivery-pickup-code')), findsNothing);
      expect(find.byKey(const Key('delivery-without-code')), findsNothing);
      // A manager sees what is owed beside "Collected now".
      expect(find.text(r'Owes $40.00'), findsOneWidget);
      expect(find.byKey(const Key('delivery-balance-warning')), findsOneWidget);
      // The field takes digits only; what the server still refuses shows
      // at the field, in the app's words.
      calls.respond = (_) => throw _refuse('collected_cents_invalid');
      await tester.enterText(
        find.byKey(const Key('delivery-collected-now')),
        '40',
      );
      await _tap(tester, 'delivery-confirm');
      expect(calls.payloads.single['collectedCents'], 4000);
      expect(calls.payloads.single['acknowledgeBalance'], isTrue);
      expect(
        find.text('Enter the amount collected in dollars, zero or more.'),
        findsOneWidget,
      );
      expect(find.byType(MarkDeliveredSheet), findsOneWidget);
    });

    testWidgets('reads in French', (tester) async {
      final calls = _Calls();
      await _pump(tester, _sheet(calls), locale: const Locale('fr'), width: 320);
      expect(find.text('Code de retrait'), findsOneWidget);
      expect(find.text('Livrer sans code'), findsOneWidget);
      expect(find.text('Encaissé maintenant (USD)'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('the delivered card', () {
    testWidgets('says "Delivered without code" and shows the photo', (
      tester,
    ) async {
      final asked = <String>[];
      await _pump(
        tester,
        PackageDeliveredCard(
          line: _line('l1', extra: {
            'deliveredAt': DateTime(2026, 10, 21, 9, 30),
            'deliveredByName': 'Kofi Mensah',
            'collectedBy': 'Mamadou Bah',
          }),
          canSeeMoney: false,
          deliveredWithoutCode: true,
          deliveredPhotoPath: 'packagePhotos/b1/u-agent/ABCDEFGHIJKLMNOPQRST.png',
          photoUrl: (path) async {
            asked.add(path);
            return '';
          },
        ),
      );
      expect(find.text('Delivered without code'), findsOneWidget);
      expect(find.byKey(const Key('delivered-photo')), findsOneWidget);
      expect(asked, ['packagePhotos/b1/u-agent/ABCDEFGHIJKLMNOPQRST.png']);
    });

    testWidgets('says nothing of a code when it was used', (tester) async {
      await _pump(
        tester,
        PackageDeliveredCard(
          line: _line('l1', extra: {'deliveredAt': DateTime(2026, 10, 21)}),
          canSeeMoney: false,
        ),
      );
      expect(find.byKey(const Key('delivered-without-code')), findsNothing);
      expect(find.byKey(const Key('delivered-photo')), findsNothing);
    });
  });

  group('the Deliveries home', () {
    Future<_Source> open(
      WidgetTester tester, {
      PackageProofSettings proof = const PackageProofSettings(pickupCode: true),
      _Calls? calls,
      Locale locale = const Locale('en'),
    }) async {
      final source = _Source();
      addTearDown(() {
        source.containers.close();
        source.lines.close();
        source.proof.close();
      });
      // A plain pump: settling would run the 15 s safety timer out before
      // the fake source has answered.
      tester.view.physicalSize = const Size(400, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.light,
          locale: locale,
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          home: DeliveriesHomeScreen(
            // A fresh screen per open: the same type in the same place
            // would keep the previous State (and its data).
            key: UniqueKey(),
            businessId: 'b1',
            access: PackageAccess.deliveriesOnly,
            source: source,
            deliveryService: (calls ?? _Calls()).service,
            photoCapture: () async => _png,
            photoUploader: ({required businessId, required bytes}) async =>
                'packagePhotos/b1/u-agent/ABCDEFGHIJKLMNOPQRST.png',
            cameraEnabled: false,
          ),
        ),
      );
      await tester.pump();
      source.proof.add(proof);
      await tester.pump();
      return source;
    }

    void feed(_Source source) {
      source.containers.add([
        ArrivedContainer(
          container: _container('air', number: '', label: 'Flight 12',
              lineCount: 1),
          isAir: true,
        ),
        ArrivedContainer(container: _container('sea', delivered: 1)),
      ]);
      source.lines.add([
        HandoverLine(
          line: _line('l3', containerId: 'air', code: 'CL-Q7F3W9'),
          hasPickupCode: true,
        ),
        HandoverLine(line: _line('l1', containerId: 'sea')),
        HandoverLine(
          line: _line('l2', containerId: 'sea', extra: {
            'deliveredAt': DateTime(2026, 10, 20),
          }),
        ),
      ]);
    }

    testWidgets('lists what is ready to hand over, shipment or container', (
      tester,
    ) async {
      final source = await open(tester);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      feed(source);
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('deliveries-scan')), findsOneWidget);
      expect(find.text('Enter a code'), findsOneWidget);
      expect(find.text('To hand over · 2'), findsOneWidget);
      expect(find.text('Shipment · Flight 12'), findsOneWidget);
      expect(find.text('Container · MSKU1234567'), findsOneWidget);
      expect(find.text('1 of 2 delivered'), findsOneWidget);
      expect(find.text('CL-Q7F3W9'), findsOneWidget);
      expect(find.text('Mariama Bah · +224621234567'), findsNWidgets(2));
      expect(find.text('3 pieces'), findsNWidgets(2));
      // The delivered line is not offered.
      expect(find.byKey(const ValueKey('deliveries-line:l2')), findsNothing);
      // Never a price or a code.
      expect(_allText(tester), isNot(contains(r'$')));
      expect(_allText(tester), isNot(contains('4821')));
    });

    testWidgets('a tap opens the sheet, with the code when the line has one', (
      tester,
    ) async {
      final calls = _Calls();
      final source = await open(tester, calls: calls);
      feed(source);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('deliveries-line:l3')));
      await tester.pumpAndSettle();
      expect(find.byType(MarkDeliveredSheet), findsOneWidget);
      expect(find.byKey(const Key('delivery-pickup-code')), findsOneWidget);
      await tester.enterText(
        find.byKey(const Key('delivery-pickup-code')),
        '4821',
      );
      await tester.enterText(
        find.byKey(const Key('delivery-collected-now')),
        '25',
      );
      await _tap(tester, 'delivery-confirm');
      expect(calls.payloads.single['lineId'], 'l3');
      expect(calls.payloads.single['pickupCode'], '4821');
      expect(find.byType(MarkDeliveredSheet), findsNothing);
      expect(find.text(r'Delivered · $25.00 collected'), findsOneWidget);

      // A line without a code is not asked for one.
      await tester.tap(find.byKey(const ValueKey('deliveries-line:l1')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('delivery-pickup-code')), findsNothing);
    });

    testWidgets('the switch off, no code is asked even when one exists', (
      tester,
    ) async {
      final source = await open(tester, proof: const PackageProofSettings());
      feed(source);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('deliveries-line:l3')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('delivery-pickup-code')), findsNothing);
    });

    testWidgets('empty says so; a source that never answers times out', (
      tester,
    ) async {
      final source = await open(tester);
      source.containers.add(const []);
      source.lines.add(const []);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('deliveries-empty')), findsOneWidget);
      expect(find.text('Nothing to hand over right now.'), findsOneWidget);

      await open(tester);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      await tester.pump(const Duration(seconds: 16));
      await tester.pump();
      expect(find.byKey(const Key('deliveries-failed')), findsOneWidget);
      expect(find.byKey(const Key('deliveries-retry')), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
    });

    testWidgets('a typed code must be a package code', (tester) async {
      final source = await open(tester);
      feed(source);
      await tester.pumpAndSettle();
      await _tap(tester, 'deliveries-enter-code');
      await tester.enterText(find.byKey(const Key('deliveries-code')), 'hello');
      await _tap(tester, 'deliveries-code-find');
      expect(find.text('That is not a package code.'), findsOneWidget);
    });

    testWidgets('reads in French on a narrow phone', (tester) async {
      final source = await open(tester, locale: const Locale('fr'));
      feed(source);
      await tester.pumpAndSettle();
      expect(find.text('Livraisons'), findsOneWidget);
      expect(find.text('Scanner une étiquette'), findsOneWidget);
      expect(find.text('Envoi · Flight 12'), findsOneWidget);
      expect(find.text('Conteneur · MSKU1234567'), findsOneWidget);
      expect(find.text('À remettre · 2'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('the counter look-up', () {
    PackageRequest request() => PackageRequest.fromMap('r1', {
      'businessId': 'b1',
      'code': 'R-K7M4P',
      'status': 'confirmed',
      'sender': {'name': 'Fatou Diallo', 'phoneE164': '+19175551234'},
      'receiver': {'name': 'Mariama Bah', 'phoneE164': '+224621234567'},
      'destinationCountryId': 'guinea',
      'destinationCountryName': 'Guinea',
      'pieces': [
        {'id': 'p1', 'kind': 'barrel'},
      ],
    });

    testWidgets('finds the request by its code, however typed', (
      tester,
    ) async {
      final fake = FakePackageRequests()..lookedUp = request();
      PackageRequest? found;
      await _pump(
        tester,
        Builder(
          builder: (context) => TextButton(
            key: const Key('open'),
            onPressed: () async {
              found = await showRequestCodeLookupSheet(
                context,
                businessId: 'b1',
                service: fake,
              );
            },
            child: const Text('open'),
          ),
        ),
      );
      await _tap(tester, 'open');
      expect(find.text('Enter the customer’s code'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('lookup-code')), 'r k7m4p');
      await _tap(tester, 'lookup-find');
      expect(fake.of('receivePackageRequest').single, {
        'businessId': 'b1',
        'action': 'lookup_code',
        'code': 'R-K7M4P',
      });
      expect(found?.id, 'r1');
      expect(find.byType(RequestCodeLookupSheet), findsNothing);
    });

    testWidgets('a code of the wrong shape, then one nobody has', (
      tester,
    ) async {
      final fake = FakePackageRequests();
      await _pump(
        tester,
        RequestCodeLookupSheet(businessId: 'b1', service: fake),
      );
      await tester.enterText(find.byKey(const Key('lookup-code')), 'K7M4');
      await _tap(tester, 'lookup-find');
      expect(
        find.text('A request code has 5 letters or digits, like R-K7M4P.'),
        findsOneWidget,
      );
      expect(fake.calls, isEmpty);

      await tester.enterText(find.byKey(const Key('lookup-code')), 'R-ZZZZZ');
      await _tap(tester, 'lookup-find');
      expect(
        find.text('No request with that code for this business.'),
        findsOneWidget,
      );
    });

    testWidgets('is offered above the Waiting list, Expected or not', (
      tester,
    ) async {
      var taps = 0;
      await _pump(
        tester,
        WaitingPackagesList(
          lines: const [],
          staff: const [],
          anyAtAll: false,
          searching: false,
          onTap: null,
          onPrint: null,
          showLookupCode: true,
          onLookupCode: () => taps++,
        ),
      );
      await _tap(tester, 'waiting-lookup-code');
      expect(taps, 1);
      expect(find.text('Enter the customer’s code'), findsOneWidget);

      await _pump(
        tester,
        WaitingPackagesList(
          lines: const [],
          staff: const [],
          anyAtAll: false,
          searching: false,
          onTap: null,
          onPrint: null,
          expected: [request()],
          showLookupCode: true,
          onLookupCode: () => taps++,
        ),
        locale: const Locale('fr'),
      );
      expect(find.text('Entrer le code du client'), findsOneWidget);
      expect(find.text('Attendus · 1'), findsOneWidget);
    });
  });

  group('the proof switches', () {
    Future<FakePackageRequests> open(
      WidgetTester tester, {
      PackageRequestSettings settings = const PackageRequestSettings(
        requestSlug: 'conakry',
      ),
      bool canEdit = true,
      Locale locale = const Locale('en'),
    }) async {
      final fake = FakePackageRequests()..settings = settings;
      await _pump(
        tester,
        PackageRequestSettingsScreen(
          businessId: 'b1',
          canEdit: canEdit,
          service: fake,
          locations: (_) => Stream.value(const []),
        ),
        locale: locale,
        scaffold: false,
      );
      return fake;
    }

    testWidgets('three switches, off by default, saved as `proof`', (
      tester,
    ) async {
      final fake = await open(tester);
      expect(find.text('Proof'), findsOneWidget);
      expect(find.text('Photos required at drop-off'), findsOneWidget);
      expect(
        find.text('Ask the sender to confirm by WhatsApp'),
        findsOneWidget,
      );
      expect(find.text('Pickup code at delivery'), findsOneWidget);
      await _tap(tester, 'settings-proof-pickup-code');
      await _tap(tester, 'settings-proof-photos');
      await _tap(tester, 'settings-save');
      final body = fake.of('setPackageRequestSettings').single;
      expect(body['proof'], {
        'photosRequired': true,
        'senderConfirm': false,
        'pickupCode': true,
      });
    });

    testWidgets('read back from the business, and read-only for staff', (
      tester,
    ) async {
      await open(
        tester,
        settings: const PackageRequestSettings(
          requestSlug: 'conakry',
          proof: PackageProofSettings(senderConfirm: true),
        ),
        canEdit: false,
      );
      final tile = tester.widget<SwitchListTile>(
        find.descendant(
          of: find.byKey(const Key('settings-proof-sender')),
          matching: find.byType(SwitchListTile),
        ),
      );
      expect(tile.value, isTrue);
      expect(tile.onChanged, isNull);
    });

    testWidgets('reads in French', (tester) async {
      await open(tester, locale: const Locale('fr'));
      expect(find.text('Preuve'), findsOneWidget);
      expect(find.text('Photos obligatoires au dépôt'), findsOneWidget);
      expect(find.text('Code de retrait à la livraison'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
