import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/container_loading.dart';
import 'package:my_flutter_app/services/container_manifest.dart';

/// Air containers (docs/AIR_PACKAGES.md §1-2), the app's mirror of the
/// server's "air containers" cases in functions/test/container-manifest
/// .test.js: a flight is a container marked air, named by its waybill.
ContainerDraft flight({
  String label = '',
  String airWaybill = '176-12345678',
  String airline = 'Air France',
  String containerNumber = '',
}) =>
    ContainerDraft(
      shipMode: containerShipModeAir,
      label: label,
      airWaybill: airWaybill,
      airline: airline,
      containerNumber: containerNumber,
      destinationCountryId: 'GN',
    );

void main() {
  test('is sea unless marked air (every box from before the field is sea)',
      () {
    expect(containerShipModes, ['sea', 'air']);
    expect(containerShipModeOf('AIR'), 'air');
    expect(containerShipModeOf('boat'), 'sea');
    expect(containerShipModeOf(null), 'sea');
    expect(ShippingContainer.fromMap('c', {'businessId': 'b'}).isAir, isFalse);
    expect(
      ShippingContainer.fromMap('c', {'businessId': 'b', 'shipMode': 'air'})
          .isAir,
      isTrue,
    );
  });

  test('stores the waybill upper case without spaces, 6-20 chars', () {
    expect(airWaybillOf(' 176-1234 5678 '), '176-12345678');
    expect(airWaybillOf('abc123'), 'ABC123');
    expect(airWaybillOf(null), '');
    expect(airWaybillPattern.hasMatch('176-12345678'), isTrue);
    expect(airWaybillPattern.hasMatch('12345'), isFalse);
    expect(airWaybillPattern.hasMatch('176/123456'), isFalse);
  });

  test('needs a working name or a waybill, and refuses a bad waybill', () {
    expect(
      validateContainer(
          const ContainerDraft(shipMode: 'air', label: 'Fri flight')),
      isEmpty,
    );
    expect(
      validateContainer(const ContainerDraft(shipMode: 'air')),
      ['container_label_required'],
    );
    expect(validateContainer(flight(airWaybill: '12345')),
        ['air_waybill_invalid']);
    expect(validateContainer(flight(airWaybill: '176/123456')),
        ['air_waybill_invalid']);
    expect(validateContainer(flight(airWaybill: '176 1234 5678')), isEmpty);
    // A sea container never checks the waybill, an air one never the number.
    expect(
      validateContainer(const ContainerDraft(label: 'x', airWaybill: '12')),
      isEmpty,
    );
    expect(
      validateContainer(flight(containerNumber: 'not-a-number')),
      isEmpty,
    );
  });

  test('records a flight by its waybill and airline, with no number', () {
    final record = containerRecord(flight(
      containerNumber: 'msku1234567',
      airWaybill: '176-1234 5678',
      airline: ' Air France ',
    ));
    expect(record['shipMode'], 'air');
    expect(record['containerNumber'], '');
    expect(record['airWaybill'], '176-12345678');
    expect(record['airline'], 'Air France');
    final sea = containerRecord(const ContainerDraft(
      containerNumber: 'msku1234567',
      airWaybill: '176-12345678',
      airline: 'Air France',
    ));
    expect(sea['shipMode'], 'sea');
    expect(sea['containerNumber'], 'MSKU1234567');
    expect(sea['airWaybill'], '');
    expect(sea['airline'], '');
  });

  test('reads a stored flight and names it by its waybill', () {
    final c = ShippingContainer.fromMap('c1', {
      'businessId': 'b1',
      'shipMode': 'air',
      'label': 'Friday flight',
      'airWaybill': '176-12345678',
      'airline': 'Air France',
      'containerNumber': 'MSKU1234567',
      'status': 'loading',
      'carrierTrackingError': 'carrier_unknown',
      'carrierTrackingFailedFor': 'MSKU1234567',
    });
    expect(c.isAir, isTrue);
    expect(c.displayName, '176-12345678');
    expect(c.reference, '176-12345678');
    expect(c.airline, 'Air France');
    // Never on the ocean carrier feed, whatever the stored number says.
    expect(containerCarrierNeedsChoice(c), isFalse);
    final named = ShippingContainer.fromMap('c2', {
      'businessId': 'b1',
      'shipMode': 'air',
      'label': 'Friday flight',
    });
    expect(named.displayName, 'Friday flight');
    expect(named.reference, '');
    // A sea box ignores any waybill left on it.
    final sea = ShippingContainer.fromMap('c3', {
      'businessId': 'b1',
      'containerNumber': 'MSKU1234567',
      'airWaybill': '176-12345678',
    });
    expect(sea.isAir, isFalse);
    expect(sea.airWaybill, '');
    expect(sea.displayName, 'MSKU1234567');
  });

  test('a scan sends the acknowledgement only when confirmed', () {
    final plain = loadScanRequest(
      businessId: 'b1',
      containerId: 'c1',
      code: 'CL-K7M4P2',
      scanId: 'scan_1',
    );
    expect(plain.containsKey('acknowledgeProblems'), isFalse);
    final confirmed = loadScanRequest(
      businessId: 'b1',
      containerId: 'c1',
      code: 'CL-K7M4P2',
      scanId: 'scan_1',
      acknowledgeProblems: true,
    );
    expect(confirmed['acknowledgeProblems'], isTrue);
  });
}
