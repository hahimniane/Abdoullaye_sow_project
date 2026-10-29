import 'dart:io';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/container_delivery.dart';
import 'package:my_flutter_app/services/container_delivery_service.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/waiting_packages.dart';
import 'package:my_flutter_app/utils/business_permissions.dart';

/// The delivered-at-destination rules the app mirrors from
/// `functions/container_delivery.js`: who may deliver, undo and see money;
/// when a package can be handed over; who collected it; the balance warning;
/// the callable's requests, answers and refusals; and "X of Y delivered".

ShippingContainer _box(String status, {int lines = 4, int delivered = 0}) =>
    ShippingContainer.fromMap('c1', {
      'businessId': 'b1',
      'label': 'Sailing 3 Oct, box 2',
      'status': status,
      'lineCount': lines,
      'deliveredCount': delivered,
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

void main() {
  group('who may do what', () {
    test('owners and admins (not staff) may do everything', () {
      final access = PackageAccess.of(isStaff: false, permissions: const []);
      expect(access, PackageAccess.full);
    });

    test('containers staff are managers: deliver, undo, money', () {
      final access = PackageAccess.of(
        isStaff: true,
        permissions: const [BusinessPermission.containers],
      );
      expect(access, PackageAccess.full);
    });

    test('deliveries-only staff deliver, never undo, never see money', () {
      final access = PackageAccess.of(
        isStaff: true,
        permissions: const [BusinessPermission.deliveries],
      );
      expect(access, PackageAccess.deliveriesOnly);
      expect(access.canDeliver, isTrue);
      expect(access.canUndoDelivery, isFalse);
      expect(access.canSeeMoney, isFalse);
      expect(access.restricted, isTrue);
    });

    test('deliveries + ledger see the amount but stay restricted', () {
      final access = PackageAccess.of(
        isStaff: true,
        permissions: const [
          BusinessPermission.deliveries,
          BusinessPermission.ledger,
        ],
      );
      expect(access.canSeeMoney, isTrue);
      expect(access.canUndoDelivery, isFalse);
      expect(access.restricted, isTrue);
    });

    test('staff with neither permission may not deliver', () {
      final access = PackageAccess.of(
        isStaff: true,
        permissions: const [BusinessPermission.ledger],
      );
      expect(access.canDeliver, isFalse);
      expect(canDeliverPackages(isStaff: true, permissions: const []), isFalse);
    });
  });

  group('when a package can be handed over', () {
    test('only on a container that is ready for pickup', () {
      expect(deliveryRefusal(_line(), _box(containerStatusArrived)), isNull);
      for (final status in [containerStatusLoading, containerStatusShipped]) {
        expect(
          deliveryRefusal(_line(), _box(status)),
          DeliveryReason.notArrived,
        );
      }
    });

    test('not a waiting package, nor one whose container is unknown', () {
      final waiting = _line({
        'containerId': '',
        'containerStatus': containerLineStatusWaiting,
      });
      expect(deliveryRefusal(waiting, null), DeliveryReason.notArrived);
      expect(deliveryRefusal(_line(), null), DeliveryReason.notArrived);
    });

    test('Mark delivered: allowed, ready, and not delivered yet', () {
      final arrived = _box(containerStatusArrived);
      expect(canMarkDelivered(_line(), arrived, PackageAccess.full), isTrue);
      expect(
        canMarkDelivered(_line(), arrived, PackageAccess.deliveriesOnly),
        isTrue,
      );
      final delivered = _line({'deliveredAt': DateTime(2026, 10, 21, 9)});
      expect(canMarkDelivered(delivered, arrived, PackageAccess.full), isFalse);
      const none = PackageAccess(
        canDeliver: false,
        canUndoDelivery: false,
        canSeeMoney: false,
        restricted: true,
      );
      expect(canMarkDelivered(_line(), arrived, none), isFalse);
    });

    test('Undo: a delivered package, for a manager only', () {
      final delivered = _line({'deliveredAt': DateTime(2026, 10, 21, 9)});
      expect(canUndoDelivery(delivered, PackageAccess.full), isTrue);
      expect(canUndoDelivery(delivered, PackageAccess.deliveriesOnly), isFalse);
      expect(canUndoDelivery(_line(), PackageAccess.full), isFalse);
    });
  });

  group('the line and the container read their delivery fields', () {
    test('a delivered line', () {
      final line = _line({
        'deliveredAt': DateTime(2026, 10, 21, 9, 30),
        'deliveredByStaffId': 'u-kofi',
        'deliveredByName': 'Kofi Mensah',
        'collectedBy': 'Mamadou Bah',
        'deliveredBalanceCents': 4000,
      });
      expect(line.isDelivered, isTrue);
      expect(line.deliveredAt, DateTime(2026, 10, 21, 9, 30));
      expect(line.deliveredByStaffId, 'u-kofi');
      expect(line.deliveredByName, 'Kofi Mensah');
      expect(line.collectedBy, 'Mamadou Bah');
      expect(line.deliveredBalanceCents, 4000);
    });

    test('an undone delivery is not delivered and says who undid it', () {
      final line = _line({
        'deliveryUndoneAt': DateTime(2026, 10, 21, 10),
        'deliveryUndoneByStaffId': 'u-owner',
      });
      expect(line.isDelivered, isFalse);
      expect(line.deliveryUndoneAt, DateTime(2026, 10, 21, 10));
      expect(line.deliveryUndoneByStaffId, 'u-owner');
      expect(line.collectedBy, '');
    });

    test('a container without deliveredCount has delivered nothing', () {
      final box = ShippingContainer.fromMap('c1', {
        'status': containerStatusArrived,
        'lineCount': 5,
      });
      expect(box.deliveredCount, 0);
      expect(containerDeliveryProgress(box).delivered, 0);
      expect(containerDeliveryProgress(box).total, 5);
    });

    test('the delivered WhatsApp update is a moment of its own', () {
      final line = _line({
        'lastCustomerUpdate': {'update': 'delivered', 'results': const []},
      });
      expect(line.lastCustomerUpdate?.update, containerUpdateDelivered);
    });
  });

  group('X of Y delivered', () {
    test('never above the total', () {
      final p = containerDeliveryProgress(
        _box(containerStatusArrived, lines: 3, delivered: 5),
      );
      expect((p.delivered, p.total, p.complete), (3, 3, true));
    });

    test(
      'shown once ready for pickup, or whenever something was delivered',
      () {
        expect(showsDeliveryProgress(_box(containerStatusArrived)), isTrue);
        expect(showsDeliveryProgress(_box(containerStatusShipped)), isFalse);
        expect(
          showsDeliveryProgress(_box(containerStatusShipped, delivered: 1)),
          isTrue,
        );
        expect(
          showsDeliveryProgress(_box(containerStatusArrived, lines: 0)),
          isFalse,
        );
      },
    );
  });

  group('collected by', () {
    test('starts with the receiver, else the customer', () {
      expect(collectedByDefault(_line()), 'Mariama Bah');
      expect(collectedByDefault(_line({'receiverName': ''})), 'Fatou Diallo');
    });

    test('one line, at most 120 characters', () {
      expect(deliveryOneLine('  Mamadou\n Bah  '), 'Mamadou Bah');
      expect(collectedByErrors('a' * 120), isEmpty);
      expect(collectedByErrors('a' * 121), [DeliveryReason.collectedByTooLong]);
    });
  });

  group('the balance warning', () {
    test('the whole group owes what the root was not paid', () {
      final root = _line({'priceCents': 10000, 'paidCents': 6000});
      final part = ContainerLine.fromMap('l2', {
        'businessId': 'b1',
        'containerId': 'c1',
        'kind': containerLineKindBarrels,
        'quantity': 1,
        'rootLineId': 'l1',
        'partIndex': 2,
        'priceCents': 2000,
      });
      final groups = lineGroupsByRoot([root, part]);
      expect(deliveryBalanceCents(part, groups['l1']), 6000);
      expect(deliveryBalanceCents(root, null), 4000);
    });

    test('a part read without its root leaves it to the server', () {
      final part = ContainerLine.fromMap('l2', {
        'businessId': 'b1',
        'containerId': 'c1',
        'kind': containerLineKindBarrels,
        'quantity': 1,
        'rootLineId': 'l1',
        'partIndex': 2,
        'priceCents': 2000,
      });
      expect(deliveryBalanceCents(part, lineGroupOf(part, const {})), 0);
      expect(deliveryBalanceCents(part, null), 0);
    });

    test('the amount only for someone who may see money', () {
      final manager = deliveryBalanceNotice(
        balanceCents: 4000,
        canSeeMoney: true,
      );
      expect(manager.kind, DeliveryBalanceNoticeKind.amount);
      expect(manager.balanceCents, 4000);
      final deliveries = deliveryBalanceNotice(
        balanceCents: 4000,
        canSeeMoney: false,
      );
      expect(deliveries.kind, DeliveryBalanceNoticeKind.unpaid);
      expect(deliveries.balanceCents, isNull);
      expect(
        deliveryBalanceNotice(balanceCents: 0, canSeeMoney: true).warns,
        isFalse,
      );
    });
  });

  group('the callable', () {
    test('deliver and undo requests', () {
      expect(
        deliverLineRequest(
          'b1',
          'l1',
          collectedBy: ' Mamadou\nBah ',
          acknowledgeBalance: true,
        ),
        {
          'businessId': 'b1',
          'lineId': 'l1',
          'action': 'deliver',
          'collectedBy': 'Mamadou Bah',
          'acknowledgeBalance': true,
        },
      );
      expect(undoDeliveryRequest('b1', 'l1'), {
        'businessId': 'b1',
        'lineId': 'l1',
        'action': 'undo_delivery',
      });
    });

    test('answers read through nested callable maps', () {
      final result = DeliveryResult.fromCallable(<Object?, Object?>{
        'success': true,
        'lineId': 'l1',
        'delivered': true,
        'alreadyDelivered': false,
        'collectedBy': 'Mamadou Bah',
        'hasBalance': true,
        'balanceCents': null,
      });
      expect(result.lineId, 'l1');
      expect(result.alreadyDelivered, isFalse);
      expect(result.collectedBy, 'Mamadou Bah');
      expect(result.hasBalance, isTrue);
      expect(result.balanceCents, isNull);
      expect(undoDeliveryResult({'success': true, 'undone': true}), isTrue);
      expect(undoDeliveryResult({'success': true, 'undone': false}), isFalse);
    });

    test('a refusal keeps its reason and the balance view', () async {
      final service = ContainerDeliveryService(
        caller: (name, payload) async {
          expect(name, 'updateContainerLine');
          throw FirebaseFunctionsException(
            message: 'This package still has an unpaid balance.',
            code: 'failed-precondition',
            details: {
              'reason': 'delivery_balance_due',
              'hasBalance': true,
              'balanceCents': 4000,
            },
          );
        },
      );
      await expectLater(
        service.deliver('b1', 'l1'),
        throwsA(
          isA<DeliveryFailure>()
              .having((f) => f.reason, 'reason', DeliveryReason.balanceDue)
              .having((f) => f.balanceDue, 'balanceDue', isTrue)
              .having((f) => f.balanceCents, 'balanceCents', 4000),
        ),
      );
    });

    test('a refused permission and a dropped connection are told apart', () {
      expect(
        parseDeliveryFailure('permission-denied', null).notAllowed,
        isTrue,
      );
      expect(parseDeliveryFailure('unavailable', null).offline, isTrue);
    });

    test('every refusal the server sends is known to the app', () {
      // DELIVERY_MESSAGES keys, read from the server's source like the other
      // parity tests do.
      final source = File('functions/container_delivery.js').readAsStringSync();
      final block = source
          .split('const DELIVERY_MESSAGES = Object.freeze({')
          .last;
      final body = block.substring(0, block.indexOf('});'));
      final keys = RegExp(r'^  ([a-z_]+):', multiLine: true)
          .allMatches(body)
          .map((m) => m.group(1)!)
          .toSet();
      // `...PROOF_REFUSAL` spreads package_proof.REFUSAL into the map
      // (docs/AIR_PACKAGES.md §4): those keys are refusals too.
      if (body.contains('...PROOF_REFUSAL')) {
        final proof = File('functions/package_proof.js').readAsStringSync();
        final proofBlock = proof.split('const REFUSAL = Object.freeze({').last;
        keys.addAll(
          RegExp(r'^  ([a-z_]+):', multiLine: true)
              .allMatches(proofBlock.substring(0, proofBlock.indexOf('});')))
              .map((m) => m.group(1)!),
        );
      }
      expect(keys, isNotEmpty);
      expect(keys, contains('pickup_code_invalid'));
      expect(DeliveryReason.all.toSet(), keys);
      // And the server's section names are the app's permissions.
      expect(source, contains('const DELIVERIES_SECTION = "deliveries";'));
      expect(BusinessPermission.deliveries, 'deliveries');
      expect(source, contains('const MAX_COLLECTED_BY = 120;'));
      expect(deliveryMaxCollectedBy, 120);
    });
  });

  group('wiring', () {
    String read(String path) => File(path).readAsStringSync();

    test('Deliveries is offered to deliveries-only people, and only them', () {
      final auth = read('lib/providers/auth_provider.dart');
      // Shipping service AND (deliveries OR containers), like Containers.
      expect(
        auth,
        contains('bool get hasDeliveriesAccess => containersAvailable('),
      );
      expect(auth, contains('PackageAccess get packageAccess'));
      final menu = read('lib/screens/home_menu.dart');
      expect(menu, contains("Key('open-deliveries')"));
      expect(
        menu,
        contains(
          'auth.hasDeliveriesAccess &&\n      !auth.hasContainersAccess',
        ),
      );
      // It is the Deliveries home (docs/AIR_PACKAGES.md §5), which opens
      // the scan screen in deliveries mode, in the access the person holds.
      expect(menu, contains('DeliveriesHomeScreen('));
      expect(menu, contains('access: auth.packageAccess,'));
      final home = read('lib/screens/deliveries_home_screen.dart');
      expect(home, contains('PackageScanScreen('));
      expect(home, contains('deliveries: true,'));
    });

    test('a scanned label opens the package for deliveries staff too', () {
      expect(
        read('lib/services/package_link_service.dart'),
        contains('hasContainersPermission: auth.hasDeliveriesAccess,'),
      );
    });

    test('the permission is offered wherever permissions are edited', () {
      for (final path in [
        'lib/screens/add_staff_screen.dart',
        'lib/screens/user_management_screen.dart',
      ]) {
        expect(
          read(path),
          contains('BusinessPermission.deliveries'),
          reason: path,
        );
      }
    });

    test('every delivery string is in both catalogs', () {
      final en = read('lib/l10n/app_en.arb');
      final fr = read('lib/l10n/app_fr.arb');
      final used = RegExp(r'l10n\.((?:dlv|pkgMoment)[A-Za-z0-9]*)')
          .allMatches(
            [
              read('lib/widgets/package_delivery_widgets.dart'),
              read('lib/screens/package_result_screen.dart'),
              read('lib/screens/containers_screen.dart'),
              read('lib/screens/home_menu.dart'),
            ].join('\n'),
          )
          .map((m) => m.group(1)!)
          .toSet();
      expect(used.length, greaterThan(20));
      for (final key in used) {
        expect(en, contains('"$key":'), reason: '$key missing from English');
        expect(fr, contains('"$key":'), reason: '$key missing from French');
      }
    });
  });
}
