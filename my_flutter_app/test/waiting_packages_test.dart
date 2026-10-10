import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/destination_country.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/package_codes.dart';
import 'package:my_flutter_app/services/waiting_packages.dart';

/// The pure half of waiting packages: size and volume, the payment standing,
/// the destination rule, the register form's checks and the requests it
/// sends. Mirrors `functions/container_manifest.js`, `container_payments.js`
/// and the console's `waiting-packages.test.ts`, case for case.
ContainerLine _line(String id, [Map<String, dynamic> extra = const {}]) =>
    ContainerLine.fromMap(id, {
      'businessId': 'b1',
      'containerId': '',
      'containerStatus': containerLineStatusWaiting,
      'kind': containerLineKindBarrels,
      'quantity': 2,
      'ownerKind': containerOwnerCustomer,
      'customerName': 'Fatou Diallo',
      'customerPhone': '+19175551234',
      'destinationCountryId': 'guinea',
      'destinationCountryName': 'Guinea',
      'trackingCode': 'CL-K7M4P2',
      ...extra,
    });

ShippingContainer _box(String? destination, {String status = 'loading'}) =>
    ShippingContainer.fromMap('c1', {
      'businessId': 'b1',
      'label': 'Box 1',
      'status': status,
      'destinationCountryId': ?destination,
      'destinationCountryName': ?destination,
    });

ContainerLineDraft _draft({
  String kind = containerLineKindBarrels,
  int quantity = 2,
  String ownerKind = containerOwnerCustomer,
  String customerName = 'Fatou Diallo',
  String destinationCountryId = 'guinea',
  String destinationCountryName = 'Guinea',
  String lengthIn = '',
  String widthIn = '',
  String heightIn = '',
  int? priceCents,
  bool payOnArrival = false,
}) =>
    ContainerLineDraft(
      kind: kind,
      quantity: quantity,
      ownerKind: ownerKind,
      customerName: customerName,
      destinationCountryId: destinationCountryId,
      destinationCountryName: destinationCountryName,
      lengthIn: lengthIn,
      widthIn: widthIn,
      heightIn: heightIn,
      priceCents: priceCents,
      payOnArrival: payOnArrival,
    );

void main() {
  group('size: inches in, cubic feet out', () {
    test('a typed side reads as a number, blank as none, anything else NaN', () {
      expect(readInches(''), isNull);
      expect(readInches('  '), isNull);
      expect(readInches('40'), 40);
      expect(readInches('12,5'), 12.5, reason: 'a decimal comma is a point');
      expect(readInches('0'), isNaN);
      expect(readInches('-3'), isNaN);
      expect(readInches('abc'), isNaN);
      expect(readInches('1e2'), isNaN);
      expect(readInches('600'), 600);
      expect(readInches('601'), isNaN, reason: 'over the server cap');
    });

    test('volume is L x W x H over 1728, two decimals', () {
      expect(volumeCubicFeet(40, 30, 20), 13.89);
      expect(volumeCubicFeet(12, 12, 12), 1);
      expect(volumeCubicFeet(40, 30, null), isNull);
      expect(volumeCubicFeet(0, 30, 20), isNull);
      expect(volumeCubicFeet(double.nan, 30, 20), isNull);
    });

    test('a line carries a size only when all three sides are there', () {
      final sized = _line('l1', {'lengthIn': 40, 'widthIn': 30, 'heightIn': 20});
      final size = packageSize(sized)!;
      expect(size.dimensionsText, '40 × 30 × 20 in');
      expect(size.volumeText, '13.89 ft³');
      expect(packageSize(_line('l2', {'lengthIn': 40, 'widthIn': 30})), isNull);
      expect(packageSize(_line('l3')), isNull);
      expect(trimNumber(12.5), '12.5');
      expect(trimNumber(12), '12');
    });

    test('the size checks mirror the server: all three or none', () {
      expect(packageSizeErrors('', '', ''), isEmpty);
      expect(packageSizeErrors('40', '30', '20'), isEmpty);
      expect(packageSizeErrors('40', '', ''), ['size_invalid']);
      expect(packageSizeErrors('40', '30', 'x'), ['size_invalid']);
      expect(packageSizeErrors('40', '30', '700'), ['size_invalid']);
    });
  });

  group('price and payments', () {
    test('where a package stands on money', () {
      PackagePaymentStatus of(Map<String, dynamic> extra) =>
          packagePayment(_line('l', extra)).status;
      expect(of(const {}), PackagePaymentStatus.noPrice);
      expect(of({'payOnArrival': true}), PackagePaymentStatus.payOnArrival);
      expect(of({'priceCents': 10000}), PackagePaymentStatus.unpaid);
      expect(of({'priceCents': 10000, 'payOnArrival': true}),
          PackagePaymentStatus.payOnArrival);
      expect(of({'priceCents': 10000, 'paidCents': 2500}),
          PackagePaymentStatus.partial);
      // Money on account reads partial even when the rest is due on arrival.
      expect(
          of({'priceCents': 10000, 'paidCents': 2500, 'payOnArrival': true}),
          PackagePaymentStatus.partial);
      expect(of({'priceCents': 10000, 'paidCents': 10000}),
          PackagePaymentStatus.paid);
      expect(of({'priceCents': 10000, 'paidCents': 10000, 'payOnArrival': true}),
          PackagePaymentStatus.paid);
    });

    test('the balance is what is left, never negative, null without a price',
        () {
      final partial = packagePayment(
          _line('l', {'priceCents': 10000, 'paidCents': 2500}));
      expect(partial.balanceCents, 7500);
      expect(partial.hasPrice, isTrue);
      expect(
          packagePayment(_line('l', {'priceCents': 1000, 'paidCents': 5000}))
              .balanceCents,
          0);
      expect(packagePayment(_line('l')).balanceCents, isNull);
    });

    test('stored money reads the way the server stores it', () {
      expect(_line('l', {'priceCents': 0}).priceCents, isNull);
      expect(_line('l', {'priceCents': -5}).priceCents, isNull);
      expect(_line('l', {'priceCents': 12.5}).priceCents, isNull,
          reason: 'cents are whole');
      expect(_line('l', {'priceCents': '4550'}).priceCents, 4550);
      expect(_line('l', {'paidCents': -3}).paidCents, 0);
      expect(_line('l', {'paidCents': 'x'}).paidCents, 0);
      expect(_line('l', {'payOnArrival': true}).payOnArrival, isTrue);
      expect(_line('l', {'payOnArrival': 'true'}).payOnArrival, isFalse);
    });

    test('a typed price: blank is none, a comma is a decimal, rubbish is refused',
        () {
      expect(readPackagePrice('').cents, isNull);
      expect(readPackagePrice('').error, isNull);
      expect(readPackagePrice('45,50').cents, 4550);
      expect(readPackagePrice(r'$1,200.00').cents, 120000);
      expect(readPackagePrice('0').error, 'price_invalid');
      expect(readPackagePrice('abc').error, 'price_invalid');
      expect(readPackagePrice('-5').error, 'price_invalid');
      expect(readPackagePrice('1000000.01').error, 'price_invalid');
    });

    test('a price is never below what was paid, nor cleared after a payment',
        () {
      expect(validatePackagePrice('100', 0), isEmpty);
      expect(validatePackagePrice('', 0), isEmpty);
      expect(validatePackagePrice('100', 2500), isEmpty);
      expect(validatePackagePrice('20', 2500), ['price_below_paid']);
      expect(validatePackagePrice('', 2500), ['price_below_paid']);
      expect(validatePackagePrice('free', 0), ['price_invalid']);
    });

    test('payments: a real amount, a price, never above the balance', () {
      final standing = packagePayment(
          _line('l', {'priceCents': 10000, 'paidCents': 2500}));
      List<String> check(String amount, [String method = 'cash']) =>
          validatePackagePayment(
              amount: amount, method: method, standing: standing);
      expect(check('75'), isEmpty);
      expect(check('20.50'), isEmpty);
      expect(check(''), ['amount_required']);
      expect(check('0'), ['amount_required']);
      expect(check('75.01'), ['payment_exceeds_balance']);
      expect(check('999999999'), ['amount_too_large']);
      expect(check('10', 'barter'), ['payment_method_invalid']);
      expect(check('', 'barter'), ['amount_required', 'payment_method_invalid']);
      expect(
        validatePackagePayment(
          amount: '5',
          method: 'zelle',
          standing: packagePayment(_line('l')),
        ),
        ['price_required'],
      );
    });

    test('"pay the whole balance" fills what is left', () {
      expect(
          wholeBalanceInput(packagePayment(
              _line('l', {'priceCents': 10000, 'paidCents': 2550}))),
          '74.50');
      expect(
          wholeBalanceInput(packagePayment(_line('l', {'priceCents': 10000}))),
          '100');
      expect(wholeBalanceInput(packagePayment(_line('l'))), '');
      expect(
          wholeBalanceInput(packagePayment(
              _line('l', {'priceCents': 1000, 'paidCents': 1000}))),
          '');
    });

    test('payment rows read back and sort newest first, reverted kept', () {
      final rows = [
        ContainerLinePayment.fromMap('p1', {
          'lineId': 'l1',
          'amountCents': 2500,
          'method': 'cash',
          'receivedByStaffId': 's1',
          'createdAt': DateTime(2026, 10, 1, 9),
        }),
        ContainerLinePayment.fromMap('p2', {
          'lineId': 'l1',
          'amountCents': 1000,
          'method': 'zelle',
          'note': 'second',
          'reverted': true,
          'revertedByStaffId': 's2',
          'createdAt': DateTime(2026, 10, 3, 14, 15),
        }),
        ContainerLinePayment.fromMap('p3', {'amountCents': -4}),
      ];
      final sorted = sortPaymentsNewestFirst(rows);
      expect([for (final p in sorted) p.id], ['p2', 'p1', 'p3']);
      expect(sorted.first.reverted, isTrue);
      expect(sorted.first.revertedByStaffId, 's2');
      expect(sorted.last.amountCents, 0, reason: 'a negative amount reads as 0');
    });
  });

  group('destination: the hard block', () {
    DestinationCountry country(String id, String name, {bool main = false}) =>
        DestinationCountry(id: id, name: name, isMain: main);

    test('a new package opens on the main destination, else the first by name',
        () {
      final destinations = [
        country('senegal', 'Senegal'),
        country('guinea', 'Guinea', main: true),
        country('mali', 'Mali'),
      ];
      expect(defaultWaitingDestination(destinations)!.id, 'guinea');
      expect(defaultWaitingDestination(destinations)!.name, 'Guinea');
      final none = [country('senegal', 'Senegal'), country('mali', 'Mali')];
      expect(defaultWaitingDestination(none)!.id, 'mali',
          reason: 'by name, not by the order the rows arrived in');
      expect(defaultWaitingDestination(const []), isNull);
    });

    test('the mismatch rule mirrors the server', () {
      final guinea = _line('l1');
      expect(destinationMismatch(guinea, _box('guinea')), isNull);
      expect(destinationMismatch(guinea, _box('senegal')), 'destination_mismatch');
      expect(destinationMismatch(guinea, _box(null)),
          'container_destination_required');
      // A line from before destinations existed rides anywhere.
      final old = _line('l2', {'destinationCountryId': '', 'destinationCountryName': ''});
      expect(destinationMismatch(old, _box('senegal')), isNull);
      expect(destinationMismatch(old, _box(null)), isNull);
    });

    test('every waiting package against one container, with the reason', () {
      final lines = [
        _line('a'),
        _line('b', {'destinationCountryId': 'senegal'}),
        _line('c', {'destinationCountryId': ''}),
      ];
      final out = assignableLines(lines, _box('guinea'));
      expect([for (final e in out) e.refusal],
          [null, 'destination_mismatch', null]);
      expect(out[1].blocked, isTrue);
    });

    test('select all matching skips blocked rows and stops at the limit', () {
      final entries = [
        for (var i = 0; i < 120; i++)
          AssignableLine(_line('l$i'), null),
        AssignableLine(_line('blocked'), 'destination_mismatch'),
      ];
      final all = selectAllMatching(entries, const []);
      expect(all.length, 100);
      expect(all, isNot(contains('blocked')));
      // What is already ticked stays and counts toward the limit.
      final more = selectAllMatching(entries.take(5), ['x1', 'x2']);
      expect(more, ['x1', 'x2', 'l0', 'l1', 'l2', 'l3', 'l4']);
      expect(selectAllMatching([entries.last], const []), isEmpty);
    });

    test('too many (or none) ticked is the server\'s line_ids_invalid', () {
      expect(assignSelectionRefusal(1), isNull);
      expect(assignSelectionRefusal(100), isNull);
      expect(assignSelectionRefusal(101), 'line_ids_invalid');
      expect(assignSelectionRefusal(0), 'line_ids_invalid');
    });

    test('the list narrows by VIN, name, receiver or phone; under two chars it does not',
        () {
      final lines = [
        _line('a', {'customerName': 'Fatou Diallo'}),
        _line('b', {'customerName': 'Moussa Bah', 'customerPhone': '+16465550100'}),
        _line('c', {
          'kind': containerLineKindCar,
          'vinNumber': '1HGCM82633A004352',
          'customerName': 'Aissatou',
        }),
      ];
      List<String> ids(String q) =>
          [for (final l in filterWaitingPackages(lines, q)) l.id];
      expect(ids(''), ['a', 'b', 'c']);
      expect(ids('f'), ['a', 'b', 'c']);
      expect(ids('moussa'), ['b']);
      expect(ids('646 555'), ['b']);
      expect(ids('1hgcm'), ['c']);
      expect(ids('zzz'), isEmpty);
    });

    test('only the lines with no container are waiting, newest first', () {
      final lines = [
        _line('old', {'createdAt': DateTime(2026, 10, 1)}),
        _line('new', {'createdAt': DateTime(2026, 10, 3)}),
        _line('onbox', {'containerId': 'c1', 'containerStatus': 'loading'}),
        _line('mismatch', {'containerId': '', 'containerStatus': 'loading'}),
      ];
      expect([for (final l in waitingLines(lines)) l.id], ['new', 'old']);
      expect(lines[2].isWaiting, isFalse);
    });
  });

  group('the register form', () {
    test('a waiting package needs a customer and a destination', () {
      expect(validateWaitingPackage(_draft()), isEmpty);
      expect(validateWaitingPackage(_draft(destinationCountryId: '')),
          ['package_destination_required']);
      expect(validateWaitingPackage(_draft(customerName: '')),
          ['customer_name_required']);
      expect(validateWaitingPackage(_draft(ownerKind: containerOwnerStock)),
          ['owner_kind_invalid'],
          reason: 'stock is not dropped off at a counter');
      expect(validateWaitingPackage(_draft(quantity: 0)), ['quantity_required']);
      expect(
          validateWaitingPackage(
              _draft(destinationCountryId: '', customerName: '', quantity: 0)),
          ['quantity_required', 'customer_name_required',
            'package_destination_required']);
    });

    test('size and price are checked with the line, every problem at once', () {
      expect(validateWaitingPackage(_draft(lengthIn: '40')), ['size_invalid']);
      expect(
          validateWaitingPackage(
              _draft(lengthIn: '40', widthIn: '30', heightIn: '20')),
          isEmpty);
      expect(validateWaitingPackage(_draft(priceCents: 0)), ['price_invalid']);
      expect(validateWaitingPackage(_draft(priceCents: 4550)), isEmpty);
      // The same checks guard a line added to a container.
      expect(validateContainerLine(_draft(lengthIn: '40')), ['size_invalid']);
    });

    test('add: a flat request with the country, size, price and the switch', () {
      final request = addWaitingPackageRequest(
        ' b1 ',
        _draft(
          lengthIn: '40',
          widthIn: '30,5',
          heightIn: '20',
          priceCents: 4550,
          payOnArrival: true,
        ),
      );
      expect(request['businessId'], 'b1');
      expect(request['kind'], 'barrels');
      expect(request['quantity'], 2);
      expect(request['ownerKind'], 'customer');
      expect(request['customerName'], 'Fatou Diallo');
      expect(request['destinationCountryId'], 'guinea');
      expect(request['destinationCountryName'], 'Guinea');
      expect(request['lengthIn'], 40);
      expect(request['widthIn'], 30.5);
      expect(request['heightIn'], 20);
      expect(request['priceCents'], 4550);
      expect(request['payOnArrival'], isTrue);
      // Never the server's: what has been paid.
      expect(request.containsKey('paidCents'), isFalse);
      expect(request.containsKey('containerId'), isFalse);
    });

    test('add: nothing about size or price when none was entered', () {
      final request = addWaitingPackageRequest('b1', _draft());
      expect(request.containsKey('lengthIn'), isFalse);
      expect(request.containsKey('priceCents'), isFalse);
      expect(request['payOnArrival'], isFalse);
    });

    test('edit: no container, no price, and an emptied size is cleared', () {
      final request = updateWaitingPackageRequest(
        'b1',
        'l7',
        _draft(priceCents: 9900, payOnArrival: true),
      );
      expect(request['lineId'], 'l7');
      expect(request['containerId'], '');
      final line = request['line'] as Map<String, Object?>;
      expect(line.containsKey('priceCents'), isFalse,
          reason: 'the price goes through setContainerLinePrice');
      expect(line['payOnArrival'], isTrue);
      expect(line['destinationCountryId'], 'guinea');
      // Empty size on edit is an explicit "no size" - an omitted field would
      // keep the stored one.
      expect(line.containsKey('lengthIn'), isTrue);
      expect(line['lengthIn'], isNull);
      expect(line['heightIn'], isNull);

      final sized = updateWaitingPackageRequest(
          'b1', 'l7', _draft(lengthIn: '40', widthIn: '30', heightIn: '20'));
      expect((sized['line'] as Map)['lengthIn'], 40);
    });

    test('the price is saved separately only when it or the switch changed', () {
      final line = _line('l', {'priceCents': 4550, 'payOnArrival': false});
      expect(packagePriceChanged(line, _draft(priceCents: 4550)), isFalse);
      expect(packagePriceChanged(line, _draft(priceCents: 5000)), isTrue);
      expect(packagePriceChanged(line, _draft(priceCents: null)), isTrue);
      expect(
          packagePriceChanged(line, _draft(priceCents: 4550, payOnArrival: true)),
          isTrue);
    });

    test('the other requests are shaped the way the server reads them', () {
      expect(
        assignLinesRequest(' b1 ', 'c1', ['a', 'b', 'a', ' ', 'c']),
        {
          'businessId': 'b1',
          'containerId': 'c1',
          'lineIds': ['a', 'b', 'c'],
        },
      );
      expect(unassignLineRequest('b1', 'l1'),
          {'businessId': 'b1', 'lineId': 'l1'});
      expect(removeWaitingPackageRequest('b1', 'l1'),
          {'businessId': 'b1', 'containerId': '', 'lineId': 'l1'});
      expect(
        setPackagePriceRequest('b1', 'l1', priceCents: null, payOnArrival: true),
        {
          'businessId': 'b1',
          'lineId': 'l1',
          'priceCents': null,
          'payOnArrival': true,
        },
      );
      expect(
        recordPackagePaymentRequest('b1', 'l1',
            amountCents: 7500, method: 'zelle', note: ' paid '),
        {
          'businessId': 'b1',
          'lineId': 'l1',
          'amountCents': 7500,
          'method': 'zelle',
          'note': 'paid',
        },
      );
      expect(revertPackagePaymentRequest('b1', 'p1'),
          {'businessId': 'b1', 'paymentId': 'p1'});
    });
  });

  group('the manifest knows a waiting line', () {
    test('a line reads its new fields, and an old one defaults', () {
      final line = _line('l1', {
        'lengthIn': 40,
        'widthIn': 30,
        'heightIn': 20,
        'priceCents': 4550,
        'paidCents': 1000,
        'payOnArrival': true,
      });
      expect(line.isWaiting, isTrue);
      expect(line.destinationCountryId, 'guinea');
      expect(line.lengthIn, 40);
      expect(line.priceCents, 4550);
      expect(line.paidCents, 1000);
      expect(line.payOnArrival, isTrue);

      final legacy = ContainerLine.fromMap('old', {
        'businessId': 'b1',
        'containerId': 'c1',
        'containerStatus': 'shipped',
        'kind': 'barrels',
        'quantity': 1,
      });
      expect(legacy.isWaiting, isFalse);
      expect(legacy.destinationCountryId, '');
      expect(legacy.lengthIn, isNull);
      expect(legacy.priceCents, isNull);
      expect(legacy.paidCents, 0);
      expect(legacy.payOnArrival, isFalse);
    });

    test('a waiting car holds its VIN: the holder is "waiting", not a box', () {
      final waiting = _line('w', {
        'kind': containerLineKindCar,
        'vinNumber': 'ABC1234567',
      });
      expect(openContainerHoldingVin([waiting]), containerWaitingHolder);
      final loaded = _line('x', {
        'kind': containerLineKindCar,
        'vinNumber': 'ABC1234567',
        'containerId': 'c9',
        'containerStatus': 'loading',
      });
      expect(openContainerHoldingVin([loaded]), 'c9');
      expect(openContainerHoldingVin([loaded], ignoreContainerId: 'c9'), '');
      final arrived = _line('y', {
        'kind': containerLineKindCar,
        'vinNumber': 'ABC1234567',
        'containerId': 'c9',
        'containerStatus': 'arrived',
      });
      expect(openContainerHoldingVin([arrived]), '');
    });

    test('every refusal code of docs/WAITING_PACKAGES.md is known', () {
      const codes = [
        'package_destination_required',
        'destination_mismatch',
        'container_destination_required',
        'size_invalid',
        'line_not_waiting',
        'line_is_waiting',
        'line_not_in_container',
        'line_ids_invalid',
        'line_has_payments',
        'price_invalid',
        'price_below_paid',
        'price_required',
        'amount_required',
        'amount_too_large',
        'payment_method_invalid',
        'payment_exceeds_balance',
        'payment_not_found',
        'payment_already_reverted',
        'vin_already_waiting',
      ];
      for (final code in codes) {
        expect(containerRefusalCodes, contains(code));
        expect(parseContainerRefusal({'reason': code}, 'x').codes, [code]);
      }
    });

    test('a refusal names the packages it is about, and a waiting holder', () {
      final mismatch = parseContainerRefusal(
        {'reason': 'destination_mismatch', 'lineIds': ['l2', 'l5', '']},
        'A package can only go on a container headed to the same country.',
      );
      expect(mismatch.codes, ['destination_mismatch']);
      expect(mismatch.lineIds, ['l2', 'l5']);

      final validation = parseContainerRefusal(
        {'reasons': ['size_invalid', 'package_destination_required']},
        'Enter the length...',
      );
      expect(validation.codes,
          ['size_invalid', 'package_destination_required']);

      final waitingHolder = parseContainerRefusal(
        {
          'reason': 'vin_already_loaded',
          'conflictContainerId': 'waiting',
          'conflictWaiting': true,
        },
        'This car is already waiting for a container.',
      );
      expect(waitingHolder.conflictWaiting, isTrue);
      expect(waitingHolder.conflictContainerId, '',
          reason: 'no container to open');
      expect(
        parseContainerRefusal(
                {'reason': 'vin_already_loaded', 'conflictContainerId': 'c9'}, '')
            .conflictContainerId,
        'c9',
      );
    });

    test('search finds a waiting package and says it is waiting', () {
      final lines = [
        _line('w', {'createdAt': DateTime(2026, 10, 3)}),
        _line('on', {
          'containerId': 'c1',
          'containerStatus': 'loading',
          'customerName': 'Fatou Bah',
        }),
        _line('gone', {
          'containerId': 'c2',
          'containerStatus': 'arrived',
          'customerName': 'Fatou Sow',
        }),
      ];
      final hits = searchContainerLines(lines, {'c1': _box('guinea')}, 'fatou');
      expect(hits.length, 3);
      final waiting = hits.firstWhere((h) => h.line.id == 'w');
      expect(waiting.isWaiting, isTrue);
      expect(waiting.container, isNull);
      expect(waiting.stage, containerLineStatusWaiting);
      final onBox = hits.firstWhere((h) => h.line.id == 'on');
      expect(onBox.isWaiting, isFalse);
      expect(onBox.stage, 'loading');
      // Work to do ranks with the boxes still loading, ahead of what is gone.
      expect(hits.last.line.id, 'gone');
      expect(hits.last.isWaiting, isFalse);
    });

    test('a waiting status is a line stage, not a state a container can be in',
        () {
      expect(containerStatuses, isNot(contains(containerLineStatusWaiting)));
      expect(
        ShippingContainer.fromMap('c', {'status': 'waiting'}).status,
        containerStatusLoading,
      );
    });
  });

  group('labels before any container', () {
    test('a package with no container is asked for by line id', () {
      expect(
        containerLabelsRequest(
          businessId: 'b1',
          containerId: '',
          lineId: ' l7 ',
          choice: const LabelPrintChoice(format: labelFormatThermal, copies: 1),
        ),
        {
          'businessId': 'b1',
          'containerId': '',
          'view': 'labels',
          'format': 'thermal',
          'copies': 1,
          'lineIds': ['l7'],
        },
      );
      final many = containerLabelsRequest(
        businessId: 'b1',
        containerId: '',
        lineIds: ['a', 'b', 'a'],
        choice: const LabelPrintChoice(),
      );
      expect(many['lineIds'], ['a', 'b']);
      expect(many.containsKey('lineId'), isFalse);
    });

    test('a package on a container still asks for its one line, as before', () {
      final request = containerLabelsRequest(
        businessId: 'b1',
        containerId: 'c1',
        lineId: 'l7',
        choice: const LabelPrintChoice(),
      );
      expect(request['lineId'], 'l7');
      expect(request.containsKey('lineIds'), isFalse);
    });
  });
}
