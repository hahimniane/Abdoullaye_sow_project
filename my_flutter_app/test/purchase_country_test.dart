import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/barrel_order.dart';
import 'package:my_flutter_app/models/barrel_shipment.dart';
import 'package:my_flutter_app/models/business_destination_option.dart';
import 'package:my_flutter_app/models/car.dart';
import 'package:my_flutter_app/models/car_purchase.dart';
import 'package:my_flutter_app/models/destination_country.dart';
import 'package:my_flutter_app/models/transport_request.dart';

void main() {
  test('deposit constants match reservation policy', () {
    expect(CarPurchase.fixedDepositAmount, 500);
    expect(CarPurchase.fixedDepositCurrency, 'USD');
  });

  test('purchase deserializes payment and destination fields', () {
    final purchase = CarPurchase.fromMap('purchase-1', {
      'carId': 'car-1',
      'carTitle': 'Toyota Camry',
      'buyerUid': 'user-1',
      'buyerEmail': 'buyer@example.com',
      'buyerName': 'Buyer',
      'buyerPhone': '555-0100',
      'destinationCountryId': 'senegal',
      'destinationCountryName': 'Senegal',
      'depositAmount': 500,
      'depositCurrency': 'USD',
      'paymentStatus': 'succeeded',
      'purchaseStatus': 'reserved',
    });

    expect(purchase.id, 'purchase-1');
    expect(purchase.destinationCountryName, 'Senegal');
    expect(purchase.paymentStatus, 'succeeded');
    expect(purchase.purchaseStatus, 'reserved');
  });

  test('direct purchase deserializes completed full payment records', () {
    final purchase = CarPurchase.fromMap('purchase-2', {
      'carId': 'car-2',
      'carTitle': 'Honda Accord',
      'buyerUid': 'user-2',
      'buyerEmail': 'buyer2@example.com',
      'buyerName': 'Direct Buyer',
      'buyerPhone': '555-0120',
      'destinationCountryId': 'guinea',
      'destinationCountryName': 'Guinea',
      'depositAmount': 24000,
      'depositCurrency': 'USD',
      'paymentStatus': 'succeeded',
      'purchaseStatus': 'completed',
      'paymentType': 'full_purchase',
    });

    expect(purchase.depositAmount, 24000);
    expect(purchase.paymentStatus, 'succeeded');
    expect(purchase.purchaseStatus, 'completed');
  });

  test('viewing reservation deserializes appointment details', () {
    final appointment = DateTime(2026, 6, 2, 14);
    final purchase = CarPurchase.fromMap('purchase-3', {
      'carId': 'car-3',
      'carTitle': 'Nissan Rogue',
      'buyerUid': 'user-3',
      'buyerEmail': 'buyer3@example.com',
      'buyerName': 'Viewing Buyer',
      'buyerPhone': '555-0130',
      'destinationCountryId': 'guinea',
      'destinationCountryName': 'Guinea',
      'depositAmount': 0,
      'depositCurrency': 'USD',
      'paymentStatus': 'not_required',
      'purchaseStatus': 'reserved',
      'paymentType': 'viewing_reservation',
      'appointmentStart': appointment,
      'appointmentLabel': 'Tue, Jun 2 - 2:00 PM',
    });

    expect(purchase.paymentType, 'viewing_reservation');
    expect(purchase.appointmentStart, appointment);
    expect(purchase.appointmentLabel, 'Tue, Jun 2 - 2:00 PM');
  });

  test('car status lifecycle includes reserved', () {
    final car = Car(
      id: 'car-1',
      title: 'Toyota Camry',
      make: 'Toyota',
      model: 'Camry',
      year: '2022',
      mileage: '10,000',
      price: 24000,
      description: '',
      features: const [],
      imageUrls: const [],
      status: 'reserved',
      contactPhone: '555-0100',
    );

    expect(car.isReserved, isTrue);
    expect(car.isSold, isFalse);
  });

  test('legacy shipment records fall back to Guinea', () {
    final barrel = BarrelShipment(
      id: 'barrel-1',
      trackingCode: 'BS123',
      senderName: 'Sender',
      senderAddress: 'Address',
      receiverName: 'Receiver',
      receiverPhone: '555-0101',
      price: 100,
      status: 'pending',
      createdAt: DateTime(2026),
    );
    final transport = TransportRequest(
      id: 'transport-1',
      trackingCode: 'TR123',
      ownerName: 'Owner',
      carMake: 'Toyota',
      carModel: 'Camry',
      carYear: '2022',
      vinNumber: 'VIN',
      transportDate: DateTime(2026),
      price: 200,
      status: 'pending',
      createdAt: DateTime(2026),
    );

    expect(barrel.destinationCountryName, DestinationCountry.fallback.name);
    expect(transport.destinationCountryId, DestinationCountry.fallback.id);
  });

  test('barrel order line serializes pickup details per destination', () {
    final pickupTime = DateTime.utc(2026, 7, 3, 14, 30);
    final country = DestinationCountry(
      id: 'guinea',
      name: 'Guinea',
      code: 'GN',
      isActive: true,
      barrelShippingPrice: 120,
    );
    final line = BarrelOrderLine(
      country: country,
      business: BusinessDestinationOption(
        id: 'business-a-guinea',
        businessId: 'business-a',
        businessName: 'Business A',
        country: country,
      ),
      receiverName: 'Receiver',
      receiverPhone: '+2245550101',
      quantity: 2,
      pickupRequested: true,
      pickupAddress: '3184 Webster Ave, Bronx, NY 10467',
      pickupBorough: 'Bronx',
      pickupFee: 25,
      pickupDateTime: pickupTime,
      hasPickupOverride: true,
    );

    expect(line.lineTotal, 265);
    expect(line.toCallableJson(), {
      'destinationCountryId': 'guinea',
      'businessId': 'business-a',
      'receiverName': 'Receiver',
      'receiverPhone': '+2245550101',
      'quantity': 2,
      'pickupRequested': true,
      'pickupAddress': '3184 Webster Ave, Bronx, NY 10467',
      'pickupBorough': 'Bronx',
      'pickupDateTime': pickupTime.toIso8601String(),
    });
  });

  test('barrel order line omits pickup details when using shared pickup', () {
    final country = DestinationCountry(
      id: 'guinea',
      name: 'Guinea',
      code: 'GN',
      isActive: true,
      barrelShippingPrice: 120,
    );
    final line = BarrelOrderLine(
      country: country,
      business: BusinessDestinationOption(
        id: 'business-a-guinea',
        businessId: 'business-a',
        businessName: 'Business A',
        country: country,
      ),
      receiverName: 'Receiver',
      receiverPhone: '+2245550101',
      quantity: 1,
    );

    expect(line.toCallableJson().keys, isNot(contains('pickupRequested')));
    expect(line.toCallableJson().keys, isNot(contains('pickupAddress')));
    expect(line.toCallableJson().keys, isNot(contains('pickupDateTime')));
  });

  test(
    'barrel order line only serializes officeLocationId when a business office was chosen',
    () {
      final country = DestinationCountry(
        id: 'guinea',
        name: 'Guinea',
        code: 'GN',
        isActive: true,
        barrelShippingPrice: 120,
      );
      final business = BusinessDestinationOption(
        id: 'business-a-guinea',
        businessId: 'business-a',
        businessName: 'Business A',
        country: country,
      );
      final withoutLocation = BarrelOrderLine(
        country: country,
        business: business,
        receiverName: 'Receiver',
        receiverPhone: '+2245550101',
        quantity: 1,
      );
      expect(
        withoutLocation.toCallableJson().keys,
        isNot(contains('officeLocationId')),
      );

      final withLocation = withoutLocation.copyWith(
        officeLocationId: 'bronx-warehouse',
      );
      expect(
        withLocation.toCallableJson()['officeLocationId'],
        'bronx-warehouse',
      );
      // copyWith without an override must preserve the existing value.
      expect(withLocation.copyWith().officeLocationId, 'bronx-warehouse');
    },
  );
}
