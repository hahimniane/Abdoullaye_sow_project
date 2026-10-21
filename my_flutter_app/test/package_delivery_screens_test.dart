import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/destination_country.dart';
import 'package:my_flutter_app/screens/containers_screen.dart';
import 'package:my_flutter_app/screens/package_result_screen.dart';
import 'package:my_flutter_app/services/container_delivery.dart';
import 'package:my_flutter_app/services/container_delivery_service.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/container_packages.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/package_delivery_widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Marking a package delivered at the destination, as destination staff do
/// it: from the package page a scan opens, through the Mark delivered sheet
/// (who collected it, the unpaid-balance warning), and undone by a manager.
/// A deliveries-only person never sees an amount. The callable is a fake
/// caller handed to `ContainerDeliveryService`.

final _arrived = ShippingContainer.fromMap('c1', {
  'businessId': 'b1',
  'label': 'Sailing 3 Oct, box 2',
  'containerNumber': 'MSKU1234567',
  'status': containerStatusArrived,
  'destinationCountryId': 'guinea',
  'destinationCountryName': 'Guinea',
  'sailedAt': DateTime(2026, 10, 3, 14, 15),
  'arrivedAt': DateTime(2026, 10, 19, 9),
  'lineCount': 12,
  'deliveredCount': 3,
});

ContainerLine _line([Map<String, dynamic> extra = const {}]) =>
    ContainerLine.fromMap('l1', {
      'businessId': 'b1',
      'containerId': 'c1',
      'containerStatus': containerStatusArrived,
      'kind': containerLineKindBarrels,
      'quantity': 3,
      'ownerKind': containerOwnerCustomer,
      'customerName': 'Fatou Diallo',
      'customerPhone': '+19175551234',
      'receiverName': 'Mariama Bah',
      'receiverPhone': '+224621234567',
      'trackingCode': 'CL-K7M4P2',
      ...extra,
    });

/// $100.00 of which $60.00 is paid: $40.00 still owed.
ContainerLine _owing([Map<String, dynamic> extra = const {}]) =>
    _line({'priceCents': 10000, 'paidCents': 6000, ...extra});

ContainerLine _delivered([Map<String, dynamic> extra = const {}]) => _line({
  'deliveredAt': DateTime(2026, 10, 21, 9, 30),
  'deliveredByStaffId': 'u-kofi',
  'deliveredByName': 'Kofi Mensah',
  'collectedBy': 'Mamadou Bah',
  ...extra,
});

class _Repo implements ContainerPackageRepository {
  _Repo(this.line, [this.container]);

  final ContainerLine line;
  final ShippingContainer? container;

  @override
  Future<ContainerLine?> findLineByCode(String businessId, String code) async =>
      line.trackingCode == code ? line : null;

  @override
  Stream<ContainerLine?> watchLineByCode(String businessId, String code) =>
      Stream.fromFuture(findLineByCode(businessId, code));

  @override
  Stream<ContainerLine?> watchLine(String lineId) =>
      Stream.value(line.id == lineId ? line : null);

  @override
  Stream<ShippingContainer?> watchContainer(String containerId) =>
      Stream.value(container?.id == containerId ? container : null);

  @override
  Stream<List<ContainerLine>> watchLines(String businessId) =>
      Stream.value([line]);

  @override
  Stream<List<ShippingContainer>> watchContainers(String businessId) =>
      Stream.value([?container]);

  @override
  Future<String> businessCountryCode(String businessId) async => 'US';

  @override
  Future<List<DestinationCountry>> destinations(String businessId) async =>
      const [];
}

/// The callable, answered in place of Firebase: records every payload and
/// answers with [respond] (or a plain success).
class _Calls {
  final payloads = <Map<String, Object?>>[];
  Object? Function(Map<String, Object?> payload)? respond;

  Future<Object?> call(String name, Map<String, Object?> payload) async {
    expect(name, 'updateContainerLine');
    payloads.add(payload);
    final answer = respond;
    if (answer != null) return answer(payload);
    return payload['action'] == deliveryActionUndo
        ? {'success': true, 'lineId': payload['lineId'], 'undone': true}
        : {
            'success': true,
            'lineId': payload['lineId'],
            'delivered': true,
            'alreadyDelivered': false,
            'collectedBy': payload['collectedBy'],
            'hasBalance': false,
            'balanceCents': 0,
          };
  }

  ContainerDeliveryService get service =>
      ContainerDeliveryService(caller: call);
}

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
  bool scaffold = true,
}) async {
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
      home: scaffold ? Scaffold(body: SafeArea(child: child)) : child,
    ),
  );
  await tester.pumpAndSettle();
}

Widget _screen(
  ContainerLine line,
  _Calls calls, {
  PackageAccess access = PackageAccess.full,
  ShippingContainer? container,
}) => PackageResultScreen(
  businessId: 'b1',
  code: 'CL-K7M4P2',
  repository: _Repo(line, container ?? _arrived),
  access: access,
  deliveryService: calls.service,
);

Future<void> _openSheet(WidgetTester tester) async {
  await tester.tap(find.byKey(const Key('pkg-mark-delivered')));
  await tester.pumpAndSettle();
  expect(find.byType(MarkDeliveredSheet), findsOneWidget);
}

/// Every piece of text on screen, joined: a price, a payment or a balance
/// would show a dollar sign somewhere in it.
String _allText(WidgetTester tester) => [
  for (final w in tester.widgetList<Text>(find.byType(Text)))
    w.data ?? w.textSpan?.toPlainText() ?? '',
  for (final w in tester.widgetList<RichText>(find.byType(RichText)))
    w.text.toPlainText(),
  for (final w in tester.widgetList<EditableText>(find.byType(EditableText)))
    w.controller.text,
].join('\n');

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('mark delivered', () {
    testWidgets('a manager sees the amount owed and records who collected it', (
      tester,
    ) async {
      final calls = _Calls();
      await _pump(tester, _screen(_owing(), calls), scaffold: false);

      // The package page leads with handing it over.
      expect(find.byKey(const Key('pkg-ready-for-delivery')), findsOneWidget);
      expect(find.text('Mark delivered'), findsOneWidget);
      await _openSheet(tester);

      // Prefilled with the receiver; editable for whoever collects for them.
      final field = find.byKey(const Key('delivery-collected-by'));
      expect(tester.widget<TextField>(field).controller!.text, 'Mariama Bah');
      expect(find.text('3 barrels for Mariama Bah'), findsOneWidget);
      // The balance: a warning with the amount, never a block.
      expect(find.byKey(const Key('delivery-balance-warning')), findsOneWidget);
      expect(find.text(r'This package still owes $40.00.'), findsOneWidget);
      expect(find.text('Deliver anyway'), findsOneWidget);

      await tester.enterText(field, 'Mamadou Bah');
      await tester.tap(find.byKey(const Key('delivery-confirm')));
      await tester.pumpAndSettle();

      expect(calls.payloads, [
        {
          'businessId': 'b1',
          'lineId': 'l1',
          'action': 'deliver',
          'collectedBy': 'Mamadou Bah',
          'acknowledgeBalance': true,
        },
      ]);
      expect(find.byType(MarkDeliveredSheet), findsNothing);
      expect(find.text('Marked delivered.'), findsOneWidget);
    });

    testWidgets('a paid package is delivered without a warning', (
      tester,
    ) async {
      final calls = _Calls();
      await _pump(
        tester,
        _screen(_line({'priceCents': 5000, 'paidCents': 5000}), calls),
        scaffold: false,
      );
      await _openSheet(tester);
      expect(find.byKey(const Key('delivery-balance-warning')), findsNothing);
      await tester.tap(find.byKey(const Key('delivery-confirm')));
      await tester.pumpAndSettle();
      expect(calls.payloads.single['acknowledgeBalance'], isFalse);
      expect(calls.payloads.single['collectedBy'], 'Mariama Bah');
    });

    testWidgets('a balance only the server saw is shown, then confirmed', (
      tester,
    ) async {
      final calls = _Calls();
      var first = true;
      calls.respond = (payload) {
        if (first) {
          first = false;
          throw FirebaseFunctionsException(
            message: 'This package still has an unpaid balance.',
            code: 'failed-precondition',
            details: {
              'reason': 'delivery_balance_due',
              'hasBalance': true,
              'balanceCents': 2500,
            },
          );
        }
        return {
          'success': true,
          'lineId': 'l1',
          'delivered': true,
          'alreadyDelivered': false,
          'collectedBy': 'Mariama Bah',
          'hasBalance': true,
          'balanceCents': 2500,
        };
      };
      // No price on the phone: it cannot see a balance itself.
      await _pump(tester, _screen(_line(), calls), scaffold: false);
      await _openSheet(tester);
      expect(find.byKey(const Key('delivery-balance-warning')), findsNothing);
      await tester.tap(find.byKey(const Key('delivery-confirm')));
      await tester.pumpAndSettle();

      // Still open, now warning - in the app's words, with the amount.
      expect(find.byType(MarkDeliveredSheet), findsOneWidget);
      expect(find.text(r'This package still owes $25.00.'), findsOneWidget);
      expect(find.textContaining('Confirm to mark it'), findsNothing);
      await tester.tap(find.text('Deliver anyway'));
      await tester.pumpAndSettle();

      expect(calls.payloads.map((p) => p['acknowledgeBalance']).toList(), [
        false,
        true,
      ]);
      expect(find.byType(MarkDeliveredSheet), findsNothing);
    });

    testWidgets('a refusal reads in the app words, not the server message', (
      tester,
    ) async {
      final calls = _Calls()
        ..respond = (_) => throw FirebaseFunctionsException(
          message: 'SERVER ENGLISH',
          code: 'failed-precondition',
          details: {'reason': 'delivery_not_arrived'},
        );
      await _pump(tester, _screen(_line(), calls), scaffold: false);
      await _openSheet(tester);
      await tester.tap(find.byKey(const Key('delivery-confirm')));
      await tester.pumpAndSettle();
      expect(
        find.text(
          'A package can be marked delivered once its container is ready '
          'for pickup.',
        ),
        findsOneWidget,
      );
      expect(find.textContaining('SERVER ENGLISH'), findsNothing);
      // The button is pressable again.
      expect(find.text('Mark delivered'), findsWidgets);
    });

    testWidgets('a name longer than 120 characters is refused on the phone', (
      tester,
    ) async {
      final calls = _Calls();
      await _pump(tester, _screen(_line(), calls), scaffold: false);
      await _openSheet(tester);
      await tester.enterText(
        find.byKey(const Key('delivery-collected-by')),
        'a' * 121,
      );
      await tester.tap(find.byKey(const Key('delivery-confirm')));
      await tester.pumpAndSettle();
      expect(
        find.text('Keep the name of who collected it to 120 characters.'),
        findsOneWidget,
      );
      expect(calls.payloads, isEmpty);
    });

    testWidgets('not offered before the container is ready for pickup', (
      tester,
    ) async {
      final shipped = ShippingContainer.fromMap('c1', {
        'businessId': 'b1',
        'status': containerStatusShipped,
        'lineCount': 4,
      });
      await _pump(
        tester,
        _screen(
          _line({'containerStatus': containerStatusShipped}),
          _Calls(),
          container: shipped,
        ),
        scaffold: false,
      );
      expect(find.byKey(const Key('pkg-mark-delivered')), findsNothing);
      expect(find.byKey(const Key('pkg-print-labels')), findsOneWidget);
    });
  });

  group('a deliveries-only person', () {
    testWidgets('never sees a price, a payment or an amount owed', (
      tester,
    ) async {
      final calls = _Calls();
      await _pump(
        tester,
        _screen(_owing(), calls, access: PackageAccess.deliveriesOnly),
        scaffold: false,
      );
      // Who it is for, where it is: yes. Money, edits, labels, the
      // container page: no.
      expect(find.text('Mariama Bah'), findsOneWidget);
      expect(find.byKey(const Key('pkg-call-receiver')), findsOneWidget);
      expect(find.text('MSKU1234567'), findsOneWidget);
      expect(find.byKey(const Key('pkg-money')), findsNothing);
      expect(find.byKey(const Key('pkg-price-payments')), findsNothing);
      expect(find.byKey(const Key('pkg-print-labels')), findsNothing);
      expect(find.byKey(const Key('pkg-edit-contacts')), findsNothing);
      expect(find.byKey(const Key('pkg-edit-line')), findsNothing);
      expect(find.byKey(const Key('pkg-open-container')), findsNothing);
      expect(_allText(tester), isNot(contains(r'$')));

      await _openSheet(tester);
      expect(
        find.text(
          'This package still has an unpaid balance — check with the office.',
        ),
        findsOneWidget,
      );
      expect(_allText(tester), isNot(contains(r'$')));
      await tester.tap(find.byKey(const Key('delivery-confirm')));
      await tester.pumpAndSettle();
      expect(calls.payloads.single['acknowledgeBalance'], isTrue);
      expect(find.text('Marked delivered.'), findsOneWidget);
    });

    testWidgets('a balance the server reports still shows no amount', (
      tester,
    ) async {
      final calls = _Calls()
        ..respond = (_) => throw FirebaseFunctionsException(
          message: 'balance',
          code: 'failed-precondition',
          details: {
            'reason': 'delivery_balance_due',
            'hasBalance': true,
            'balanceCents': null,
          },
        );
      await _pump(
        tester,
        _screen(_line(), calls, access: PackageAccess.deliveriesOnly),
        scaffold: false,
      );
      await _openSheet(tester);
      await tester.tap(find.byKey(const Key('delivery-confirm')));
      await tester.pumpAndSettle();
      expect(
        find.text(
          'This package still has an unpaid balance — check with the office.',
        ),
        findsOneWidget,
      );
      expect(_allText(tester), isNot(contains(r'$')));
    });

    testWidgets('sees the delivery but no Undo, and no amount owed then', (
      tester,
    ) async {
      await _pump(
        tester,
        packageResultViewForTesting(
          line: _delivered({'deliveredBalanceCents': 4000}),
          container: _arrived,
          access: PackageAccess.deliveriesOnly,
          onUndoDelivery: null,
        ),
      );
      expect(find.byKey(const Key('pkg-delivered')), findsOneWidget);
      expect(find.text('Collected by Mamadou Bah'), findsOneWidget);
      expect(find.byKey(const Key('pkg-undo-delivery')), findsNothing);
      expect(find.byKey(const Key('delivered-owed')), findsNothing);
      expect(_allText(tester), isNot(contains(r'$')));
    });
  });

  group('delivered', () {
    testWidgets('says when, who handed it over and who collected it', (
      tester,
    ) async {
      await _pump(
        tester,
        packageResultViewForTesting(
          line: _delivered({'deliveredBalanceCents': 4000}),
          container: _arrived,
          onUndoDelivery: () {},
        ),
      );
      expect(find.byKey(const Key('pkg-delivered-pill')), findsOneWidget);
      // US month-first, 12-hour (date_display).
      expect(
        find.textContaining(RegExp(r'Delivered Oct 21, 2026 9:30\sAM')),
        findsOneWidget,
      );
      expect(find.text('Handed over by Kofi Mensah'), findsOneWidget);
      expect(find.text('Collected by Mamadou Bah'), findsOneWidget);
      expect(
        find.text(r'$40.00 was still owed when it was handed over'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('pkg-undo-delivery')), findsOneWidget);
      expect(find.byKey(const Key('pkg-mark-delivered')), findsNothing);
    });

    testWidgets('a manager undoes it after confirming', (tester) async {
      final calls = _Calls();
      await _pump(tester, _screen(_delivered(), calls), scaffold: false);
      await tester.tap(find.byKey(const Key('pkg-undo-delivery')));
      await tester.pumpAndSettle();
      expect(find.text('Undo this delivery?'), findsOneWidget);
      expect(calls.payloads, isEmpty, reason: 'nothing before the confirm');
      await tester.tap(
        find.descendant(
          of: find.byType(AlertDialog),
          matching: find.text('Undo delivery'),
        ),
      );
      await tester.pumpAndSettle();
      expect(calls.payloads, [
        {'businessId': 'b1', 'lineId': 'l1', 'action': 'undo_delivery'},
      ]);
      expect(find.text('Delivery undone.'), findsOneWidget);
    });

    testWidgets('a manager sees Undo, a deliveries-only person does not', (
      tester,
    ) async {
      await _pump(
        tester,
        _screen(_delivered(), _Calls(), access: PackageAccess.deliveriesOnly),
        scaffold: false,
      );
      expect(find.byKey(const Key('pkg-delivered')), findsOneWidget);
      expect(find.byKey(const Key('pkg-undo-delivery')), findsNothing);
    });

    testWidgets('the delivered WhatsApp update is named', (tester) async {
      await _pump(
        tester,
        packageResultViewForTesting(
          line: _delivered({
            'lastCustomerUpdate': {
              'update': 'delivered',
              'results': [
                {'role': 'receiver', 'status': 'sent'},
              ],
            },
          }),
          container: _arrived,
        ),
      );
      expect(find.text('Last update: delivered'), findsOneWidget);
    });
  });

  group('containers', () {
    testWidgets('a container ready for pickup says how many were delivered', (
      tester,
    ) async {
      await _pump(tester, containerCardForTesting(container: _arrived));
      expect(find.text('3 of 12 delivered'), findsOneWidget);
    });

    testWidgets('a box still at sea says nothing about deliveries', (
      tester,
    ) async {
      await _pump(
        tester,
        containerCardForTesting(
          container: ShippingContainer.fromMap('c2', {
            'status': containerStatusShipped,
            'lineCount': 12,
          }),
        ),
      );
      expect(find.textContaining('delivered'), findsNothing);
    });

    testWidgets('a line on an arrived box offers Mark delivered and Undo', (
      tester,
    ) async {
      await _pump(
        tester,
        containerLineActionsSheetForTesting(
          line: _line(),
          open: false,
          canDeliver: true,
        ),
      );
      expect(find.byKey(const Key('line-mark-delivered')), findsOneWidget);
      expect(find.byKey(const Key('line-undo-delivery')), findsNothing);
      await _pump(
        tester,
        containerLineActionsSheetForTesting(
          line: _delivered(),
          open: false,
          canUndoDelivery: true,
        ),
      );
      expect(find.byKey(const Key('line-mark-delivered')), findsNothing);
      expect(find.byKey(const Key('line-undo-delivery')), findsOneWidget);
    });

    testWidgets('a delivered line carries its Delivered pill', (tester) async {
      await _pump(
        tester,
        containerLineCardForTesting(
          line: _delivered(),
          delivery: const DeliveredPill(key: Key('line-pill')),
        ),
      );
      expect(find.byKey(const Key('line-pill')), findsOneWidget);
      expect(find.text('Delivered'), findsOneWidget);
    });
  });

  group('in French', () {
    testWidgets('the sheet, the warning and the progress', (tester) async {
      await _pump(
        tester,
        _screen(_owing(), _Calls(), access: PackageAccess.deliveriesOnly),
        locale: const Locale('fr'),
        scaffold: false,
      );
      expect(find.text('Marquer comme livré'), findsOneWidget);
      expect(find.text('Livraison'), findsOneWidget);
      await _openSheet(tester);
      expect(find.text('Récupéré par'), findsOneWidget);
      expect(
        find.text(
          'Ce colis a encore un solde impayé — vérifiez auprès du bureau.',
        ),
        findsOneWidget,
      );
      expect(find.text('Livrer quand même'), findsOneWidget);
    });

    testWidgets('delivered, undo and X sur Y livrés', (tester) async {
      await _pump(
        tester,
        Column(
          children: [
            containerCardForTesting(container: _arrived),
            Expanded(
              child: packageResultViewForTesting(
                line: _delivered(),
                container: _arrived,
                onUndoDelivery: () {},
              ),
            ),
          ],
        ),
        locale: const Locale('fr'),
      );
      expect(find.text('3 sur 12 livrés'), findsOneWidget);
      expect(find.textContaining('Livré le '), findsOneWidget);
      expect(find.text('Remis par Kofi Mensah'), findsOneWidget);
      expect(find.text('Récupéré par Mamadou Bah'), findsOneWidget);
      expect(find.text('Annuler la livraison'), findsOneWidget);
      expect(find.text('Livré'), findsOneWidget);
    });

    testWidgets('a refusal in French', (tester) async {
      final calls = _Calls()
        ..respond = (_) => throw FirebaseFunctionsException(
          message: 'That package no longer exists.',
          code: 'not-found',
          details: {'reason': 'line_not_found'},
        );
      await _pump(
        tester,
        _screen(_line(), calls),
        locale: const Locale('fr'),
        scaffold: false,
      );
      await _openSheet(tester);
      await tester.tap(find.byKey(const Key('delivery-confirm')));
      await tester.pumpAndSettle();
      expect(find.text('Ce colis n’existe plus.'), findsOneWidget);
    });
  });
}
