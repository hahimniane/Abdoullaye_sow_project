import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/container_manifest.dart';

/// The app's mirror of `functions/container_manifest.js`. Every rule the
/// server enforces is checked here against the same inputs its own tests
/// use, so a refusal on the phone and a refusal from the server say the
/// same thing for the same reason.
ShippingContainer box({
  String id = 'c1',
  String label = 'Sailing 3 Oct, box 2',
  String number = '',
  String status = containerStatusLoading,
  String destinationId = 'guinea',
  int lineCount = 0,
  DateTime? sailedAt,
  DateTime? updatedAt,
}) {
  return ShippingContainer.fromMap(id, {
    'businessId': 'b1',
    'label': label,
    'containerNumber': number,
    'status': status,
    'destinationCountryId': destinationId,
    'destinationCountryName': destinationId.isEmpty ? '' : 'Guinea',
    'lineCount': lineCount,
    'sailedAt': sailedAt,
    'updatedAt': updatedAt,
  });
}

ContainerLine line({
  String id = 'l1',
  String containerId = 'c1',
  String containerStatus = containerStatusLoading,
  String kind = containerLineKindCar,
  String vin = '1HGCM82633A004352',
  int quantity = 1,
  String customer = 'Aissatou',
  String phone = '',
  String owner = containerOwnerCustomer,
  String receiver = '',
  String receiverPhone = '',
  DateTime? createdAt,
}) {
  return ContainerLine.fromMap(id, {
    'businessId': 'b1',
    'containerId': containerId,
    'containerStatus': containerStatus,
    'kind': kind,
    // Only a car carries a VIN, as the server's `containerLineRecord` writes.
    'vinNumber': kind == containerLineKindCar ? vin : '',
    'carMake': kind == containerLineKindCar ? 'Honda' : '',
    'carModel': kind == containerLineKindCar ? 'Accord' : '',
    'carYear': kind == containerLineKindCar ? '2003' : '',
    'quantity': quantity,
    'description': kind == containerLineKindOther ? 'Tyres' : '',
    'ownerKind': owner,
    'customerName': customer,
    'customerPhone': phone,
    'receiverName': receiver,
    'receiverPhone': receiverPhone,
    'createdAt': createdAt,
  });
}

void main() {
  group('a container', () {
    test('needs a name; a number, when given, must be ISO 6346', () {
      expect(validateContainer(const ContainerDraft()),
          ['container_label_required']);
      // A number or a booking reference is a name enough.
      expect(
        validateContainer(
            const ContainerDraft(containerNumber: 'MSKU1234567')),
        isEmpty,
      );
      expect(
        validateContainer(const ContainerDraft(bookingReference: 'CMA-77120')),
        isEmpty,
      );
      expect(
        validateContainer(const ContainerDraft(label: 'Box 2')),
        isEmpty,
      );
      expect(
        validateContainer(
            const ContainerDraft(label: 'Box 2', containerNumber: 'msku1234567')),
        isEmpty,
        reason: 'case is normalised before the check',
      );
      expect(
        validateContainer(
            const ContainerDraft(label: 'Box 2', containerNumber: 'BOOK-12345')),
        ['container_number_invalid'],
        reason: 'a booking number is not a container number',
      );
      expect(
        validateContainer(const ContainerDraft(containerNumber: 'MSKU12345')),
        ['container_number_invalid'],
        reason: 'a number that needs fixing is still the name; one problem, not two',
      );
    });

    test('is stored trimmed, capped and upper-cased where the server does', () {
      final record = containerRecord(ContainerDraft(
        label: '  ${'x' * 200}  ',
        containerNumber: ' msku1234567 ',
        bookingReference: 'bk-99',
        destinationCountryId: 'guinea',
        destinationCountryName: 'Guinea',
        notes: 'n',
      ));
      expect(record['label']!.length, containerMaxLabel);
      expect(record['containerNumber'], 'MSKU1234567');
      expect(record['bookingReference'], 'BK-99');
      expect(record['destinationCountryId'], 'guinea');
      expect(record['notes'], 'n');
    });

    test('moves forward only, and only when it can ship', () {
      expect(
        containerTransitionRefusal(box(), containerStatusShipped, 0),
        'container_empty',
      );
      expect(
        containerTransitionRefusal(
            box(destinationId: ''), containerStatusShipped, 3),
        'destination_required',
      );
      expect(
        containerTransitionRefusal(box(), containerStatusShipped, 3),
        isNull,
      );
      expect(
        containerTransitionRefusal(box(), containerStatusArrived, 3),
        'container_transition_invalid',
        reason: 'loading cannot skip to arrived',
      );
      expect(
        containerTransitionRefusal(
            box(status: containerStatusShipped), containerStatusArrived, 3),
        isNull,
      );
      expect(
        containerTransitionRefusal(
            box(status: containerStatusShipped), containerStatusLoading, 3),
        'container_transition_invalid',
        reason: 'a shipped box does not come back to the yard',
      );
      expect(
        containerTransitionRefusal(
            box(status: containerStatusArrived), containerStatusShipped, 3),
        'container_transition_invalid',
      );
      expect(
        containerTransitionRefusal(box(), 'lost', 3),
        'container_status_invalid',
      );
      expect(
        containerTransitionRefusal(null, containerStatusShipped, 1),
        'destination_required',
        reason: 'an absent record reads as loading with no destination',
      );
    });

    test('is open while loading and locked after', () {
      expect(containerIsOpen(box()), isTrue);
      expect(containerIsOpen(null), isTrue);
      expect(containerIsOpen(box(status: containerStatusShipped)), isFalse);
      expect(containerIsOpen(box(status: containerStatusArrived)), isFalse);
    });

    test('can be deleted only while loading and empty', () {
      expect(containerDeleteRefusal(box(), 0), isNull);
      expect(containerDeleteRefusal(box(), 2), 'container_has_lines');
      expect(
        containerDeleteRefusal(box(status: containerStatusShipped), 0),
        'container_locked',
      );
    });

    test('reads an unknown status as loading and shows the number first', () {
      expect(box(status: 'weird').status, containerStatusLoading);
      expect(box().displayName, 'Sailing 3 Oct, box 2');
      expect(box(number: 'MSKU1234567').displayName, 'MSKU1234567');
    });
  });

  group('a line', () {
    test('a car needs a VIN, barrels a count, other a description and count',
        () {
      expect(
        validateContainerLine(const ContainerLineDraft(
          kind: containerLineKindCar,
          vinNumber: '1HG',
          ownerKind: containerOwnerStock,
        )),
        ['vin_required'],
      );
      expect(
        validateContainerLine(const ContainerLineDraft(
          kind: containerLineKindBarrels,
          ownerKind: containerOwnerCustomer,
          customerName: 'Mamadou',
        )),
        ['quantity_required'],
      );
      expect(
        validateContainerLine(const ContainerLineDraft(
          kind: containerLineKindOther,
          ownerKind: containerOwnerStock,
        )),
        ['description_required', 'quantity_required'],
      );
      expect(
        validateContainerLine(const ContainerLineDraft(kind: 'boat')),
        ['line_kind_invalid', 'owner_kind_invalid'],
      );
    });

    test('a customer line names the customer; stock names nobody', () {
      expect(
        validateContainerLine(const ContainerLineDraft(
          kind: containerLineKindBarrels,
          quantity: 4,
          ownerKind: containerOwnerCustomer,
        )),
        ['customer_name_required'],
      );
      expect(
        validateContainerLine(const ContainerLineDraft(
          kind: containerLineKindCar,
          vinNumber: '1HGCM82633A004352',
          ownerKind: containerOwnerStock,
        )),
        isEmpty,
      );
    });

    test('the record carries only what its kind and owner need', () {
      final car = containerLineRecord(const ContainerLineDraft(
        kind: containerLineKindCar,
        vinNumber: '1hgcm82633a004352',
        carMake: 'Honda',
        quantity: 7,
        description: 'ignored',
        ownerKind: containerOwnerStock,
        customerName: 'ignored too',
      ));
      expect(car['vinNumber'], '1HGCM82633A004352');
      expect(car['quantity'], 1, reason: 'a car is one car');
      expect(car['description'], '');
      expect(car['customerName'], '');
      expect(car['receiverName'], '', reason: 'no receiver until one is named');

      // The name on the barrel is the receiver's; stock names one too (the
      // business's agent), so it never depends on the owner kind.
      final toAgent = containerLineRecord(const ContainerLineDraft(
        kind: containerLineKindBarrels,
        quantity: 3,
        ownerKind: containerOwnerStock,
        receiverName: '  Mariama Bah ',
        receiverPhone: '+224 620 00 00 00',
      ));
      expect(toAgent['receiverName'], 'Mariama Bah');
      // Stored the way the server stores it: formatting dropped, plus kept.
      expect(toAgent['receiverPhone'], '+224620000000');
      expect(toAgent['customerName'], '');

      final barrels = containerLineRecord(const ContainerLineDraft(
        kind: containerLineKindBarrels,
        quantity: 5000,
        ownerKind: containerOwnerCustomer,
        customerName: 'Aissatou',
        customerPhone: '917',
      ));
      expect(barrels['quantity'], containerMaxQuantity);
      expect(barrels['vinNumber'], '');
      expect(barrels['customerName'], 'Aissatou');
    });

    test('a VIN on an open container is a conflict; an arrived one is not',
        () {
      final onShipped = line(containerId: 'c9', containerStatus: containerStatusShipped);
      final onArrived = line(containerId: 'c8', containerStatus: containerStatusArrived);
      expect(openContainerHoldingVin([onArrived]), '');
      expect(openContainerHoldingVin([onArrived, onShipped]), 'c9');
      expect(
        openContainerHoldingVin([onShipped], ignoreContainerId: 'c9'),
        '',
        reason: 'a move from the same box is fine',
      );
      expect(
        openContainerHoldingVin([
          ContainerLine.fromMap('odd', {
            'kind': containerLineKindBarrels,
            'containerId': 'c7',
            'containerStatus': containerStatusLoading,
            'vinNumber': '1HGCM82633A004352',
          }),
        ]),
        '',
        reason: 'only a car line can hold a VIN, whatever the row says',
      );
    });

    test('the business lines for a VIN are found case-insensitively', () {
      final lines = [line(vin: '1HGCM82633A004352'), line(id: 'l2', vin: 'WVWZZZ')];
      expect(containerLinesForVin(lines, '1hgcm82633a004352').map((l) => l.id),
          ['l1']);
      expect(containerLinesForVin(lines, '1HG'), isEmpty,
          reason: 'below the minimum length nothing matches');
    });

    test('counts: barrels by quantity, cars and other by line', () {
      final counts = containerCounts([
        line(),
        line(id: 'l2', vin: 'WVWZZZ1'),
        line(id: 'l3', kind: containerLineKindBarrels, quantity: 12),
        line(id: 'l4', kind: containerLineKindOther, quantity: 3),
        line(id: 'l5', kind: containerLineKindOther, quantity: 0),
      ]);
      expect(counts.lineCount, 5);
      expect(counts.carCount, 2);
      expect(counts.barrelCount, 12);
      expect(counts.otherCount, 4, reason: 'a zero-quantity other counts as 1');
    });
  });

  group('what the screen shows', () {
    test('loading first, then shipped, then arrived, newest first within', () {
      final t = DateTime(2026, 9, 1);
      final sorted = sortContainers([
        box(id: 'arrived', status: containerStatusArrived, updatedAt: t),
        box(id: 'old-loading', updatedAt: t),
        box(id: 'shipped', status: containerStatusShipped, updatedAt: t),
        box(id: 'new-loading', updatedAt: t.add(const Duration(days: 2))),
      ]);
      expect(sorted.map((c) => c.id),
          ['new-loading', 'old-loading', 'shipped', 'arrived']);
      expect(
        filterContainers(sorted, containerStatusShipped).map((c) => c.id),
        ['shipped'],
      );
      expect(filterContainers(sorted, 'all').length, 4);
    });

    test('lines read in the order they were loaded', () {
      final t = DateTime(2026, 9, 1);
      final lines = sortContainerLines([
        line(id: 'later', createdAt: t.add(const Duration(hours: 1))),
        line(id: 'undated'),
        line(id: 'first', createdAt: t),
      ]);
      expect(lines.map((l) => l.id), ['first', 'later', 'undated']);
      expect(
        linesOfContainer([line(containerId: 'a'), line(id: 'l2', containerId: 'b')], 'b')
            .map((l) => l.id),
        ['l2'],
      );
    });

    test('search finds a VIN, a name or a phone and says where it is', () {
      final containers = {
        'c1': box(id: 'c1'),
        'c2': box(
          id: 'c2',
          status: containerStatusShipped,
          number: 'MSKU1234567',
          sailedAt: DateTime(2026, 10, 3),
        ),
      };
      final lines = [
        line(id: 'car', containerId: 'c2', vin: '1HGCM82633A004352', customer: 'Aissatou Diallo'),
        line(id: 'barrels', containerId: 'c1', kind: containerLineKindBarrels,
            customer: 'Mamadou', phone: '(917) 555-1234'),
        line(id: 'stock', containerId: 'c1', vin: 'WVWZZZ3CZWE000001',
            owner: containerOwnerStock, customer: '',
            receiver: 'Ousmane Camara', receiverPhone: '+224 620 11 22 33'),
      ];
      List<String> ids(String q) =>
          searchContainerLines(lines, containers, q).map((h) => h.line.id).toList();

      // "Is there anything for Ousmane?" is the port's question; the
      // receiver answers it even on a stock line that names no customer.
      expect(ids('ousmane'), ['stock']);
      expect(ids('620 11'), ['stock']);

      expect(ids('1hgcm82633a004352'), ['car']);
      expect(ids('WVWZZZ'), ['stock']);
      expect(ids('diallo'), ['car']);
      expect(ids('9175551'), ['barrels']);
      expect(ids('a'), isEmpty, reason: 'one character matches nothing');
      expect(ids('zzz-nothing'), isEmpty);

      final hit = searchContainerLines(lines, containers, 'aissatou').single;
      expect(hit.container?.displayName, 'MSKU1234567');
      expect(hit.container?.status, containerStatusShipped);
      expect(hit.container?.sailedAt, DateTime(2026, 10, 3));
    });

    test('a search hit on a missing container still names the line', () {
      final hits = searchContainerLines(
          [line(containerId: 'gone')], const {}, 'aissatou');
      expect(hits.single.container, isNull);
    });

    test('the cross-link names the open box a car is on, never an arrived one',
        () {
      final links = containerVinLinks(
        [
          line(id: 'a', containerId: 'loading', vin: 'AAAAAAAAAAAAAAAAA'),
          line(id: 'b', containerId: 'shipped', vin: 'BBBBBBBBBBBBBBBBB'),
          line(id: 'c', containerId: 'arrived', vin: 'CCCCCCCCCCCCCCCCC'),
          line(id: 'd', containerId: 'shipped', kind: containerLineKindBarrels, vin: ''),
        ],
        [
          box(id: 'loading'),
          box(
            id: 'shipped',
            status: containerStatusShipped,
            number: 'MSKU1234567',
            sailedAt: DateTime(2026, 10, 3),
          ),
          box(id: 'arrived', status: containerStatusArrived),
        ],
      );
      expect(links.keys, ['AAAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBBB']);
      expect(links['AAAAAAAAAAAAAAAAA']!.isShipped, isFalse);
      expect(links['AAAAAAAAAAAAAAAAA']!.containerName, 'Sailing 3 Oct, box 2');
      expect(links['BBBBBBBBBBBBBBBBB']!.isShipped, isTrue);
      expect(links['BBBBBBBBBBBBBBBBB']!.containerName, 'MSKU1234567');
      expect(links['BBBBBBBBBBBBBBBBB']!.sailedAt, DateTime(2026, 10, 3));
    });
  });

  // Mirrors `describe("who hears about a line")` in
  // functions/test/container-manifest.test.js, input for input.
  group('who hears about a line', () {
    ContainerLineDraft customerLine({
      String customerPhone = '',
      String receiverName = '',
      String receiverPhone = '',
      bool notifyCustomer = true,
      bool notifyReceiver = true,
    }) =>
        ContainerLineDraft(
          kind: containerLineKindBarrels,
          quantity: 2,
          ownerKind: containerOwnerCustomer,
          customerName: 'Fatou Diallo',
          customerPhone: customerPhone,
          receiverName: receiverName,
          receiverPhone: receiverPhone,
          notifyCustomer: notifyCustomer,
          notifyReceiver: notifyReceiver,
        );

    test('a phone is stored without formatting, the plus kept', () {
      expect(containerPhone('+1 (646) 555-0100'), '+16465550100');
      expect(containerPhone(' 622.11.22.33 '), '622112233');
      // Not 7-15 digits: kept as typed so the validator can name it.
      expect(containerPhone('call me'), 'call me');
      expect(containerPhone('12'), '12');
      expect(containerPhone(null), '');
    });

    test('tells the sender and the receiver by default, when they have a number',
        () {
      final line = containerLineRecord(customerLine(
        customerPhone: '+1 (646) 555-0100',
        receiverName: 'Mariama',
        receiverPhone: '+224 620-00-00-00',
      ));
      expect(line['customerPhone'], '+16465550100');
      expect(line['receiverPhone'], '+224620000000');
      expect(line['notifyCustomer'], isTrue);
      expect(line['notifyReceiver'], isTrue);

      final noPhones = containerLineRecord(customerLine());
      expect(noPhones['notifyCustomer'], isFalse);
      expect(noPhones['notifyReceiver'], isFalse);
    });

    test('keeps a person quiet when staff switch them off', () {
      final line = containerLineRecord(customerLine(
        customerPhone: '+16465550100',
        notifyCustomer: false,
        receiverPhone: '+224620000000',
        notifyReceiver: false,
      ));
      expect(line['notifyCustomer'], isFalse);
      expect(line['notifyReceiver'], isFalse);
    });

    test('never keeps a customer phone on business stock', () {
      final line = containerLineRecord(const ContainerLineDraft(
        kind: containerLineKindBarrels,
        quantity: 1,
        ownerKind: containerOwnerStock,
        customerPhone: '+16465550100',
        receiverPhone: '+224620000000',
      ));
      expect(line['customerPhone'], '');
      expect(line['notifyCustomer'], isFalse);
      expect(line['notifyReceiver'], isTrue);
    });

    test('refuses a phone that is not a phone, and allows none at all', () {
      expect(validateContainerLine(customerLine(customerPhone: 'call me')),
          ['customer_phone_invalid']);
      expect(validateContainerLine(customerLine(receiverPhone: '12')),
          ['receiver_phone_invalid']);
      expect(validateContainerLine(customerLine()), isEmpty);
      // Older app versions send local numbers; they are kept, not refused.
      expect(validateContainerLine(customerLine(customerPhone: '622 11 22 33')),
          isEmpty);
      // A stock line's customer phone is never read, so never refused.
      expect(
        validateContainerLine(const ContainerLineDraft(
          kind: containerLineKindBarrels,
          quantity: 1,
          ownerKind: containerOwnerStock,
          customerPhone: 'call me',
        )),
        isEmpty,
      );
    });

    test('tells an international number from a local one', () {
      expect(isInternationalPhone('+224 622 11 22 33'), isTrue);
      expect(isInternationalPhone('622112233'), isFalse);
      expect(isInternationalPhone(''), isFalse);
      expect(isInternationalPhone('+0224622112233'), isFalse);
      expect(isInternationalPhone('+1234567'), isFalse, reason: 'too short');
      expect(internationalPhonePattern.pattern, r'^\+[1-9]\d{7,14}$');
    });

    test('a number lacks a country code only when it is a phone without one',
        () {
      expect(containerPhoneLacksCountryCode('622 11 22 33'), isTrue);
      expect(containerPhoneLacksCountryCode('+224622112233'), isFalse);
      expect(containerPhoneLacksCountryCode(''), isFalse,
          reason: 'nobody to reach');
      expect(containerPhoneLacksCountryCode('call me'), isFalse,
          reason: 'refused, not warned about');
      expect(containerPhoneAcceptable(''), isTrue);
      expect(containerPhoneAcceptable('call me'), isFalse);
    });

    test('a stored line reads its code and who hears about it', () {
      ContainerLine stored(Map<String, dynamic> extra) =>
          ContainerLine.fromMap('l1', {
            'businessId': 'b1',
            'containerId': 'c1',
            'kind': containerLineKindBarrels,
            'quantity': 2,
            'ownerKind': containerOwnerCustomer,
            'customerName': 'Fatou Diallo',
            ...extra,
          });

      final current = stored({
        'trackingCode': 'cl-k7m4p2',
        'customerPhone': '+16465550100',
        'notifyCustomer': true,
        'receiverName': 'Mariama Bah',
        'receiverPhone': '+224620000000',
        'notifyReceiver': false,
      });
      expect(current.trackingCode, 'CL-K7M4P2');
      expect(current.updatesCustomer, isTrue);
      expect(current.notifyReceiver, isFalse);
      expect(current.updatesReceiver, isFalse);

      // Lines from before the switches existed: on, as the server reads them,
      // but never without a phone; and no code until the box next moves.
      final older = stored({
        'customerPhone': '622112233',
        'receiverName': 'Mariama Bah',
      });
      expect(older.trackingCode, '');
      expect(older.notifyCustomer, isTrue);
      expect(older.updatesCustomer, isFalse);
      expect(older.customerPhoneLacksCountryCode, isTrue);
      expect(older.notifyReceiver, isFalse);
      expect(older.receiverPhoneLacksCountryCode, isFalse);
    });

    test('corrects contacts later; a customer line keeps its customer', () {
      final stored = ContainerLine.fromMap('l1', {
        'kind': containerLineKindBarrels,
        'quantity': 2,
        'ownerKind': containerOwnerCustomer,
        ...containerLineRecord(customerLine(
          customerPhone: '622112233',
          receiverName: 'Mariama',
          receiverPhone: '+224620000000',
        )),
      });
      final start = ContainerLineContactsDraft.fromLine(stored);
      final fixed = ContainerLineContactsDraft(
        customerName: start.customerName,
        customerPhone: '+224 622 11 22 33',
        receiverName: start.receiverName,
        receiverPhone: start.receiverPhone,
        notifyCustomer: start.notifyCustomer,
        notifyReceiver: start.notifyReceiver,
      );
      expect(validateContainerLineContacts(fixed, stored), isEmpty);
      final update = containerLineContactsUpdate(fixed, stored);
      expect(update, {
        'customerName': 'Fatou Diallo',
        'customerPhone': '+224622112233',
        'receiverName': 'Mariama',
        'receiverPhone': '+224620000000',
        'notifyCustomer': true,
        'notifyReceiver': true,
      });
      expect(
        validateContainerLineContacts(
            const ContainerLineContactsDraft(customerName: ' '), stored),
        ['customer_name_required'],
      );
      expect(
        validateContainerLineContacts(
          const ContainerLineContactsDraft(
              customerName: 'Fatou', receiverPhone: 'nope'),
          stored,
        ),
        ['receiver_phone_invalid'],
      );
    });

    test('stock contacts name a receiver and never a customer', () {
      final stock = ContainerLine.fromMap('l2', {
        'kind': containerLineKindBarrels,
        'quantity': 1,
        'ownerKind': containerOwnerStock,
      });
      const draft = ContainerLineContactsDraft(
        customerName: 'Nobody',
        customerPhone: '+16465550100',
        receiverName: 'Agent',
        receiverPhone: '',
      );
      expect(validateContainerLineContacts(draft, stock), isEmpty);
      final update = containerLineContactsUpdate(draft, stock);
      expect(update['customerName'], '');
      expect(update['customerPhone'], '');
      expect(update['notifyCustomer'], isFalse);
      expect(update['receiverName'], 'Agent');
      expect(update['notifyReceiver'], isFalse, reason: 'no phone, no switch');
    });

    test('the phone refusals are part of the shared vocabulary', () {
      expect(containerRefusalCodes,
          containsAll(['customer_phone_invalid', 'receiver_phone_invalid']));
      expect(
        parseContainerRefusal({'codes': ['receiver_phone_invalid']}, '').codes,
        ['receiver_phone_invalid'],
      );
    });
  });

  group('a refusal from the server', () {
    test('is read from details, and names the conflicting container', () {
      final refusal = parseContainerRefusal(
        {'code': 'vin_already_loaded', 'conflictContainerId': 'c9'},
        'This car is already on another container that hasn\'t arrived.',
      );
      expect(refusal.codes, ['vin_already_loaded']);
      expect(refusal.conflictContainerId, 'c9');
    });

    test('is read from a message that only speaks codes', () {
      final refusal = parseContainerRefusal(
          null, 'vin_required customer_name_required');
      expect(refusal.codes, ['vin_required', 'customer_name_required']);
      expect(refusal.isEmpty, isFalse);
    });

    test('keeps prose it cannot map so the screen can still say it', () {
      final refusal = parseContainerRefusal(null, 'Business not found.');
      expect(refusal.isEmpty, isTrue);
      expect(refusal.message, 'Business not found.');
    });

    test('ignores codes it does not know', () {
      final refusal = parseContainerRefusal({'codes': ['made_up', 'container_empty']}, '');
      expect(refusal.codes, ['container_empty']);
    });
  });
}
