import 'dart:convert';
import 'dart:io';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/line_resend.dart';
import 'package:my_flutter_app/services/team_staff.dart';
import 'package:my_flutter_app/services/waiting_filters.dart';

/// The pure rules behind "bring the app up to the website" in shipping and
/// People: undo shipped, WhatsApp Send again and the counter warning, the
/// waiting list's filters, the containers' destination filter, and the team
/// section's permissions, full access and Parking bill link. Each mirrors a
/// console function (named beside it).

ShippingContainer _box(
  String id, {
  String status = 'loading',
  String destination = 'guinea',
  String destinationName = 'Guinea',
  String label = 'Box',
}) => ShippingContainer.fromMap(id, {
  'businessId': 'b1',
  'label': label,
  'status': status,
  'destinationCountryId': destination,
  'destinationCountryName': destinationName,
});

ContainerLine _line(String id, [Map<String, dynamic> extra = const {}]) =>
    ContainerLine.fromMap(id, {
      'businessId': 'b1',
      'containerId': 'c1',
      'containerStatus': 'loading',
      'kind': containerLineKindBarrels,
      'quantity': 1,
      'ownerKind': containerOwnerCustomer,
      'customerName': 'Fatou Diallo',
      'customerPhone': '+19175551234',
      'receiverName': 'Mariama Bah',
      'receiverPhone': '+224621234567',
      'trackingCode': 'CL-$id',
      ...extra,
    });

Map<String, dynamic> _update(List<Map<String, Object?>> results) => {
  'update': 'shipped',
  'results': results,
};

void main() {
  group('Undo shipped (containerUndoShipRefusal, mayUndoShipped)', () {
    final cars = [
      _line('car', {'kind': containerLineKindCar}),
    ];
    final barrels = [_line('b')];

    test('a loading container has nothing to undo', () {
      expect(
        containerUndoShipRefusal(_box('c1'), barrels),
        'container_undo_not_shipped',
      );
    });

    test('a shipped container goes back, whatever is on it', () {
      expect(
        containerUndoShipRefusal(_box('c1', status: 'shipped'), cars),
        isNull,
      );
      expect(
        containerUndoShipRefusal(_box('c1', status: 'shipped'), barrels),
        isNull,
      );
    });

    test('an arrived one goes back unless cars are on it', () {
      expect(
        containerUndoShipRefusal(_box('c1', status: 'arrived'), barrels),
        isNull,
      );
      expect(
        containerUndoShipRefusal(_box('c1', status: 'arrived'), cars),
        'container_undo_has_cars',
      );
    });

    test(
      'the owner (full access included) and an admin may, staff may not',
      () {
        expect(mayUndoShipped(isOwner: true, isAdmin: false), isTrue);
        expect(mayUndoShipped(isOwner: false, isAdmin: true), isTrue);
        expect(mayUndoShipped(isOwner: false, isAdmin: false), isFalse);
      },
    );
  });

  group('Containers filter (filterContainers, destinationFilterOptions)', () {
    final all = [
      _box('a', label: 'A'),
      _box('b', status: 'shipped', label: 'B'),
      _box('c', destination: 'senegal', destinationName: 'Senegal', label: 'C'),
      _box(
        'd',
        status: 'shipped',
        destination: 'senegal',
        destinationName: 'Senegal',
        label: 'D',
      ),
    ];

    List<String> ids(Iterable<ShippingContainer> list) =>
        [for (final c in list) c.id]..sort();

    test('without a destination it is the state filter it always was', () {
      expect(ids(filterContainers(all, 'loading')), ['a', 'c']);
      expect(ids(filterContainers(all, 'shipped')), ['b', 'd']);
      expect(ids(filterContainers(all, 'everything')), ['a', 'b', 'c', 'd']);
    });

    test('a destination narrows the state, an empty one narrows nothing', () {
      expect(
        ids(filterContainers(all, 'loading', destinationCountryId: 'senegal')),
        ['c'],
      );
      expect(
        ids(filterContainers(all, 'shipped', destinationCountryId: 'guinea')),
        ['b'],
      );
      expect(
        ids(filterContainers(all, 'loading', destinationCountryId: '  ')),
        ['a', 'c'],
      );
      expect(
        ids(filterContainers(all, 'loading', destinationCountryId: 'mali')),
        isEmpty,
      );
    });

    test('the options are only destinations a container has, by name', () {
      final options = containerDestinationOptions(all, {
        'guinea': 'Guinea',
        'senegal': 'Sénégal',
      });
      expect([for (final o in options) o.id], ['guinea', 'senegal']);
      expect(options.last.label, 'Sénégal');
    });

    test(
      'a destination the list does not know keeps the stored name, then the id',
      () {
        final options = containerDestinationOptions([
          _box('a', destination: 'mali', destinationName: 'Mali'),
          _box('b', destination: 'togo', destinationName: ''),
          _box('c', destination: ''),
        ], const {});
        expect([for (final o in options) o.label], ['Mali', 'togo']);
      },
    );
  });

  group('Waiting list filters (waitingFilterView)', () {
    ContainerLine waiting(
      String id, {
      String mode = 'sea',
      bool photo = false,
    }) => _line(id, {
      'containerId': '',
      'containerStatus': containerLineStatusWaiting,
      'shipMode': mode,
      if (photo) ...{
        'photoPaths': ['packagePhotos/b1/uid1/photo-$id-ok.jpg'],
        'senderConfirmation': {'status': 'confirmed'},
      },
    });

    final lines = [
      waiting('a1', mode: 'air'),
      waiting('a2', mode: 'air', photo: true),
      waiting('s1'),
      waiting('s2'),
    ];

    test(
      'counts: missing proof is air without its photo; Air and Sea add up',
      () {
        final view = waitingFilterView(lines, shipsByAir: true);
        expect(view.total, 4);
        expect(view.missingCount, 1);
        expect(view.airCount, 2);
        expect(view.seaCount, 2);
        expect(view.modeFilterShown, isTrue);
        expect(view.shown, hasLength(4));
        expect(view.empty, WaitingEmpty.none);
      },
    );

    test('Missing proof keeps only those; the counts do not move', () {
      final view = waitingFilterView(
        lines,
        shipsByAir: true,
        missingOnly: true,
      );
      expect([for (final l in view.shown) l.id], ['a1']);
      expect(view.missingCount, 1);
    });

    test('Air and Sea narrow the list, and combine with Missing proof', () {
      expect(
        [
          for (final l in waitingFilterView(
            lines,
            shipsByAir: true,
            mode: 'sea',
          ).shown)
            l.id,
        ],
        ['s1', 's2'],
      );
      final both = waitingFilterView(
        lines,
        shipsByAir: true,
        mode: 'air',
        missingOnly: true,
      );
      expect([for (final l in both.shown) l.id], ['a1']);
    });

    test(
      'a business that does not ship by air has no Air / Sea chips and ignores the mode',
      () {
        final view = waitingFilterView(lines, mode: 'air');
        expect(view.modeFilterShown, isFalse);
        expect(view.shown, hasLength(4));
      },
    );

    test(
      'an air-only business offers the chips only once something goes by sea',
      () {
        final airOnly = [
          waiting('a1', mode: 'air'),
          waiting('a2', mode: 'air'),
        ];
        expect(
          waitingFilterView(
            airOnly,
            shipsByAir: true,
            airOnly: true,
          ).modeFilterShown,
          isFalse,
        );
        expect(
          waitingFilterView(
            lines,
            shipsByAir: true,
            airOnly: true,
          ).modeFilterShown,
          isTrue,
        );
      },
    );

    test('what an empty list says', () {
      expect(waitingFilterView(const []).empty, WaitingEmpty.noPackages);
      // Every waiting package has its proof.
      final proofed = [waiting('a', mode: 'air', photo: true)];
      expect(
        waitingFilterView(proofed, shipsByAir: true, missingOnly: true).empty,
        WaitingEmpty.allHaveProof,
      );
      // A search finds nothing: that is the search's sentence, even with
      // Missing proof on.
      expect(
        waitingFilterView(proofed, query: 'zzzz', missingOnly: true).empty,
        WaitingEmpty.noSearchMatch,
      );
      // Only Air is on and nothing flies.
      expect(
        waitingFilterView([waiting('s')], shipsByAir: true, mode: 'air').empty,
        WaitingEmpty.noShipMode,
      );
    });
  });

  group('Send again (docs/WHATSAPP_RESEND.md)', () {
    test('the request is the console\'s resend_update', () {
      expect(resendRequest('b1', 'l1'), {
        'businessId': 'b1',
        'lineId': 'l1',
        'action': 'resend_update',
      });
      expect(resendCallable, 'updateContainerLine');
      expect(resendRequest('b1', ' '), isNull);
      expect(resendRequest('', 'l1'), isNull);
    });

    test('offered only when someone was not reached', () {
      final failed = _line('f', {
        'lastCustomerUpdate': _update([
          {'role': 'sender', 'status': 'sent', 'delivery': 'read'},
          {
            'role': 'receiver',
            'status': 'sent',
            'delivery': 'failed',
            'reason': 'Message undeliverable',
          },
        ]),
      });
      final sendFailed = _line('g', {
        'lastCustomerUpdate': _update([
          {'role': 'sender', 'status': 'failed', 'reason': 'x'},
        ]),
      });
      final fine = _line('h', {
        'lastCustomerUpdate': _update([
          {'role': 'sender', 'status': 'sent', 'delivery': 'delivered'},
        ]),
      });
      final none = _line('i');
      expect(lineUpdateFailed(failed), isTrue);
      expect(lineUpdateFailed(sendFailed), isTrue);
      expect(lineUpdateFailed(fine), isFalse);
      expect(lineUpdateFailed(none), isFalse);
    });

    test('the server\'s refusals are told apart', () {
      expect(
        resendRefusalOf('whatsapp_not_configured'),
        ResendRefusal.notConfigured,
      );
      expect(resendRefusalOf('no_customer_update'), ResendRefusal.noUpdate);
      expect(resendRefusalOf('line_not_found'), ResendRefusal.other);
      expect(resendRefusalOf(null), ResendRefusal.other);
    });

    test('the answer: nobody queued means nothing to send', () {
      expect(
        ResendResult.fromCallable({
          'queued': 2,
          'alreadySent': 0,
        }).nothingToSend,
        isFalse,
      );
      final none = ResendResult.fromCallable({'queued': 0, 'alreadySent': 1.0});
      expect(none.nothingToSend, isTrue);
      expect(none.alreadySent, 1);
      expect(ResendResult.fromCallable(null).nothingToSend, isTrue);
      expect(ResendResult.fromCallable({'queued': -3}).queued, 0);
    });
  });

  group('The counter warning (counterAlerts)', () {
    final failedSender = _line('l1', {
      'customerPhone': '+164655501',
      'lastCustomerUpdate': _update([
        {
          'role': 'sender',
          'status': 'sent',
          'delivery': 'failed',
          'reason': 'Message undeliverable',
        },
        {'role': 'receiver', 'status': 'sent', 'delivery': 'read'},
      ]),
    });
    final failedBoth = _line('l2', {
      'lastCustomerUpdate': _update([
        {'role': 'sender', 'status': 'failed', 'reason': 'a'},
        {'role': 'receiver', 'status': 'failed', 'reason': 'b'},
      ]),
    });

    test('nothing when nothing was saved in this sitting', () {
      expect(counterAlerts([failedSender], {}), isEmpty);
    });

    test(
      'only the lines saved in this sitting, with who, the number and why',
      () {
        final alerts = counterAlerts([failedSender, failedBoth], {'l1'});
        expect(alerts, hasLength(1));
        expect(alerts.single.lineId, 'l1');
        expect(alerts.single.isReceiver, isFalse);
        expect(alerts.single.phone, '+164655501');
        expect(alerts.single.failure, 'Message undeliverable');
        expect(alerts.single.trackingCode, 'CL-L1');
      },
    );

    test('a line can warn about both people, each with its own number', () {
      final alerts = counterAlerts([failedBoth], {'l2'});
      expect([for (final a in alerts) a.isReceiver], [false, true]);
      expect(alerts[0].phone, '+19175551234');
      expect(alerts[1].phone, '+224621234567');
    });
  });

  group('People: who may do what', () {
    test('permissions: the owner (full access included) and an admin', () {
      expect(mayEditStaffPermissions(isOwner: true, isAdmin: false), isTrue);
      expect(mayEditStaffPermissions(isOwner: false, isAdmin: true), isTrue);
      expect(mayEditStaffPermissions(isOwner: false, isAdmin: false), isFalse);
    });

    test('full access: only the real owner or a super admin', () {
      expect(
        mayGrantFullAccess(isRealOwner: true, isSuperAdmin: false),
        isTrue,
      );
      expect(
        mayGrantFullAccess(isRealOwner: false, isSuperAdmin: true),
        isTrue,
      );
      // A full-access person is an owner to the app but not the real one.
      expect(
        mayGrantFullAccess(isRealOwner: false, isSuperAdmin: false),
        isFalse,
      );
    });

    test('the Parking bill link: the real owner or a platform admin', () {
      expect(mayLinkStaffParking(isRealOwner: true, isAdmin: false), isTrue);
      expect(mayLinkStaffParking(isRealOwner: false, isAdmin: true), isTrue);
      expect(mayLinkStaffParking(isRealOwner: false, isAdmin: false), isFalse);
    });
  });

  group('People: members and permissions', () {
    test(
      'a member reads from a users document; only staff can have full access',
      () {
        final staff = TeamMember.fromMap('u1', {
          'fullName': ' Hassimiou ',
          'email': 'h@x.com',
          'role': 'staff',
          'fullAccess': true,
          'businessPermissions': ['parking', '', 'ledger'],
        });
        expect(staff.displayName, 'Hassimiou');
        expect(staff.fullAccess, isTrue);
        expect(staff.permissions, ['parking', 'ledger']);
        final owner = TeamMember.fromMap('u2', {
          'role': 'businessOwner',
          'fullAccess': true,
          'email': 'o@x.com',
        });
        expect(owner.fullAccess, isFalse);
        expect(owner.displayName, 'o@x.com');
        expect(
          TeamMember.fromMap('u3', {
            'role': 'staff',
            'fullAccess': 'true',
          }).fullAccess,
          isFalse,
        );
      },
    );

    test(
      'ticking adds, unticking removes, and what is not offered is kept',
      () {
        expect(togglePermission(['parking'], 'ledger', true), [
          'parking',
          'ledger',
        ]);
        expect(togglePermission(['parking', 'ledger'], 'parking', false), [
          'ledger',
        ]);
        expect(togglePermission(['parking'], 'parking', true), ['parking']);
        // The retired Freight stays whatever else is toggled.
        expect(togglePermission(['freight', 'parking'], 'parking', false), [
          'freight',
        ]);
        expect(samePermissions(['a', 'b'], ['b', 'a']), isTrue);
        expect(samePermissions(['a'], ['a', 'b']), isFalse);
      },
    );

    test('the requests are the console\'s', () {
      expect(staffPermissionsRequest('b1', 'u1', ['parking']), {
        'businessId': 'b1',
        'staffUid': 'u1',
        'businessPermissions': ['parking'],
      });
      expect(fullAccessRequest('b1', 'u1', ['parking'], true), {
        'businessId': 'b1',
        'staffUid': 'u1',
        'businessPermissions': ['parking'],
        'fullAccess': true,
      });
      expect(
        staffPermissionsRequest('b1', 'u1', ['a']).containsKey('fullAccess'),
        isFalse,
        reason: 'a permissions save never touches full access',
      );
    });

    FirebaseFunctionsException refusal(String code, String reason) =>
        FirebaseFunctionsException(
          code: code,
          message: 'x',
          details: {'reason': reason},
        );

    test('refusals are read from details.reason, never shown raw', () {
      expect(
        teamRefusalOf(refusal('permission-denied', 'full_access_owner_only')),
        TeamRefusal.fullAccessOwnerOnly,
      );
      expect(
        teamRefusalOf(refusal('permission-denied', 'full_access_staff_only')),
        TeamRefusal.fullAccessStaffOnly,
      );
      expect(
        teamRefusalOf(refusal('permission-denied', 'link_owner_only')),
        TeamRefusal.linkOwnerOnly,
      );
      expect(
        teamRefusalOf(refusal('failed-precondition', 'staff_not_member')),
        TeamRefusal.notMember,
      );
      expect(
        teamRefusalOf(
          FirebaseFunctionsException(
            code: 'permission-denied',
            message: 'Only business owners can update staff permissions',
          ),
        ),
        TeamRefusal.notAllowed,
      );
      expect(teamRefusalOf(StateError('offline')), TeamRefusal.other);
    });
  });

  group('People: the Parking bill link', () {
    final cars = <Map<String, dynamic>>[
      {
        'id': 'c1',
        'customerName': 'Abd Sow',
        'customerPhone': '+1 (347) 562-8973',
      },
      {'id': 'c2', 'customerName': 'abd sow', 'customerPhone': '347-562-8973'},
      {
        'id': 'c3',
        'customerName': 'Keren Customer',
        'customerPhone': '+19175550000',
      },
      {
        'id': 'c4',
        'customerName': 'Cancelled One',
        'customerPhone': '+19175551111',
        'status': 'cancelled',
      },
      {'id': 'c5', 'customerName': '', 'customerPhone': ''},
      {'id': 'c6', 'ownerName': 'Walk In'},
    ];

    test('one customer per key, the name used most, cars counted, by name', () {
      final customers = parkingLinkCustomers(cars);
      expect(
        [for (final c in customers) c.name],
        ['Abd Sow', 'Keren Customer', 'Walk In'],
      );
      final abd = customers.first;
      expect(abd.cars, 2);
      expect(abd.key, 'phone:3475628973');
      expect(abd.phone, '+1 (347) 562-8973');
      expect(customers.last.key, 'name:walk in');
    });

    test(
      'the same phone beats everything; a shared word counts; no match is 0',
      () {
        final customers = parkingLinkCustomers(cars);
        const staff = (name: 'Abdoulaye Sow', phone: '3475628973');
        expect(
          parkingLinkScore(staff, customers.first),
          greaterThanOrEqualTo(100),
        );
        expect(
          parkingLinkScore((name: 'Abdoulaye Sow', phone: ''), customers.first),
          14, // "sow" is shared (10), "abd" starts "abdoulaye" (4)
        );
        expect(parkingLinkScore(staff, customers[1]), 0);
      },
    );

    test('suggestions first, then everyone by name; search narrows', () {
      final customers = parkingLinkCustomers(cars);
      const staff = (name: 'Abdoulaye Sow', phone: '');
      final choices = parkingLinkChoices(staff, customers);
      expect(choices.first.customer.name, 'Abd Sow');
      expect(choices.first.suggested, isTrue);
      expect(choices.skip(1).every((c) => !c.suggested), isTrue);
      expect(
        [
          for (final c in parkingLinkChoices(staff, customers, search: 'keren'))
            c.customer.name,
        ],
        ['Keren Customer'],
      );
      // Three digits of a phone are enough; two are not.
      expect(parkingLinkChoices(staff, customers, search: '917').length, 1);
      expect(parkingLinkChoices(staff, customers, search: '91').length, 0);
    });

    test('the request links a customer, or unlinks with an empty key', () {
      final abd = parkingLinkCustomers(cars).first;
      expect(staffParkingLinkRequest('b1', 'u1', abd), {
        'action': 'link_staff_parking',
        'businessId': 'b1',
        'staffId': 'u1',
        'customerKey': 'phone:3475628973',
        'customerName': 'Abd Sow',
        'customerPhone': '+1 (347) 562-8973',
      });
      final unlink = staffParkingLinkRequest('b1', 'u1', null);
      expect(unlink['customerKey'], '');
      expect(unlink['action'], 'link_staff_parking');
    });

    test('a staff member\'s link is read from the business', () {
      final links = {
        'u1': {
          'customerKey': 'phone:1',
          'customerName': 'Abd Sow',
          'customerPhone': '+1',
        },
        'u2': {'customerKey': ''},
        'u3': 'junk',
      };
      expect(StaffParkingLink.fromLinks(links, 'u1')!.label, 'Abd Sow');
      expect(StaffParkingLink.fromLinks(links, 'u2'), isNull);
      expect(StaffParkingLink.fromLinks(links, 'u3'), isNull);
      expect(StaffParkingLink.fromLinks(links, 'nobody'), isNull);
      expect(StaffParkingLink.fromLinks(null, 'u1'), isNull);
      expect(
        const StaffParkingLink(customerKey: 'k', customerPhone: '+1').label,
        '+1',
      );
    });

    test('the picker reads twelve months back', () {
      expect(
        parkingLinkSinceMs(DateTime(2026, 11, 17)),
        DateTime(2025, 11, 1).millisecondsSinceEpoch,
      );
    });
  });

  group('Both languages', () {
    test(
      'every shp / ppl string is in English and French, French is not a copy',
      () {
        final en =
            jsonDecode(File('lib/l10n/app_en.arb').readAsStringSync())
                as Map<String, dynamic>;
        final fr =
            jsonDecode(File('lib/l10n/app_fr.arb').readAsStringSync())
                as Map<String, dynamic>;
        // This work's block: the contiguous shp / ppl keys that follow
        // "pcsKindBarrel" (other ppl keys already existed).
        final all = en.keys.where((k) => !k.startsWith('@')).toList();
        final start = all.indexOf('pcsKindBarrel') + 1;
        final keys = <String>[];
        for (var i = start; i < all.length; i++) {
          if (!all[i].startsWith('shp') && !all[i].startsWith('ppl')) break;
          keys.add(all[i]);
        }
        expect(keys.length, greaterThan(60));
        // Words that read the same in both languages.
        const same = {'shpChipCount', 'pplCarsCount'};
        for (final key in keys) {
          expect(fr.containsKey(key), isTrue, reason: '$key missing in French');
          if (!same.contains(key)) {
            expect(
              fr[key],
              isNot(en[key]),
              reason: '$key is English in French',
            );
          }
          // The same placeholders in both.
          final enHolders = RegExp(
            r'\{(\w+)',
          ).allMatches('${en[key]}').map((m) => m.group(1)).toSet();
          final frHolders = RegExp(
            r'\{(\w+)',
          ).allMatches('${fr[key]}').map((m) => m.group(1)).toSet();
          expect(frHolders, enHolders, reason: '$key placeholders differ');
        }
      },
    );
  });
}
