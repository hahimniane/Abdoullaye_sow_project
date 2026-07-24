import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/transport_request.dart';

void main() {
  test('transport request accepts numeric vehicle years from Firestore', () {
    final request = TransportRequest.fromMap(
      id: 'transport-1',
      data: {
        'trackingCode': 'TR-001',
        'ownerName': 'Customer',
        'carMake': 'Toyota',
        'carModel': 'Camry',
        'carYear': 2022,
        'destinationCountryId': 'gn',
        'destinationCountryName': 'Guinea',
        'status': 'pending',
      },
    );

    expect(request.carYear, '2022');
    expect(request.trackingCode, 'TR-001');
  });

  test('marketplace requests do not inherit legacy destination defaults', () {
    final request = TransportRequest.fromMap(
      id: 'transport-marketplace-1',
      data: {
        'flowVersion': 2,
        'trackingCode': 'TR-002',
        'ownerName': 'Customer',
        'carMake': 'Honda',
        'carModel': 'CR-V',
        'carYear': '2024',
        'quoteStatus': 'collecting',
        'fulfillmentStatus': 'not_started',
        'quoteCount': 2,
        'selectedAmountCents': 125000,
        'currency': 'usd',
        'pickupArea': 'Bronx, NY 10467',
        'vehicleOperable': false,
        'requestedTransportMethod': 'enclosed',
        'flexibleDates': false,
      },
    );

    expect(request.usesQuoteMarketplace, isTrue);
    expect(request.destinationCountryId, isEmpty);
    expect(request.destinationCountryName, isEmpty);
    expect(request.price, 1250);
    expect(request.awaitingQuote, isTrue);
    expect(request.quoteCount, 2);
    expect(request.pickupArea, 'Bronx, NY 10467');
    expect(request.vehicleOperable, isFalse);
    expect(request.requestedTransportMethod, 'enclosed');
    expect(request.flexibleDates, isFalse);
  });

  test('marketplace request recognizes its selected quote and provider', () {
    final request = TransportRequest.fromMap(
      id: 'transport-marketplace-2',
      data: {
        'flowVersion': 2,
        'selectedQuoteId': 'quote-business-1',
        'selectedBusinessId': 'business-1',
        'quoteStatus': 'selected',
        'fulfillmentStatus': 'not_started',
      },
    );

    expect(request.hasSelectedQuote, isTrue);
    expect(request.awaitingQuote, isFalse);
    expect(request.businessId, isEmpty);
    expect(request.selectedBusinessId, 'business-1');
  });
}
