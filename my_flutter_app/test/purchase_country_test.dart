import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/barrel_shipment.dart';
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
}
